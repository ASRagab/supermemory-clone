/**
 * Memories Resource
 * Provides CRUD operations for memories (conversation-oriented storage)
 */

import { APIResource } from './base.js'
import { APIPromise } from '../http.js'
import type {
  RequestOptions,
  MemoryListParams,
  MemoryListResponse,
  MemoryAddParams,
  MemoryAddResponse,
  MemoryUpdateParams,
  MemoryUpdateResponse,
  MemoryForgetParams,
  MemoryForgetResponse,
  MemoryGetResponse,
  MemoryUpdateMemoryParams,
  MemoryUpdateMemoryResponse,
  MemoryUploadFileParams,
  MemoryUploadFileResponse,
} from '../types.js'

export class Memories extends APIResource {
  /**
   * Retrieve a specific memory by ID
   *
   * @param id - Memory ID
   * @param options - Request options
   * @returns The memory with full details
   */
  get(id: string, options?: RequestOptions): APIPromise<MemoryGetResponse> {
    return this.client.get<MemoryGetResponse>(`/v4/memories/${encodeURIComponent(id)}`, {
      requestOptions: options,
    })
  }

  /**
   * Retrieve a paginated collection of memories
   *
   * @param body - List parameters including filters and pagination
   * @param options - Request options
   * @returns Paginated list of memories
   */
  list(body?: MemoryListParams | null, options?: RequestOptions): APIPromise<MemoryListResponse> {
    return this._post<MemoryListResponse>('/v4/memories/list', {
      body: body || {},
      requestOptions: options,
    })
  }

  /**
   * Add a new memory
   *
   * @param body - Memory content and metadata
   * @param options - Request options
   * @returns Created memory ID and status
   */
  add(body: MemoryAddParams, options?: RequestOptions): APIPromise<MemoryAddResponse> {
    return this._post<MemoryAddResponse>('/v4/memories', {
      body,
      requestOptions: options,
    })
  }

  /**
   * Update a memory's content or metadata
   *
   * @param id - Memory ID
   * @param body - Updated content and/or metadata
   * @param options - Request options
   * @returns Updated memory status
   */
  update(id: string, body?: MemoryUpdateParams | null, options?: RequestOptions): APIPromise<MemoryUpdateResponse> {
    return this._patch<MemoryUpdateResponse>(`/v4/memories/${encodeURIComponent(id)}`, {
      body: body || {},
      requestOptions: options,
    })
  }

  /**
   * Delete a memory by ID
   *
   * @param id - Memory ID
   * @param options - Request options
   */
  delete(id: string, options?: RequestOptions): APIPromise<void> {
    return this.client.delete<void>(`/v4/memories/${encodeURIComponent(id)}`, {
      requestOptions: options,
    })
  }

  /**
   * Soft delete (forget) a memory
   *
   * @param body - Memory ID and optional reason
   * @param options - Request options
   * @returns Confirmation of forgotten memory
   */
  forget(body: MemoryForgetParams, options?: RequestOptions): APIPromise<MemoryForgetResponse> {
    return this._post<MemoryForgetResponse>('/v4/memories/forget', {
      body,
      requestOptions: options,
    })
  }

  /**
   * Create a new version of a memory while preserving the original
   *
   * @param body - Memory update with versioning
   * @param options - Request options
   * @returns New memory version details
   */
  updateMemory(body: MemoryUpdateMemoryParams, options?: RequestOptions): APIPromise<MemoryUpdateMemoryResponse> {
    return this._post<MemoryUpdateMemoryResponse>('/v4/memories/update', {
      body,
      requestOptions: options,
    })
  }

  /**
   * Upload a file as a memory
   *
   * @param body - File and metadata for upload
   * @param options - Request options
   * @returns Created memory ID and status
   */
  uploadFile(body: MemoryUploadFileParams, options?: RequestOptions): APIPromise<MemoryUploadFileResponse> {
    const { file, containerTag, customId, metadata } = body

    // Build additional form fields
    const additionalFields: Record<string, string> = {}
    if (containerTag) {
      additionalFields.containerTag = containerTag
    }
    if (customId) {
      additionalFields.customId = customId
    }
    if (metadata) {
      additionalFields.metadata = JSON.stringify(metadata)
    }

    return this.client.uploadFile<MemoryUploadFileResponse>('/v4/memories/upload', file, {
      fieldName: 'file',
      additionalFields,
      requestOptions: options,
    })
  }
}
