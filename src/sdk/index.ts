/**
 * Supermemory SDK
 * A drop-in replacement for the official supermemory npm package
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import Supermemory from './sdk';
 *
 * const client = new Supermemory({
 *   apiKey: process.env.SUPERMEMORY_API_KEY,
 * });
 *
 * // Add content
 * const doc = await client.add({ content: 'Hello, world!' });
 *
 * // Search documents
 * const results = await client.search.documents({ q: 'hello' });
 *
 * // Upload files
 * await client.documents.uploadFile({ file: myFile });
 * ```
 */

// Main client export
export { Supermemory, toFile } from './client.js'
export { Supermemory as default } from './client.js'

// HTTP utilities
export { APIPromise } from './http.js'

// Error classes
export {
  SupermemoryError,
  APIError,
  APIUserAbortError,
  APIConnectionError,
  APIConnectionTimeoutError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitError,
  InternalServerError,
  isAPIError,
  isRateLimitError,
  isRetryableError,
} from './errors.js'

// Type exports
export type {
  // Client types
  ClientOptions,
  RequestOptions,
  LogLevel,
  Logger,
  Uploadable,
  ToFileOptions,

  // Common types
  Metadata,
  Pagination,
  Chunk,
  Filter,
  OrFilter,
  AndFilter,
  FilterCondition,

  // Add types
  AddParams,
  AddResponse,

  // Profile types
  ProfileParams,
  ProfileResponse,
  Profile,
  ProfileMemory,

  // Search types
  SearchDocumentsParams,
  SearchDocumentsResponse,
  SearchMemoriesParams,
  SearchMemoriesResponse,
  SearchExecuteParams,
  SearchExecuteResponse,
  SearchResultItem,
  SearchResults,
  MemoryResult,

  // Document types
  Document,
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

  // Memory types
  Memory,
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

  // Connection types
  Connection,
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
  ConnectionResource,
  ConnectionResourcesResponse,

  // Settings types
  Settings,
  SettingUpdateParams,
  SettingUpdateResponse,
  SettingGetResponse,
} from './types.js'

// Namespace for type convenience (matches official SDK pattern)
// Types are available both at module level and under Supermemory namespace
import type * as Types from './types.js'

export namespace Supermemory {
  // Re-export all types under the Supermemory namespace
  export type ClientOptions = Types.ClientOptions
  export type RequestOptions = Types.RequestOptions
  export type LogLevel = Types.LogLevel
  export type Logger = Types.Logger
  export type Uploadable = Types.Uploadable
  export type ToFileOptions = Types.ToFileOptions
  export type Metadata = Types.Metadata
  export type Pagination = Types.Pagination
  export type Chunk = Types.Chunk
  export type Filter = Types.Filter
  export type OrFilter = Types.OrFilter
  export type AndFilter = Types.AndFilter
  export type FilterCondition = Types.FilterCondition
  export type AddParams = Types.AddParams
  export type AddResponse = Types.AddResponse
  export type ProfileParams = Types.ProfileParams
  export type ProfileResponse = Types.ProfileResponse
  export type Profile = Types.Profile
  export type ProfileMemory = Types.ProfileMemory
  export type SearchDocumentsParams = Types.SearchDocumentsParams
  export type SearchDocumentsResponse = Types.SearchDocumentsResponse
  export type SearchMemoriesParams = Types.SearchMemoriesParams
  export type SearchMemoriesResponse = Types.SearchMemoriesResponse
  export type SearchExecuteParams = Types.SearchExecuteParams
  export type SearchExecuteResponse = Types.SearchExecuteResponse
  export type SearchResultItem = Types.SearchResultItem
  export type SearchResults = Types.SearchResults
  export type MemoryResult = Types.MemoryResult
  export type Document = Types.Document
  export type DocumentListParams = Types.DocumentListParams
  export type DocumentListResponse = Types.DocumentListResponse
  export type DocumentUpdateParams = Types.DocumentUpdateParams
  export type DocumentUpdateResponse = Types.DocumentUpdateResponse
  export type DocumentAddParams = Types.DocumentAddParams
  export type DocumentAddResponse = Types.DocumentAddResponse
  export type DocumentBatchAddParams = Types.DocumentBatchAddParams
  export type DocumentBatchAddResponse = Types.DocumentBatchAddResponse
  export type DocumentDeleteBulkParams = Types.DocumentDeleteBulkParams
  export type DocumentDeleteBulkResponse = Types.DocumentDeleteBulkResponse
  export type DocumentGetResponse = Types.DocumentGetResponse
  export type DocumentListProcessingResponse = Types.DocumentListProcessingResponse
  export type DocumentUploadFileParams = Types.DocumentUploadFileParams
  export type DocumentUploadFileResponse = Types.DocumentUploadFileResponse
  export type Memory = Types.Memory
  export type MemoryListParams = Types.MemoryListParams
  export type MemoryListResponse = Types.MemoryListResponse
  export type MemoryAddParams = Types.MemoryAddParams
  export type MemoryAddResponse = Types.MemoryAddResponse
  export type MemoryUpdateParams = Types.MemoryUpdateParams
  export type MemoryUpdateResponse = Types.MemoryUpdateResponse
  export type MemoryForgetParams = Types.MemoryForgetParams
  export type MemoryForgetResponse = Types.MemoryForgetResponse
  export type MemoryGetResponse = Types.MemoryGetResponse
  export type MemoryUpdateMemoryParams = Types.MemoryUpdateMemoryParams
  export type MemoryUpdateMemoryResponse = Types.MemoryUpdateMemoryResponse
  export type MemoryUploadFileParams = Types.MemoryUploadFileParams
  export type MemoryUploadFileResponse = Types.MemoryUploadFileResponse
  export type Connection = Types.Connection
  export type ConnectionProvider = Types.ConnectionProvider
  export type ConnectionCreateParams = Types.ConnectionCreateParams
  export type ConnectionCreateResponse = Types.ConnectionCreateResponse
  export type ConnectionListParams = Types.ConnectionListParams
  export type ConnectionListResponse = Types.ConnectionListResponse
  export type ConnectionConfigureParams = Types.ConnectionConfigureParams
  export type ConnectionConfigureResponse = Types.ConnectionConfigureResponse
  export type ConnectionDeleteByIDResponse = Types.ConnectionDeleteByIDResponse
  export type ConnectionDeleteByProviderParams = Types.ConnectionDeleteByProviderParams
  export type ConnectionDeleteByProviderResponse = Types.ConnectionDeleteByProviderResponse
  export type ConnectionGetByIDResponse = Types.ConnectionGetByIDResponse
  export type ConnectionGetByTagParams = Types.ConnectionGetByTagParams
  export type ConnectionGetByTagResponse = Types.ConnectionGetByTagResponse
  export type ConnectionImportParams = Types.ConnectionImportParams
  export type ConnectionImportResponse = Types.ConnectionImportResponse
  export type ConnectionListDocumentsParams = Types.ConnectionListDocumentsParams
  export type ConnectionListDocumentsResponse = Types.ConnectionListDocumentsResponse
  export type ConnectionResourcesParams = Types.ConnectionResourcesParams
  export type ConnectionResource = Types.ConnectionResource
  export type ConnectionResourcesResponse = Types.ConnectionResourcesResponse
  export type Settings = Types.Settings
  export type SettingUpdateParams = Types.SettingUpdateParams
  export type SettingUpdateResponse = Types.SettingUpdateResponse
  export type SettingGetResponse = Types.SettingGetResponse
}
