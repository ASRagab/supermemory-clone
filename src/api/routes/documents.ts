import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import {
  CreateDocumentSchema,
  UpdateDocumentSchema,
  ListDocumentsQuerySchema,
  BulkDeleteSchema,
  ApiDocument,
  SuccessResponse,
} from '../../types/api.types.js';
import { requireScopes } from '../middleware/auth.js';
import { notFound, validationError } from '../middleware/errorHandler.js';
import { uploadRateLimit } from '../middleware/rateLimit.js';
import { getDocumentService } from '../../services/documents.service.js';

const documentsRouter = new Hono();
const documentsService = getDocumentService();

/**
 * POST / - Add a new document
 */
documentsRouter.post('/', requireScopes('write'), async (c) => {
  const startTime = Date.now();

  const body = await c.req.json();
  const validatedData = CreateDocumentSchema.parse(body);

  // Check for duplicate customId
  if (validatedData.customId) {
    const existing = await documentsService.getDocumentByCustomId(validatedData.customId);
    if (existing) {
      validationError(`Document with customId '${validatedData.customId}' already exists`);
    }
  }

  const created = await documentsService.createDocument({
    id: uuidv4(),
    content: validatedData.content,
    containerTag: validatedData.containerTag,
    metadata: validatedData.metadata,
    customId: validatedData.customId,
    contentType: 'text/plain',
  });

  const response: SuccessResponse<ApiDocument> = {
    data: created,
    timing: Date.now() - startTime,
  };

  return c.json(response, 201);
});

/**
 * GET /:id - Get a document by ID
 */
documentsRouter.get('/:id', requireScopes('read'), async (c) => {
  const startTime = Date.now();
  const id = c.req.param('id');

  const foundDocument = await documentsService.getDocument(id);

  if (!foundDocument) {
    return notFound('Document', id);
  }

  const response: SuccessResponse<ApiDocument> = {
    data: foundDocument,
    timing: Date.now() - startTime,
  };

  return c.json(response);
});

/**
 * PUT /:id - Update a document
 */
documentsRouter.put('/:id', requireScopes('write'), async (c) => {
  const startTime = Date.now();
  const id = c.req.param('id');

  const body = await c.req.json();
  const validatedData = UpdateDocumentSchema.parse(body);

  const updatedDocument = await documentsService.updateDocument(id, {
    content: validatedData.content,
    containerTag: validatedData.containerTag,
    metadata: validatedData.metadata,
  });

  if (!updatedDocument) {
    return notFound('Document', id);
  }

  const response: SuccessResponse<ApiDocument> = {
    data: updatedDocument,
    timing: Date.now() - startTime,
  };

  return c.json(response);
});

/**
 * DELETE /:id - Delete a document
 */
documentsRouter.delete('/:id', requireScopes('write'), async (c) => {
  const startTime = Date.now();
  const id = c.req.param('id');

  const deletedId = await documentsService.deleteDocument(id);

  if (!deletedId) {
    return notFound('Document', id);
  }

  const response: SuccessResponse<{ deleted: true; id: string }> = {
    data: { deleted: true, id: deletedId },
    timing: Date.now() - startTime,
  };

  return c.json(response);
});

/**
 * GET / - List documents with optional filtering
 */
documentsRouter.get('/', requireScopes('read'), async (c) => {
  const startTime = Date.now();

  const query = ListDocumentsQuerySchema.parse({
    containerTag: c.req.query('containerTag'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });

  const { documents: results, total } = await documentsService.listDocuments({
    containerTag: query.containerTag,
    limit: query.limit,
    offset: query.offset,
  });

  const response: SuccessResponse<{
    documents: ApiDocument[];
    total: number;
    limit: number;
    offset: number;
  }> = {
    data: {
      documents: results,
      total,
      limit: query.limit,
      offset: query.offset,
    },
    timing: Date.now() - startTime,
  };

  return c.json(response);
});

/**
 * POST /file - Upload a file as a document
 */
documentsRouter.post('/file', requireScopes('write'), uploadRateLimit, async (c) => {
  const startTime = Date.now();

  const formData = await c.req.formData();
  const file = formData.get('file');
  const containerTag = formData.get('containerTag') as string | null;
  const metadataStr = formData.get('metadata') as string | null;

  if (!file || !(file instanceof File)) {
    validationError('File is required');
  }

  // Parse metadata if provided
  let metadata: Record<string, unknown> | undefined;
  if (metadataStr) {
    try {
      metadata = JSON.parse(metadataStr);
    } catch {
      validationError('Invalid metadata JSON');
    }
  }

  // Read file content
  const content = await file.text();

  if (!content.trim()) {
    validationError('File content is empty');
  }

  const newDocument = await documentsService.createDocument({
    id: uuidv4(),
    content,
    containerTag: containerTag || undefined,
    metadata: {
      ...metadata,
      filename: file.name,
      fileType: file.type,
      fileSize: file.size,
    },
    contentType: file.type || 'text/plain',
  });

  const responseTime = Date.now();
  const response: SuccessResponse<ApiDocument> = {
    data: newDocument,
    timing: responseTime - startTime,
  };

  return c.json(response, 201);
});

/**
 * POST /bulk-delete - Delete multiple documents
 */
documentsRouter.post('/bulk-delete', requireScopes('write'), async (c) => {
  const startTime = Date.now();

  const body = await c.req.json();
  const validatedData = BulkDeleteSchema.parse(body);

  const { deletedIds, notFoundIds } = await documentsService.bulkDelete({
    ids: validatedData.ids,
    containerTags: validatedData.containerTags,
  });

  const response: SuccessResponse<{ deleted: string[]; notFound: string[]; count: number }> = {
    data: {
      deleted: deletedIds,
      notFound: notFoundIds,
      count: deletedIds.length,
    },
    timing: Date.now() - startTime,
  };

  return c.json(response);
});

export { documentsRouter };
