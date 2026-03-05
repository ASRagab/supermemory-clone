/**
 * Documents Resource
 * Provides CRUD operations for documents
 */

import { APIResource } from './base.js'
import { APIPromise } from '../http.js'
import type {
  RequestOptions,
  DocumentListParams,
  DocumentListResponse,
  DocumentUpdateParams,
  DocumentUpdateResponse,
  DocumentAddParams,
  DocumentAddResponse,
  DocumentBatchAddParams,
  DocumentBatchAddResponse,
  DocumentDeleteBulkParams,
  DocumentDeleteBulkResponse,
  DocumentGetResponse,
  DocumentListProcessingResponse,
  DocumentUploadFileParams,
  DocumentUploadFileResponse,
} from '../types.js'

export class Documents extends APIResource {
  /**
   * Retrieve a specific document by ID
   *
   * @param id - Document ID or customId
   * @param options - Request options
   * @returns The document with full details
   */
  get(id: string, options?: RequestOptions): APIPromise<DocumentGetResponse> {
    return this.client.get<DocumentGetResponse>(`/v3/documents/${encodeURIComponent(id)}`, {
      requestOptions: options,
    })
  }

  /**
   * Retrieve a paginated collection of documents
   *
   * @param body - List parameters including filters and pagination
   * @param options - Request options
   * @returns Paginated list of documents
   */
  list(body?: DocumentListParams | null, options?: RequestOptions): APIPromise<DocumentListResponse> {
    return this._post<DocumentListResponse>('/v3/documents/list', {
      body: body || {},
      requestOptions: options,
    })
  }

  /**
   * Insert a new document
   *
   * @param body - Document content and metadata
   * @param options - Request options
   * @returns Created document ID and status
   */
  add(body: DocumentAddParams, options?: RequestOptions): APIPromise<DocumentAddResponse> {
    return this._post<DocumentAddResponse>('/v3/add', {
      body,
      requestOptions: options,
    })
  }

  /**
   * Insert multiple documents in one request
   *
   * @param body - Array of documents to add
   * @param options - Request options
   * @returns Results for each document including any failures
   */
  batchAdd(body: DocumentBatchAddParams, options?: RequestOptions): APIPromise<DocumentBatchAddResponse> {
    return this._post<DocumentBatchAddResponse>('/v3/documents/batch', {
      body,
      requestOptions: options,
    })
  }

  /**
   * Update a document's content or metadata
   *
   * @param id - Document ID or customId
   * @param body - Updated content and/or metadata
   * @param options - Request options
   * @returns Updated document status
   */
  update(id: string, body?: DocumentUpdateParams | null, options?: RequestOptions): APIPromise<DocumentUpdateResponse> {
    return this._patch<DocumentUpdateResponse>(`/v3/documents/${encodeURIComponent(id)}`, {
      body: body || {},
      requestOptions: options,
    })
  }

  /**
   * Delete a document by ID
   *
   * @param id - Document ID or customId
   * @param options - Request options
   */
  delete(id: string, options?: RequestOptions): APIPromise<void> {
    return this.client.delete<void>(`/v3/documents/${encodeURIComponent(id)}`, {
      requestOptions: options,
    })
  }

  /**
   * Delete multiple documents by IDs or container tags
   *
   * @param body - IDs or container tags to delete
   * @param options - Request options
   * @returns Count and IDs of deleted documents
   */
  deleteBulk(body?: DocumentDeleteBulkParams | null, options?: RequestOptions): APIPromise<DocumentDeleteBulkResponse> {
    return this._post<DocumentDeleteBulkResponse>('/v3/documents/delete', {
      body: body || {},
      requestOptions: options,
    })
  }

  /**
   * Get documents currently being processed
   *
   * @param options - Request options
   * @returns List of documents in processing state
   */
  listProcessing(options?: RequestOptions): APIPromise<DocumentListProcessingResponse> {
    return this.client.get<DocumentListProcessingResponse>('/v3/documents/processing', {
      requestOptions: options,
    })
  }

  /**
   * Upload a file for processing
   *
   * @param body - File and metadata for upload
   * @param options - Request options
   * @returns Created document ID and status
   */
  uploadFile(body: DocumentUploadFileParams, options?: RequestOptions): APIPromise<DocumentUploadFileResponse> {
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

    return this.client.uploadFile<DocumentUploadFileResponse>('/v3/documents/upload', file, {
      fieldName: 'file',
      additionalFields,
      requestOptions: options,
    })
  }
}
