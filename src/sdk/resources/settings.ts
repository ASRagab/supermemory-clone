/**
 * Settings Resource
 * Manages organization settings
 */

import { APIResource } from './base.js';
import { APIPromise } from '../http.js';
import type {
  RequestOptions,
  SettingUpdateParams,
  SettingUpdateResponse,
  SettingGetResponse,
} from '../types.js';

export class Settings extends APIResource {
  /**
   * Get organization settings
   *
   * @param options - Request options
   * @returns Current settings
   */
  get(options?: RequestOptions): APIPromise<SettingGetResponse> {
    return this.client.get<SettingGetResponse>('/v3/settings', {
      requestOptions: options,
    });
  }

  /**
   * Update organization settings
   *
   * @param body - Settings to update
   * @param options - Request options
   * @returns Updated settings
   */
  update(body: SettingUpdateParams, options?: RequestOptions): APIPromise<SettingUpdateResponse> {
    return this._patch<SettingUpdateResponse>('/v3/settings', {
      body,
      requestOptions: options,
    });
  }
}
