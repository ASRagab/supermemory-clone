/**
 * Connections Resource
 * Manages external provider connections (GitHub, Gmail, Google Drive, etc.)
 */

import { APIResource } from './base.js';
import { APIPromise } from '../http.js';
import type {
  RequestOptions,
  ConnectionProvider,
  ConnectionCreateParams,
  ConnectionCreateResponse,
  ConnectionListParams,
  ConnectionListResponse,
  ConnectionConfigureParams,
  ConnectionConfigureResponse,
  ConnectionDeleteByIDResponse,
  ConnectionDeleteByProviderParams,
  ConnectionDeleteByProviderResponse,
  ConnectionGetByIDResponse,
  ConnectionGetByTagParams,
  ConnectionGetByTagResponse,
  ConnectionImportParams,
  ConnectionImportResponse,
  ConnectionListDocumentsParams,
  ConnectionListDocumentsResponse,
  ConnectionResourcesParams,
  ConnectionResourcesResponse,
} from '../types.js';

export class Connections extends APIResource {
  /**
   * Create a new connection to an external provider
   *
   * @param provider - Provider type (github, gmail, google-drive, notion, etc.)
   * @param body - Connection configuration
   * @param options - Request options
   * @returns Authorization link and connection details
   */
  create(
    provider: ConnectionProvider | string,
    body?: ConnectionCreateParams | null,
    options?: RequestOptions
  ): APIPromise<ConnectionCreateResponse> {
    return this._post<ConnectionCreateResponse>(`/v3/connections/${encodeURIComponent(provider)}`, {
      body: body || {},
      requestOptions: options,
    });
  }

  /**
   * List all connections
   *
   * @param body - List parameters including filters
   * @param options - Request options
   * @returns Array of connections
   */
  list(
    body?: ConnectionListParams | null,
    options?: RequestOptions
  ): APIPromise<ConnectionListResponse> {
    return this._post<ConnectionListResponse>('/v3/connections/list', {
      body: body || {},
      requestOptions: options,
    });
  }

  /**
   * Get connection details by ID
   *
   * @param id - Connection ID
   * @param options - Request options
   * @returns Connection details
   */
  getByID(id: string, options?: RequestOptions): APIPromise<ConnectionGetByIDResponse> {
    return this.client.get<ConnectionGetByIDResponse>(`/v3/connections/${encodeURIComponent(id)}`, {
      requestOptions: options,
    });
  }

  /**
   * Get connections by container tag
   *
   * @param provider - Provider type
   * @param body - Container tags to filter by
   * @param options - Request options
   * @returns Connection details
   */
  getByTag(
    provider: ConnectionProvider | string,
    body: ConnectionGetByTagParams,
    options?: RequestOptions
  ): APIPromise<ConnectionGetByTagResponse> {
    return this._post<ConnectionGetByTagResponse>(
      `/v3/connections/${encodeURIComponent(provider)}/by-tag`,
      {
        body,
        requestOptions: options,
      }
    );
  }

  /**
   * Configure resources for a connection
   *
   * @param id - Connection ID
   * @param body - Resources to configure
   * @param options - Request options
   * @returns Configuration result
   */
  configure(
    id: string,
    body: ConnectionConfigureParams,
    options?: RequestOptions
  ): APIPromise<ConnectionConfigureResponse> {
    return this._post<ConnectionConfigureResponse>(
      `/v3/connections/${encodeURIComponent(id)}/configure`,
      {
        body,
        requestOptions: options,
      }
    );
  }

  /**
   * Delete a connection by ID
   *
   * @param id - Connection ID
   * @param options - Request options
   * @returns Deleted connection details
   */
  deleteByID(id: string, options?: RequestOptions): APIPromise<ConnectionDeleteByIDResponse> {
    return this.client.delete<ConnectionDeleteByIDResponse>(
      `/v3/connections/${encodeURIComponent(id)}`,
      {
        requestOptions: options,
      }
    );
  }

  /**
   * Delete connections by provider and container tags
   *
   * @param provider - Provider type
   * @param body - Container tags to filter which connections to delete
   * @param options - Request options
   * @returns Deleted connection details
   */
  deleteByProvider(
    provider: ConnectionProvider | string,
    body: ConnectionDeleteByProviderParams,
    options?: RequestOptions
  ): APIPromise<ConnectionDeleteByProviderResponse> {
    return this.client.delete<ConnectionDeleteByProviderResponse>(
      `/v3/connections/${encodeURIComponent(provider)}`,
      {
        body,
        requestOptions: options,
      }
    );
  }

  /**
   * Import resources from a connection
   *
   * @param id - Connection ID
   * @param body - Import parameters
   * @param options - Request options
   * @returns Import results
   */
  import(
    id: string,
    body?: ConnectionImportParams | null,
    options?: RequestOptions
  ): APIPromise<ConnectionImportResponse> {
    return this._post<ConnectionImportResponse>(
      `/v3/connections/${encodeURIComponent(id)}/import`,
      {
        body: body || {},
        requestOptions: options,
      }
    );
  }

  /**
   * List documents from a connection
   *
   * @param id - Connection ID
   * @param body - List parameters
   * @param options - Request options
   * @returns Documents from the connection
   */
  listDocuments(
    id: string,
    body?: ConnectionListDocumentsParams | null,
    options?: RequestOptions
  ): APIPromise<ConnectionListDocumentsResponse> {
    return this._post<ConnectionListDocumentsResponse>(
      `/v3/connections/${encodeURIComponent(id)}/documents`,
      {
        body: body || {},
        requestOptions: options,
      }
    );
  }

  /**
   * Get available resources from a connection
   *
   * @param id - Connection ID
   * @param body - Pagination parameters
   * @param options - Request options
   * @returns Available resources
   */
  resources(
    id: string,
    body?: ConnectionResourcesParams | null,
    options?: RequestOptions
  ): APIPromise<ConnectionResourcesResponse> {
    return this.client.get<ConnectionResourcesResponse>(
      `/v3/connections/${encodeURIComponent(id)}/resources`,
      {
        query: body as Record<string, unknown> | undefined,
        requestOptions: options,
      }
    );
  }
}
