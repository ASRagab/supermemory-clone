/**
 * Document Service - API-facing document operations
 */

import { ApiDocument } from '../types/api.types.js'
import type { Document } from '../db/schema/documents.schema.js'
import { DocumentRepository, getDocumentRepository, type DocumentListOptions } from './documents.repository.js'

const DEFAULT_CONTAINER_TAG = 'default'

export interface CreateDocumentInput {
  id: string
  content: string
  containerTag?: string
  metadata?: Record<string, unknown>
  customId?: string
  contentType?: string
}

export interface UpdateDocumentInput {
  content?: string
  containerTag?: string
  metadata?: Record<string, unknown>
}

export class DocumentService {
  private repository: DocumentRepository

  constructor(repository?: DocumentRepository) {
    this.repository = repository ?? getDocumentRepository()
  }

  async createDocument(input: CreateDocumentInput): Promise<ApiDocument> {
    const record = await this.repository.create({
      id: input.id,
      content: input.content,
      containerTag: this.normalizeContainerTag(input.containerTag),
      metadata: input.metadata ?? null,
      customId: input.customId ?? null,
      contentType: input.contentType ?? 'text/plain',
      status: 'pending',
    })

    return this.toApiDocument(record)
  }

  async getDocument(idOrCustomId: string): Promise<ApiDocument | null> {
    const record = await this.repository.findByIdOrCustomId(idOrCustomId)
    return record ? this.toApiDocument(record) : null
  }

  async getDocumentByCustomId(customId: string): Promise<ApiDocument | null> {
    const record = await this.repository.findByCustomId(customId)
    return record ? this.toApiDocument(record) : null
  }

  async updateDocument(idOrCustomId: string, updates: UpdateDocumentInput): Promise<ApiDocument | null> {
    const existing = await this.repository.findByIdOrCustomId(idOrCustomId)
    if (!existing) return null

    const record = await this.repository.update(existing.id, {
      content: updates.content,
      containerTag: updates.containerTag,
      metadata: updates.metadata,
    })

    return record ? this.toApiDocument(record) : null
  }

  async deleteDocument(idOrCustomId: string): Promise<string | null> {
    const existing = await this.repository.findByIdOrCustomId(idOrCustomId)
    if (!existing) return null

    const deleted = await this.repository.deleteById(existing.id)
    return deleted ? existing.id : null
  }

  async listDocuments(options: DocumentListOptions = {}): Promise<{
    documents: ApiDocument[]
    total: number
    limit: number
    offset: number
  }> {
    const limit = options.limit ?? 20
    const offset = options.offset ?? 0

    const { documents, total } = await this.repository.list({
      containerTag: options.containerTag,
      limit,
      offset,
    })

    return {
      documents: documents.map((doc) => this.toApiDocument(doc)),
      total,
      limit,
      offset,
    }
  }

  async bulkDelete(input: {
    ids?: string[]
    containerTags?: string[]
  }): Promise<{ deletedIds: string[]; notFoundIds: string[] }> {
    const deleted = new Set<string>()
    const notFound = new Set<string>()

    if (input.ids?.length) {
      const matches = await this.repository.findByIdsOrCustomIds(input.ids)
      const byId = new Map(matches.map((doc) => [doc.id, doc] as const))
      const byCustomId = new Map(
        matches.filter((doc) => doc.customId).map((doc) => [doc.customId as string, doc] as const)
      )

      const idsToDelete = new Set<string>()
      for (const id of input.ids) {
        const match = byId.get(id) ?? byCustomId.get(id)
        if (match) {
          idsToDelete.add(match.id)
        } else {
          notFound.add(id)
        }
      }

      if (idsToDelete.size > 0) {
        const deletedIds = await this.repository.deleteByIds([...idsToDelete])
        for (const id of deletedIds) {
          deleted.add(id)
        }
      }
    }

    if (input.containerTags?.length) {
      const deletedIds = await this.repository.deleteByContainerTags(input.containerTags)
      for (const id of deletedIds) {
        deleted.add(id)
      }
    }

    return {
      deletedIds: [...deleted],
      notFoundIds: [...notFound],
    }
  }

  private normalizeContainerTag(containerTag?: string): string {
    if (!containerTag || !containerTag.trim()) {
      return DEFAULT_CONTAINER_TAG
    }
    return containerTag
  }

  private toApiDocument(document: Document): ApiDocument {
    return {
      id: document.id,
      content: document.content,
      containerTag: document.containerTag || undefined,
      metadata: (document.metadata as Record<string, unknown> | null) ?? undefined,
      customId: document.customId ?? undefined,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    }
  }
}

// ==========================================================================
// Singleton Factory (lazy)
// ==========================================================================

let _serviceInstance: DocumentService | null = null

export function getDocumentService(): DocumentService {
  if (!_serviceInstance) {
    _serviceInstance = new DocumentService()
  }
  return _serviceInstance
}

export function resetDocumentService(): void {
  _serviceInstance = null
}

export function createDocumentService(repository?: DocumentRepository): DocumentService {
  return new DocumentService(repository ?? getDocumentRepository())
}

export const documentService = new Proxy({} as DocumentService, {
  get(_, prop) {
    return getDocumentService()[prop as keyof DocumentService]
  },
})
