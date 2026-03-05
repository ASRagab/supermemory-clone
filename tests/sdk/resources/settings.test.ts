/**
 * Settings Resource Tests
 *
 * Tests for the Settings resource operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Settings } from '../../../src/sdk/resources/settings.js'
import { HTTPClient } from '../../../src/sdk/http.js'

describe('Settings Resource', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let client: HTTPClient
  let settings: Settings

  beforeEach(() => {
    mockFetch = vi.fn()
    client = new HTTPClient({ apiKey: 'test-key', fetch: mockFetch })
    settings = new Settings(client)
  })

  describe('get()', () => {
    it('should get organization settings', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizationId: 'org-123',
            defaultContainerTag: 'default',
            webhookUrl: 'https://webhook.example.com',
            enableAutoSync: true,
            syncInterval: 3600,
          })
        )
      )

      const result = await settings.get()

      expect(result.organizationId).toBe('org-123')
      expect(result.defaultContainerTag).toBe('default')
      expect(result.enableAutoSync).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/settings'),
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('should handle settings with metadata', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizationId: 'org-123',
            metadata: {
              customField: 'value',
              features: ['feature-a', 'feature-b'],
            },
          })
        )
      )

      const result = await settings.get()

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.customField).toBe('value')
    })

    it('should pass request options', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ organizationId: 'org-123' })))

      await settings.get({ headers: { 'X-Custom': 'value' } })

      const headers = mockFetch.mock.calls[0][1].headers
      expect(headers.get('X-Custom')).toBe('value')
    })
  })

  describe('update()', () => {
    it('should update settings via PATCH', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizationId: 'org-123',
            defaultContainerTag: 'new-default',
            enableAutoSync: false,
          })
        )
      )

      const result = await settings.update({
        defaultContainerTag: 'new-default',
        enableAutoSync: false,
      })

      expect(result.defaultContainerTag).toBe('new-default')
      expect(result.enableAutoSync).toBe(false)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/settings'),
        expect.objectContaining({ method: 'PATCH' })
      )
    })

    it('should update webhook URL', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizationId: 'org-123',
            webhookUrl: 'https://new-webhook.example.com',
          })
        )
      )

      await settings.update({
        webhookUrl: 'https://new-webhook.example.com',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            webhookUrl: 'https://new-webhook.example.com',
          }),
        })
      )
    })

    it('should update sync interval', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizationId: 'org-123',
            syncInterval: 7200,
          })
        )
      )

      await settings.update({ syncInterval: 7200 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ syncInterval: 7200 }),
        })
      )
    })

    it('should update metadata', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizationId: 'org-123',
            metadata: { key: 'new-value' },
          })
        )
      )

      await settings.update({
        metadata: { key: 'new-value' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ metadata: { key: 'new-value' } }),
        })
      )
    })

    it('should update multiple settings at once', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizationId: 'org-123',
            defaultContainerTag: 'project',
            enableAutoSync: true,
            syncInterval: 1800,
          })
        )
      )

      await settings.update({
        defaultContainerTag: 'project',
        enableAutoSync: true,
        syncInterval: 1800,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            defaultContainerTag: 'project',
            enableAutoSync: true,
            syncInterval: 1800,
          }),
        })
      )
    })

    it('should pass request options', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ organizationId: 'org-123' })))

      await settings.update({ enableAutoSync: true }, { headers: { 'X-Custom': 'value' } })

      const headers = mockFetch.mock.calls[0][1].headers
      expect(headers.get('X-Custom')).toBe('value')
    })
  })

  describe('error handling', () => {
    it('should propagate errors from client', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))

      await expect(settings.get()).rejects.toThrow()
    })

    it('should handle update errors', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Invalid settings' }), { status: 400 }))

      await expect(settings.update({ syncInterval: -1 })).rejects.toThrow()
    })
  })
})
