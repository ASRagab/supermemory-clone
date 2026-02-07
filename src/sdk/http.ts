/**
 * Supermemory SDK HTTP Client
 * Handles API requests with retry logic and error handling
 */

import {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  isRetryableError,
} from './errors.js';
import type {
  ClientOptions,
  RequestOptions,
  Uploadable,
  ToFileOptions,
  LogLevel,
  Logger,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BASE_URL = 'https://api.supermemory.ai';
const DEFAULT_TIMEOUT = 60000; // 1 minute
const DEFAULT_MAX_RETRIES = 2;

// ============================================================================
// Logger Implementation
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  off: 4,
};

class DefaultLogger implements Logger {
  private level: number;

  constructor(logLevel: LogLevel = 'warn') {
    this.level = LOG_LEVELS[logLevel];
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LOG_LEVELS.debug) {
      console.debug(`[supermemory:debug] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LOG_LEVELS.info) {
      console.info(`[supermemory:info] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LOG_LEVELS.warn) {
      console.warn(`[supermemory:warn] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level <= LOG_LEVELS.error) {
      console.error(`[supermemory:error] ${message}`, ...args);
    }
  }
}

// ============================================================================
// API Promise Implementation
// ============================================================================

/**
 * A promise that wraps API responses with additional methods
 */
export class APIPromise<T> extends Promise<T> {
  private _responsePromise: Promise<Response>;
  private _response?: Response;

  // Ensure Promise methods return regular Promises, not APIPromise instances
  static override get [Symbol.species]() {
    return Promise;
  }

  constructor(
    responsePromise: Promise<Response>,
    parseResponse: (response: Response) => Promise<T>
  ) {
    // Handle the case where constructor is called with executor function
    // (happens when Promise methods like .then() create new instances)
    if (typeof responsePromise === 'function') {
      // This is being called as a regular Promise with an executor
      super(
        responsePromise as unknown as (
          resolve: (value: T | PromiseLike<T>) => void,
          reject: (reason?: unknown) => void
        ) => void
      );
      this._responsePromise = Promise.resolve(new Response());
      return;
    }

    let resolveOuter: (value: T | PromiseLike<T>) => void;
    let rejectOuter: (reason?: unknown) => void;

    super((resolve, reject) => {
      resolveOuter = resolve;
      rejectOuter = reject;
    });

    this._responsePromise = responsePromise;

    // Execute the promise chain using Promise.resolve to ensure proper async handling
    Promise.resolve(responsePromise)
      .then(async (response) => {
        this._response = response;
        try {
          const parsed = await parseResponse(response);
          resolveOuter!(parsed);
        } catch (err) {
          rejectOuter!(err);
        }
      })
      .catch((err) => {
        rejectOuter!(err);
      });
  }

  /**
   * Get the raw Response object (available after headers are received)
   */
  asResponse(): Promise<Response> {
    return this._responsePromise;
  }

  /**
   * Get both the parsed data and raw response
   */
  async withResponse(): Promise<{ data: T; response: Response }> {
    const [data, response] = await Promise.all([this, this._responsePromise]);
    return { data, response };
  }
}

// ============================================================================
// HTTP Client Implementation
// ============================================================================

export class HTTPClient {
  private apiKey: string;
  private baseURL: string;
  private timeout: number;
  private maxRetries: number;
  private defaultHeaders: Record<string, string>;
  private defaultQuery: Record<string, string>;
  private fetchFn: typeof fetch;
  private fetchOptions: RequestInit;
  private logger: Logger;

  constructor(options: ClientOptions = {}) {
    // Determine API key from options or environment
    this.apiKey = options.apiKey || this.getEnvApiKey();
    if (!this.apiKey) {
      throw new Error(
        'API key is required. Set SUPERMEMORY_API_KEY environment variable or pass apiKey option.'
      );
    }

    this.baseURL = (options.baseURL || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.defaultHeaders = options.defaultHeaders || {};
    this.defaultQuery = options.defaultQuery || {};
    this.fetchFn = options.fetch || globalThis.fetch;
    this.fetchOptions = options.fetchOptions || {};
    this.logger = options.logger || new DefaultLogger(options.logLevel);
  }

  private getEnvApiKey(): string {
    // Check various environments for the API key
    if (typeof process !== 'undefined' && process.env) {
      return process.env.SUPERMEMORY_API_KEY || '';
    }
    // Browser environment - check for global
    if (typeof globalThis !== 'undefined') {
      const global = globalThis as Record<string, unknown>;
      if (global.SUPERMEMORY_API_KEY) {
        return String(global.SUPERMEMORY_API_KEY);
      }
    }
    return '';
  }

  /**
   * Build the full URL with query parameters
   */
  private buildURL(path: string, query?: Record<string, unknown>): string {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, this.baseURL);

    // Add default query parameters
    for (const [key, value] of Object.entries(this.defaultQuery)) {
      url.searchParams.set(key, value);
    }

    // Add request-specific query parameters
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach((v) => url.searchParams.append(key, String(v)));
          } else {
            url.searchParams.set(key, String(value));
          }
        }
      }
    }

    return url.toString();
  }

  /**
   * Build request headers
   */
  private buildHeaders(
    customHeaders?: Record<string, string>,
    hasBody?: boolean,
    isMultipart?: boolean
  ): Headers {
    const headers = new Headers();

    // Set default headers
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    headers.set('Accept', 'application/json');

    if (hasBody && !isMultipart) {
      headers.set('Content-Type', 'application/json');
    }

    // Add default headers from options
    for (const [key, value] of Object.entries(this.defaultHeaders)) {
      headers.set(key, value);
    }

    // Add custom headers
    if (customHeaders) {
      for (const [key, value] of Object.entries(customHeaders)) {
        headers.set(key, value);
      }
    }

    return headers;
  }

  /**
   * Execute a request with retry logic
   */
  private async executeWithRetry(
    method: string,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, unknown>;
      requestOptions?: RequestOptions;
      isMultipart?: boolean;
    } = {}
  ): Promise<Response> {
    const { body, query, requestOptions = {}, isMultipart } = options;
    const timeout = requestOptions.timeout ?? this.timeout;
    const maxRetries = requestOptions.maxRetries ?? this.maxRetries;

    const url = this.buildURL(path, query);
    const headers = this.buildHeaders(requestOptions.headers, body !== undefined, isMultipart);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`Request attempt ${attempt + 1}: ${method} ${url}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        // Merge signals if provided
        if (requestOptions.signal) {
          requestOptions.signal.addEventListener('abort', () => controller.abort());
        }

        const requestInit: RequestInit = {
          ...this.fetchOptions,
          method,
          headers,
          signal: controller.signal,
        };

        if (body !== undefined) {
          if (isMultipart && body instanceof FormData) {
            requestInit.body = body;
          } else {
            requestInit.body = JSON.stringify(body);
          }
        }

        const response = await this.fetchFn(url, requestInit);
        clearTimeout(timeoutId);

        this.logger.debug(`Response: ${response.status} ${response.statusText}`);

        // Return response for further processing
        return response;
      } catch (err) {
        lastError = err as Error;

        // Handle abort errors
        if (err instanceof Error && err.name === 'AbortError') {
          if (requestOptions.signal?.aborted) {
            throw new APIUserAbortError('Request was aborted by user');
          }
          throw new APIConnectionTimeoutError({ message: 'Request timed out' });
        }

        // Check if we should retry
        if (attempt < maxRetries && isRetryableError(lastError)) {
          const delay = this.calculateRetryDelay(attempt, lastError);
          this.logger.warn(`Request failed, retrying in ${delay}ms...`, lastError);
          await this.sleep(delay);
          continue;
        }

        throw new APIConnectionError({
          message: `Connection failed: ${lastError.message}`,
          cause: lastError,
        });
      }
    }

    throw new APIConnectionError({
      message: `Request failed after ${maxRetries + 1} attempts`,
      cause: lastError,
    });
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number, error?: Error): number {
    // Base delay of 500ms, doubled for each attempt
    let delay = 500 * Math.pow(2, attempt);

    // Add jitter to prevent thundering herd
    delay += Math.random() * 500;

    // Cap at 30 seconds
    delay = Math.min(delay, 30000);

    // Use retry-after header if available
    if (error && 'retryAfter' in error) {
      const retryAfter = (error as { retryAfter?: number }).retryAfter;
      if (retryAfter) {
        delay = retryAfter * 1000;
      }
    }

    return delay;
  }

  /**
   * Sleep for the specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Parse a response and handle errors
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    // Handle non-2xx responses
    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text().catch(() => undefined);
      }

      const message =
        typeof errorBody === 'object' && errorBody !== null
          ? (errorBody as Record<string, unknown>).message ||
            (errorBody as Record<string, unknown>).error
          : undefined;

      throw APIError.generate(
        response.status,
        errorBody,
        typeof message === 'string' ? message : undefined,
        response.headers
      );
    }

    // Handle empty responses
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }

    // Parse JSON response
    try {
      return (await response.json()) as T;
    } catch {
      throw new APIError(
        response.status,
        null,
        'Failed to parse response as JSON',
        response.headers
      );
    }
  }

  /**
   * Make a GET request
   */
  get<T>(
    path: string,
    options?: { query?: Record<string, unknown>; requestOptions?: RequestOptions }
  ): APIPromise<T> {
    const responsePromise = this.executeWithRetry('GET', path, options);
    return new APIPromise(responsePromise, (res) => this.parseResponse<T>(res));
  }

  /**
   * Make a POST request
   */
  post<T>(
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, unknown>;
      requestOptions?: RequestOptions;
      isMultipart?: boolean;
    }
  ): APIPromise<T> {
    const responsePromise = this.executeWithRetry('POST', path, options);
    return new APIPromise(responsePromise, (res) => this.parseResponse<T>(res));
  }

  /**
   * Make a PUT request
   */
  put<T>(
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, unknown>;
      requestOptions?: RequestOptions;
    }
  ): APIPromise<T> {
    const responsePromise = this.executeWithRetry('PUT', path, options);
    return new APIPromise(responsePromise, (res) => this.parseResponse<T>(res));
  }

  /**
   * Make a PATCH request
   */
  patch<T>(
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, unknown>;
      requestOptions?: RequestOptions;
    }
  ): APIPromise<T> {
    const responsePromise = this.executeWithRetry('PATCH', path, options);
    return new APIPromise(responsePromise, (res) => this.parseResponse<T>(res));
  }

  /**
   * Make a DELETE request
   */
  delete<T>(
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, unknown>;
      requestOptions?: RequestOptions;
    }
  ): APIPromise<T> {
    const responsePromise = this.executeWithRetry('DELETE', path, options);
    return new APIPromise(responsePromise, (res) => this.parseResponse<T>(res));
  }

  /**
   * Upload a file
   */
  uploadFile<T>(
    path: string,
    file: Uploadable,
    options?: {
      fieldName?: string;
      filename?: string;
      additionalFields?: Record<string, string>;
      requestOptions?: RequestOptions;
    }
  ): APIPromise<T> {
    const formData = new FormData();
    const fieldName = options?.fieldName || 'file';

    // Convert various file types to Blob for FormData
    if (file instanceof Blob || file instanceof File) {
      formData.append(fieldName, file, options?.filename);
    } else if (file instanceof ArrayBuffer) {
      const blob = new Blob([file]);
      formData.append(fieldName, blob, options?.filename || 'file');
    } else if (file instanceof Uint8Array) {
      const blob = new Blob([new Uint8Array(file)]);
      formData.append(fieldName, blob, options?.filename || 'file');
    } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
      const blob = new Blob([new Uint8Array(file)]);
      formData.append(fieldName, blob, options?.filename || 'file');
    } else {
      // For streams, we need to read them into a buffer first
      throw new Error(
        'Stream uploads are not supported in this context. Use toFile() to convert streams.'
      );
    }

    // Add additional form fields
    if (options?.additionalFields) {
      for (const [key, value] of Object.entries(options.additionalFields)) {
        formData.append(key, value);
      }
    }

    const responsePromise = this.executeWithRetry('POST', path, {
      body: formData,
      isMultipart: true,
      requestOptions: options?.requestOptions,
    });

    return new APIPromise(responsePromise, (res) => this.parseResponse<T>(res));
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert various input types to a File object
 */
export async function toFile(
  content: Uploadable | string,
  name?: string,
  options?: ToFileOptions
): Promise<File> {
  const filename = options?.filename || name || 'file';
  const contentType = options?.contentType || 'application/octet-stream';

  let blob: Blob;

  if (typeof content === 'string') {
    // Assume it's a path or URL
    if (typeof globalThis.fetch !== 'undefined' && content.startsWith('http')) {
      const response = await fetch(content);
      blob = await response.blob();
    } else {
      // In Node.js, would need to read file
      throw new Error('File path reading not supported in browser environment');
    }
  } else if (content instanceof File) {
    return content;
  } else if (content instanceof Blob) {
    blob = content;
  } else if (content instanceof ArrayBuffer) {
    blob = new Blob([content], { type: contentType });
  } else if (content instanceof Uint8Array) {
    blob = new Blob([new Uint8Array(content)], { type: contentType });
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(content)) {
    blob = new Blob([new Uint8Array(content)], { type: contentType });
  } else {
    throw new Error('Unsupported content type for toFile');
  }

  return new File([blob], filename, {
    type: options?.contentType || blob.type || contentType,
    lastModified: options?.lastModified,
  });
}
