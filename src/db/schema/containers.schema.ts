import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const containerTags = pgTable(
  'container_tags',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tag: varchar('tag', { length: 255 }).notNull().unique(),
    parentTag: varchar('parent_tag', { length: 255 }).references((): AnyPgColumn => containerTags.tag, {
      onDelete: 'set null',
    }),
    displayName: varchar('display_name', { length: 255 }),
    description: text('description'),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    settings: jsonb('settings').default(sql`'{}'::jsonb`),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_container_tags_parent').on(table.parentTag),
    index('idx_container_tags_active')
      .on(table.isActive)
      .where(sql`${table.isActive} = TRUE`),
    index('idx_container_tags_metadata').using('gin', table.metadata),
    index('idx_container_tags_hierarchy').on(table.tag, table.parentTag),
    check('container_tags_no_self_parent', sql`${table.tag} != ${table.parentTag}`),
    check('container_tags_tag_format', sql`${table.tag} ~ '^[a-zA-Z0-9_-]+$'`),
  ]
);

export type ContainerTag = typeof containerTags.$inferSelect;
export type NewContainerTag = typeof containerTags.$inferInsert;
