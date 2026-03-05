/**
 * Supermemory SDK Type Definitions
 * Drop-in replacement for the official supermemory npm package
 *
 * @version 1.0.0
 * @apiVersion v1
 *
 * API Version Notes:
 * - This SDK targets API v1 endpoints (e.g., /v1/memories, /v1/search)
 * - All types are designed to be compatible with the Supermemory API v1
 * - For future API versions, create a separate types file (e.g., types.v2.ts)
 */

// ============================================================================
// Common Types
// ============================================================================

export interface Metadata {
  [key: string]: string | number | boolean | string[]
}

export interface Pagination {
  currentPage: number
  limit: number
  totalItems: number
  totalPages: number
}

export interface Chunk {
  content: string
  isRelevant: boolean
  score: number
}

// ============================================================================
// Filter Types
// ============================================================================

export interface FilterCondition {
  key: string
  value: string | number | boolean
  filterType?: 'exact' | 'contains' | 'startsWith' | 'endsWith'
  ignoreCase?: boolean
  negate?: boolean
  numericOperator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
}

export interface OrFilter {
  or: Array<FilterCondition | OrFilter | AndFilter>
}

export interface AndFilter {
  and: Array<FilterCondition | OrFilter | AndFilter>
}

export type Filter = OrFilter | AndFilter

// ============================================================================
// Add Types
// ============================================================================

export interface AddParams {
  /**
   * The content to extract and process into a document.
   * This can be a URL to a website, a PDF, an image, or a video.
   */
  content: string
  /**
   * Tag for document organization (max 100 characters, alphanumeric with hyphens/underscores)
   */
  containerTag?: string
  /**
   * @deprecated Use containerTag instead
   */
  containerTags?: string[]
  /**
   * Custom identifier (max 100 characters, alphanumeric with hyphens/underscores)
   */
  customId?: string
  /**
   * Key-value pairs for document metadata
   */
  metadata?: Metadata
}

export interface AddResponse {
  /** Unique identifier of the document */
  id: string
  /** Status of the document */
  status: string
}

// ============================================================================
// Profile Types
// ============================================================================

export interface ProfileParams {
  /**
   * Tag to filter the profile by. This can be an ID for your user,
   * a project ID, or any other identifier
   */
  containerTag: string
  /**
   * Optional search query parameter
   */
  q?: string
}

export interface ProfileMemory {
  id: string
  content: string
  createdAt: string
  updatedAt: string
  metadata?: Metadata | null
}

export interface Profile {
  /** Recent memories */
  dynamic: ProfileMemory[]
  /** Long-term relevant information */
  static: ProfileMemory[]
}

export interface SearchResultItem {
  chunks: Chunk[]
  createdAt: string
  documentId: string
  metadata: Metadata | null
  score: number
  title: string | null
  type: string | null
  updatedAt: string
  content?: string | null
  summary?: string | null
}

export interface SearchResults {
  results: SearchResultItem[]
  timing: number
  total: number
}

export interface ProfileResponse {
  profile: Profile
  searchResults?: SearchResults
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchDocumentsParams {
  /** Search query string */
  q: string
  /**
   * @deprecated Use containerTags instead
   */
  categoriesFilter?: string[]
  /** Minimum chunk relevance score threshold */
  chunkThreshold?: number
  /** Filter by container tags */
  containerTags?: string[]
  /** Filter by specific document ID */
  docId?: string
  /**
   * @deprecated Use chunkThreshold instead
   */
  documentThreshold?: number
  /** Complex filter expression */
  filters?: Filter
  /** Include full document content in results */
  includeFullDocs?: boolean
  /** Include document summaries in results */
  includeSummary?: boolean
  /** Maximum number of results */
  limit?: number
  /** Return only chunks that match the query */
  onlyMatchingChunks?: boolean
  /** Enable result reranking for better relevance */
  rerank?: boolean
  /** Rewrite query for better search */
  rewriteQuery?: boolean
}

export interface SearchDocumentsResponse {
  results: SearchResultItem[]
  timing: number
  total: number
}

export interface SearchMemoriesParams {
  /** Search query string */
  q: string
  /** Filter by container tags */
  containerTags?: string[]
  /** Complex filter expression */
  filters?: Filter
  /** Maximum number of results */
  limit?: number
  /** Enable result reranking */
  rerank?: boolean
}

export interface MemoryResult {
  id: string
  metadata: Metadata | null
  similarity: number
  updatedAt: string
  chunk?: Chunk
  chunks?: Chunk[]
  context?: string
  documents?: string[]
  memory?: string
  version?: number
}

export interface SearchMemoriesResponse {
  results: MemoryResult[]
  timing: number
  total: number
}

// Alias for execute method (same as documents)
export type SearchExecuteParams = SearchDocumentsParams
export type SearchExecuteResponse = SearchDocumentsResponse

// ============================================================================
// Document Types
// ============================================================================

export interface Document {
  id: string
  content: string
  createdAt: string
  updatedAt: string
  title?: string | null
  type?: string | null
  status: string
  metadata?: Metadata | null
  customId?: string | null
  containerTag?: string | null
  summary?: string | null
  chunks?: Chunk[]
  embedding?: number[]
  source?: string | null
}

export interface DocumentListParams {
  /** Filter by container tags */
  containerTags?: string[]
  /** Complex filter expression */
  filters?: Filter
  /** Include document content in response */
  includeContent?: boolean
  /** Maximum results per page */
  limit?: number
  /** Page number (1-indexed) */
  page?: number
  /** Sort field */
  sort?: string
  /** Sort order */
  order?: 'asc' | 'desc'
}

export interface DocumentListResponse {
  documents: Document[]
  pagination: Pagination
}

export interface DocumentUpdateParams {
  /** Updated content */
  content?: string
  /** Updated container tag */
  containerTag?: string
  /**
   * @deprecated Use containerTag instead
   */
  containerTags?: string[]
  /** Updated custom ID */
  customId?: string
  /** Updated metadata */
  metadata?: Metadata
}

export interface DocumentUpdateResponse {
  id: string
  status: string
}

export interface DocumentAddParams extends AddParams {}

export interface DocumentAddResponse extends AddResponse {}

export interface DocumentBatchAddParams {
  documents: AddParams[]
}

export interface DocumentBatchAddResponse {
  documents: AddResponse[]
  failed: Array<{
    index: number
    error: string
  }>
}

export interface DocumentDeleteBulkParams {
  /** Document IDs to delete */
  ids?: string[]
  /** Delete all documents with these container tags */
  containerTags?: string[]
}

export interface DocumentDeleteBulkResponse {
  deleted: number
  ids: string[]
}

export interface DocumentGetResponse extends Document {}

export interface DocumentListProcessingResponse {
  documents: Array<{
    id: string
    status: string
    progress?: number
    createdAt: string
  }>
}

export interface DocumentUploadFileParams {
  /** File to upload */
  file: Uploadable
  /** Container tag for organization */
  containerTag?: string
  /** Custom ID for the document */
  customId?: string
  /** Document metadata */
  metadata?: Metadata
}

export interface DocumentUploadFileResponse extends AddResponse {}

// ============================================================================
// Memory Types
// ============================================================================

export interface Memory {
  id: string
  content: string
  createdAt: string
  updatedAt: string
  metadata?: Metadata | null
  version?: number
  parentMemoryId?: string | null
  rootMemoryId?: string | null
}

export interface MemoryListParams {
  /** Filter by container tags */
  containerTags?: string[]
  /** Complex filter expression */
  filters?: Filter
  /** Include memory content in response */
  includeContent?: boolean
  /** Maximum results per page */
  limit?: number
  /** Page number (1-indexed) */
  page?: number
  /** Sort field */
  sort?: string
  /** Sort order */
  order?: 'asc' | 'desc'
}

export interface MemoryListResponse {
  memories: Memory[]
  pagination: Pagination
}

export interface MemoryAddParams extends AddParams {}

export interface MemoryAddResponse extends AddResponse {}

export interface MemoryUpdateParams {
  /** Updated content */
  content?: string
  /** Updated container tag */
  containerTag?: string
  /**
   * @deprecated Use containerTag instead
   */
  containerTags?: string[]
  /** Updated custom ID */
  customId?: string
  /** Updated metadata */
  metadata?: Metadata
}

export interface MemoryUpdateResponse {
  id: string
  status: string
}

export interface MemoryForgetParams {
  /** Memory ID to forget */
  id: string
  /** Optional reason for forgetting */
  reason?: string
}

export interface MemoryForgetResponse {
  id: string
  forgotten: boolean
}

export interface MemoryGetResponse extends Memory {}

export interface MemoryUpdateMemoryParams {
  /** Memory ID to update */
  id: string
  /** New memory content */
  memory: string
  /** Optional metadata update */
  metadata?: Metadata
}

export interface MemoryUpdateMemoryResponse {
  id: string
  createdAt: string
  memory: string
  parentMemoryId: string | null
  rootMemoryId: string | null
  version: number
}

export interface MemoryUploadFileParams extends DocumentUploadFileParams {}

export interface MemoryUploadFileResponse extends AddResponse {}

// ============================================================================
// Connection Types
// ============================================================================

export type ConnectionProvider = 'github' | 'gmail' | 'google-drive' | 'notion' | 'onedrive' | 's3' | 'web-crawler'

export interface Connection {
  id: string
  createdAt: string
  provider: ConnectionProvider | string
  documentLimit?: number
  email?: string
  expiresAt?: string
  metadata?: Metadata
}

export interface ConnectionCreateParams {
  /** Container tags for organizing connected resources */
  containerTags?: string[]
  /** Maximum documents to sync */
  documentLimit?: number
  /** Connection metadata */
  metadata?: Metadata
  /** OAuth redirect URL */
  redirectUrl?: string
}

export interface ConnectionCreateResponse {
  id: string
  authLink: string
  expiresIn: number
  redirectsTo?: string
}

export interface ConnectionListParams {
  /** Filter by container tags */
  containerTags?: string[]
}

export type ConnectionListResponse = Connection[]

export interface ConnectionConfigureParams {
  /** Resources to configure */
  resources: Array<Record<string, unknown>>
}

export interface ConnectionConfigureResponse {
  id: string
  configured: boolean
}

export interface ConnectionDeleteByIDResponse {
  id: string
  provider: string
}

export interface ConnectionDeleteByProviderParams {
  /** Container tags to filter which connections to delete */
  containerTags: string[]
}

export interface ConnectionDeleteByProviderResponse {
  id: string
  provider: string
}

export interface ConnectionGetByIDResponse extends Connection {}

export interface ConnectionGetByTagParams {
  /** Container tags to filter */
  containerTags: string[]
}

export interface ConnectionGetByTagResponse extends Connection {}

export interface ConnectionImportParams {
  /** Container tags for imported resources */
  containerTags?: string[]
}

export interface ConnectionImportResponse {
  imported: number
  failed: number
}

export interface ConnectionListDocumentsParams {
  /** Filter by container tags */
  containerTags?: string[]
}

export interface ConnectionListDocumentsResponse {
  documents: Document[]
}

export interface ConnectionResourcesParams {
  /** Page number */
  page?: number
  /** Results per page */
  per_page?: number
}

export interface ConnectionResource {
  id: string
  name: string
  type: string
  metadata?: Metadata
}

export interface ConnectionResourcesResponse {
  resources: ConnectionResource[]
  total_count?: number
}

// ============================================================================
// Settings Types
// ============================================================================

export interface Settings {
  organizationId: string
  defaultContainerTag?: string
  webhookUrl?: string
  enableAutoSync?: boolean
  syncInterval?: number
  metadata?: Metadata
}

export interface SettingUpdateParams {
  defaultContainerTag?: string
  webhookUrl?: string
  enableAutoSync?: boolean
  syncInterval?: number
  metadata?: Metadata
}

export interface SettingUpdateResponse extends Settings {}

export interface SettingGetResponse extends Settings {}

// ============================================================================
// Client Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off'

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

export interface ClientOptions {
  /** API key for authentication */
  apiKey?: string
  /** Base URL for API requests */
  baseURL?: string
  /** Request timeout in milliseconds */
  timeout?: number
  /** Maximum number of retry attempts */
  maxRetries?: number
  /** Default headers for all requests */
  defaultHeaders?: Record<string, string>
  /** Default query parameters for all requests */
  defaultQuery?: Record<string, string>
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Additional fetch options */
  fetchOptions?: RequestInit
  /** Logging level */
  logLevel?: LogLevel
  /** Custom logger instance */
  logger?: Logger
}

export interface RequestOptions {
  /** Request timeout override */
  timeout?: number
  /** Maximum retries override */
  maxRetries?: number
  /** Additional headers for this request */
  headers?: Record<string, string>
  /** Signal for request cancellation */
  signal?: AbortSignal
}

// ============================================================================
// File Upload Types
// ============================================================================

/**
 * Represents content that can be uploaded as a file
 */
export type Uploadable =
  | File
  | Blob
  | NodeJS.ReadableStream
  | Buffer
  | ArrayBuffer
  | Uint8Array
  | ReadableStream<Uint8Array>

export interface ToFileOptions {
  /** Filename for the upload */
  filename?: string
  /** Content type of the file */
  contentType?: string
  /** Last modified timestamp */
  lastModified?: number
}

// ============================================================================
// API Promise Types
// ============================================================================

/**
 * Properties for constructing an APIPromise.
 * Used internally by the SDK client to wrap async API responses.
 *
 * @template T - The expected response type after parsing
 * @internal This type is used by the SDK infrastructure and may be
 *           removed if not used in client implementation.
 *
 * @example
 * ```typescript
 * const props: APIPromiseProps<SearchResponse> = {
 *   responsePromise: fetch('/v1/search'),
 *   parseResponse: async (res) => res.json() as SearchResponse
 * };
 * ```
 */
export interface APIPromiseProps<T> {
  /** The underlying fetch promise for the API request */
  responsePromise: Promise<Response>
  /** Function to parse the raw Response into the expected type T */
  parseResponse: (response: Response) => Promise<T>
}
