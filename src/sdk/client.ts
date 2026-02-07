/**
 * Supermemory Client
 * Main entry point for the Supermemory SDK
 */

import { HTTPClient, APIPromise, toFile } from './http.js';
import { Search, Documents, Memories, Connections, Settings } from './resources/index.js';
import type {
  ClientOptions,
  RequestOptions,
  AddParams,
  AddResponse,
  ProfileParams,
  ProfileResponse,
} from './types.js';

/**
 * API Client for interfacing with the Supermemory API
 *
 * @example
 * ```typescript
 * import Supermemory from 'supermemory';
 *
 * const client = new Supermemory({
 *   apiKey: process.env.SUPERMEMORY_API_KEY,
 * });
 *
 * const response = await client.add({ content: 'Hello, world!' });
 * console.log(response.id);
 * ```
 */
export class Supermemory {
  private _client: HTTPClient;
  private _options: ClientOptions;

  // Resource instances
  readonly search: Search;
  readonly documents: Documents;
  readonly memories: Memories;
  readonly connections: Connections;
  readonly settings: Settings;

  /**
   * Create a new Supermemory client
   *
   * @param options - Client configuration options
   */
  constructor(options: ClientOptions = {}) {
    this._options = options;
    this._client = new HTTPClient(options);

    // Initialize resources
    this.search = new Search(this._client);
    this.documents = new Documents(this._client);
    this.memories = new Memories(this._client);
    this.connections = new Connections(this._client);
    this.settings = new Settings(this._client);
  }

  // ============================================================================
  // Top-Level Methods
  // ============================================================================

  /**
   * Add content to Supermemory
   *
   * This is the primary method for ingesting content. The content can be:
   * - A URL to a website, PDF, image, or video
   * - Plain text content
   * - Markdown content
   *
   * @param body - Content and metadata to add
   * @param options - Request options
   * @returns Document ID and status
   *
   * @example
   * ```typescript
   * // Add a URL
   * const response = await client.add({
   *   content: 'https://example.com/article',
   *   containerTag: 'my-project',
   * });
   *
   * // Add text content
   * const response = await client.add({
   *   content: 'This is important information to remember.',
   *   metadata: { source: 'notes', priority: 'high' },
   * });
   * ```
   */
  add(body: AddParams, options?: RequestOptions): APIPromise<AddResponse> {
    return this._client.post<AddResponse>('/v3/add', {
      body,
      requestOptions: options,
    });
  }

  /**
   * Get user profile with optional search context
   *
   * Returns both dynamic (recent) and static (long-term) memory profile
   * for a given container tag. Optionally includes search results.
   *
   * @param body - Profile parameters including container tag
   * @param options - Request options
   * @returns Profile data and optional search results
   *
   * @example
   * ```typescript
   * const profile = await client.profile({
   *   containerTag: 'user-123',
   *   q: 'preferences', // Optional search query
   * });
   *
   * console.log('Dynamic memories:', profile.profile.dynamic);
   * console.log('Static memories:', profile.profile.static);
   * ```
   */
  profile(body: ProfileParams, options?: RequestOptions): APIPromise<ProfileResponse> {
    return this._client.post<ProfileResponse>('/v3/profile', {
      body,
      requestOptions: options,
    });
  }

  // ============================================================================
  // Low-Level HTTP Methods
  // ============================================================================

  /**
   * Make a raw GET request
   *
   * @param path - API path
   * @param options - Request options
   */
  get<T>(
    path: string,
    options?: { query?: Record<string, unknown>; requestOptions?: RequestOptions }
  ): APIPromise<T> {
    return this._client.get<T>(path, options);
  }

  /**
   * Make a raw POST request
   *
   * @param path - API path
   * @param options - Request options
   */
  post<T>(
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, unknown>;
      requestOptions?: RequestOptions;
    }
  ): APIPromise<T> {
    return this._client.post<T>(path, options);
  }

  /**
   * Make a raw PUT request
   *
   * @param path - API path
   * @param options - Request options
   */
  put<T>(
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, unknown>;
      requestOptions?: RequestOptions;
    }
  ): APIPromise<T> {
    return this._client.put<T>(path, options);
  }

  /**
   * Make a raw PATCH request
   *
   * @param path - API path
   * @param options - Request options
   */
  patch<T>(
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, unknown>;
      requestOptions?: RequestOptions;
    }
  ): APIPromise<T> {
    return this._client.patch<T>(path, options);
  }

  /**
   * Make a raw DELETE request
   *
   * @param path - API path
   * @param options - Request options
   */
  delete<T>(
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, unknown>;
      requestOptions?: RequestOptions;
    }
  ): APIPromise<T> {
    return this._client.delete<T>(path, options);
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Create a new client with modified options
   *
   * @param options - Options to override
   * @returns New client instance with merged options
   *
   * @example
   * ```typescript
   * const clientWithTimeout = client.withOptions({ timeout: 30000 });
   * ```
   */
  withOptions(options: Partial<ClientOptions>): Supermemory {
    return new Supermemory({
      ...this._options,
      ...options,
    });
  }
}

// Re-export for convenience
export { toFile };
