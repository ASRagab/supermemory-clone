/**
 * Base resource class for API resources
 */

import { HTTPClient, APIPromise } from '../http.js'
import type { RequestOptions } from '../types.js'

export abstract class APIResource {
  protected client: HTTPClient

  constructor(client: HTTPClient) {
    this.client = client
  }

  protected _get<T>(
    path: string,
    options?: { query?: Record<string, unknown>; requestOptions?: RequestOptions }
  ): APIPromise<T> {
    return this.client.get<T>(path, options)
  }

  protected _post<T>(
    path: string,
    options?: {
      body?: unknown
      query?: Record<string, unknown>
      requestOptions?: RequestOptions
    }
  ): APIPromise<T> {
    return this.client.post<T>(path, options)
  }

  protected _put<T>(
    path: string,
    options?: {
      body?: unknown
      query?: Record<string, unknown>
      requestOptions?: RequestOptions
    }
  ): APIPromise<T> {
    return this.client.put<T>(path, options)
  }

  protected _patch<T>(
    path: string,
    options?: {
      body?: unknown
      query?: Record<string, unknown>
      requestOptions?: RequestOptions
    }
  ): APIPromise<T> {
    return this.client.patch<T>(path, options)
  }

  protected _delete<T>(
    path: string,
    options?: {
      body?: unknown
      query?: Record<string, unknown>
      requestOptions?: RequestOptions
    }
  ): APIPromise<T> {
    return this.client.delete<T>(path, options)
  }
}
