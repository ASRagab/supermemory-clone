import { Hono } from 'hono';
import { UpdateProfileSchema, ApiProfile, SuccessResponse } from '../../types/api.types.js';
import { requireScopes } from '../middleware/auth.js';
import { notFound } from '../middleware/errorHandler.js';
import { getDatabaseUrl } from '../../db/client.js';
import { getPostgresDatabase } from '../../db/postgres.js';
import { containerTags } from '../../db/schema/containers.schema.js';
import { documents } from '../../db/schema/documents.schema.js';
import { desc, eq, inArray, sql } from 'drizzle-orm';

const profilesRouter = new Hono();
const db = getPostgresDatabase(getDatabaseUrl());

type ContainerTagRow = typeof containerTags.$inferSelect;

function normalizeSettings(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return undefined;
}

function toApiProfile(row: ContainerTagRow, documentCount: number): ApiProfile {
  return {
    containerTag: row.tag,
    name: row.displayName ?? undefined,
    description: row.description ?? undefined,
    settings: normalizeSettings(row.settings) ?? undefined,
    documentCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function ensureContainerTag(tag: string): Promise<ContainerTagRow | null> {
  await db.insert(containerTags).values({ tag }).onConflictDoNothing({ target: containerTags.tag });
  const [row] = await db.select().from(containerTags).where(eq(containerTags.tag, tag)).limit(1);
  return row ?? null;
}

async function getDocumentCount(containerTag: string): Promise<number> {
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(eq(documents.containerTag, containerTag));
  return Number(countRow?.count ?? 0);
}

/**
 * GET /:containerTag - Get profile by container tag
 * If the profile doesn't exist, creates one based on documents with that tag
 */
profilesRouter.get('/:containerTag', requireScopes('read'), async (c) => {
  const startTime = Date.now();
  const containerTag = c.req.param('containerTag');

  const [existingRow] = await db
    .select()
    .from(containerTags)
    .where(eq(containerTags.tag, containerTag))
    .limit(1);

  const documentCount = await getDocumentCount(containerTag);

  let row = existingRow ?? null;
  if (!row) {
    if (documentCount === 0) {
      return notFound('Profile', containerTag);
    }
    row = await ensureContainerTag(containerTag);
  }

  if (!row) {
    return notFound('Profile', containerTag);
  }

  const response: SuccessResponse<ApiProfile> = {
    data: toApiProfile(row, documentCount),
    timing: Date.now() - startTime,
  };

  return c.json(response);
});

/**
 * PUT /:containerTag - Update or create a profile
 */
profilesRouter.put('/:containerTag', requireScopes('write'), async (c) => {
  const startTime = Date.now();
  const containerTag = c.req.param('containerTag');

  const body = await c.req.json();
  const validatedData = UpdateProfileSchema.parse(body);

  const [existingRow] = await db
    .select()
    .from(containerTags)
    .where(eq(containerTags.tag, containerTag))
    .limit(1);

  let row: ContainerTagRow | null = existingRow ?? null;
  const now = new Date();

  if (!row) {
    const [created] = await db
      .insert(containerTags)
      .values({
        tag: containerTag,
        displayName: validatedData.name,
        description: validatedData.description,
        settings: validatedData.settings ?? {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    row = created ?? null;
  } else {
    const updatePayload: Partial<typeof containerTags.$inferInsert> = {
      updatedAt: now,
    };

    if (validatedData.name !== undefined) {
      updatePayload.displayName = validatedData.name;
    }

    if (validatedData.description !== undefined) {
      updatePayload.description = validatedData.description;
    }

    if (validatedData.settings !== undefined) {
      updatePayload.settings = validatedData.settings;
    }

    const [updated] = await db
      .update(containerTags)
      .set(updatePayload)
      .where(eq(containerTags.tag, containerTag))
      .returning();
    row = updated ?? row;
  }

  if (!row) {
    return notFound('Profile', containerTag);
  }

  const documentCount = await getDocumentCount(containerTag);

  const response: SuccessResponse<ApiProfile> = {
    data: toApiProfile(row, documentCount),
    timing: Date.now() - startTime,
  };

  return c.json(response);
});

/**
 * GET / - List all profiles
 * Optional query params: limit, offset
 */
profilesRouter.get('/', requireScopes('read'), async (c) => {
  const startTime = Date.now();

  const limitParam = parseInt(c.req.query('limit') || '20', 10);
  const offsetParam = parseInt(c.req.query('offset') || '0', 10);

  const limit = Math.min(Number.isNaN(limitParam) ? 20 : Math.max(1, limitParam), 100);
  const offset = Number.isNaN(offsetParam) ? 0 : Math.max(0, offsetParam);

  const documentCounts = await db
    .select({
      tag: documents.containerTag,
      count: sql<number>`count(*)`,
    })
    .from(documents)
    .groupBy(documents.containerTag);

  const documentCountMap = new Map<string, number>(
    documentCounts.map((row) => [row.tag, Number(row.count ?? 0)])
  );

  const tagRows = await db.select().from(containerTags).orderBy(desc(containerTags.updatedAt));
  const existingTags = new Set(tagRows.map((row) => row.tag));
  const documentTags = documentCounts.map((row) => row.tag).filter(Boolean);
  const missingTags = documentTags.filter((tag) => !existingTags.has(tag));

  let allRows = tagRows;
  if (missingTags.length > 0) {
    await db
      .insert(containerTags)
      .values(missingTags.map((tag) => ({ tag })))
      .onConflictDoNothing({ target: containerTags.tag });

    const insertedRows = await db
      .select()
      .from(containerTags)
      .where(inArray(containerTags.tag, missingTags));
    allRows = [...tagRows, ...insertedRows];
  }

  const allProfiles = allRows.map((row) => toApiProfile(row, documentCountMap.get(row.tag) ?? 0));

  allProfiles.sort((a, b) => b.documentCount - a.documentCount);

  const total = allProfiles.length;
  const paginatedProfiles = allProfiles.slice(offset, offset + limit);

  const response: SuccessResponse<{
    profiles: ApiProfile[];
    total: number;
    limit: number;
    offset: number;
  }> = {
    data: {
      profiles: paginatedProfiles,
      total,
      limit,
      offset,
    },
    timing: Date.now() - startTime,
  };

  return c.json(response);
});

/**
 * DELETE /:containerTag - Delete a profile
 * Note: This only deletes the profile metadata, not the documents
 */
profilesRouter.delete('/:containerTag', requireScopes('write'), async (c) => {
  const startTime = Date.now();
  const containerTag = c.req.param('containerTag');

  const deleted = await db
    .delete(containerTags)
    .where(eq(containerTags.tag, containerTag))
    .returning({ tag: containerTags.tag });

  if (deleted.length === 0) {
    return notFound('Profile', containerTag);
  }

  const response: SuccessResponse<{ deleted: true; containerTag: string }> = {
    data: { deleted: true, containerTag },
    timing: Date.now() - startTime,
  };

  return c.json(response);
});

export { profilesRouter };
