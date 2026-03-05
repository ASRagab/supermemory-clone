/**
 * Search Resource
 * Provides search functionality for documents and memories
 */

import { APIResource } from './base.js'
import { APIPromise } from '../http.js'
import type {
  RequestOptions,
  SearchDocumentsParams,
  SearchDocumentsResponse,
  SearchMemoriesParams,
  SearchMemoriesResponse,
  SearchExecuteParams,
  SearchExecuteResponse,
} from '../types.js'

export class Search extends APIResource {
  /**
   * Search documents with advanced filtering
   *
   * @param body - Search parameters including query and filters
   * @param options - Request options
   * @returns Search results with documents and metadata
   */
  documents(body: SearchDocumentsParams, options?: RequestOptions): APIPromise<SearchDocumentsResponse> {
    return this._post<SearchDocumentsResponse>('/v3/search', {
      body,
      requestOptions: options,
    })
  }

  /**
   * Execute a search query (alias for documents)
   *
   * @param body - Search parameters including query and filters
   * @param options - Request options
   * @returns Search results with documents and metadata
   */
  execute(body: SearchExecuteParams, options?: RequestOptions): APIPromise<SearchExecuteResponse> {
    return this._post<SearchExecuteResponse>('/v3/search', {
      body,
      requestOptions: options,
    })
  }

  /**
   * Search memories with advanced filtering
   *
   * @param body - Search parameters for memories
   * @param options - Request options
   * @returns Search results with memories and metadata
   */
  memories(body: SearchMemoriesParams, options?: RequestOptions): APIPromise<SearchMemoriesResponse> {
    return this._post<SearchMemoriesResponse>('/v4/memories/search', {
      body,
      requestOptions: options,
    })
  }
}
