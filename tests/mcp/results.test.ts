import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ErrorCode as McpProtocolErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { createRateLimitErrorResponse } from '../../src/mcp/rateLimit.js'
import { createToolResponse, mapErrorToMcpError } from '../../src/mcp/results.js'
import { ValidationError } from '../../src/utils/errors.js'

describe('createToolResponse', () => {
  it('returns structured content alongside text output', () => {
    const response = createToolResponse({
      tool: 'supermemory_add',
      ok: true,
      data: { success: true, message: 'Added content successfully' },
    })

    expect(response.isError).toBeUndefined()
    expect(response.structuredContent.ok).toBe(true)
    expect(response.structuredContent.data).toEqual({ success: true, message: 'Added content successfully' })
    expect(response.content[0].text).toContain('Added content successfully')
    expect(response.content[0].text).toContain('"tool": "supermemory_add"')
  })
})

describe('mapErrorToMcpError', () => {
  it('maps zod validation failures to InvalidParams with field detail', () => {
    const schema = z.object({
      containerTag: z.string().regex(/^[a-z]+$/, 'containerTag must be lowercase letters only'),
    })

    const error = mapErrorToMcpError(schema.safeParse({ containerTag: 'INVALID_TAG' }).error)

    expect(error.code).toBe(McpProtocolErrorCode.InvalidParams)
    expect(error.message).toContain('fieldErrors=')
    expect(error.message).toContain('containerTag')
  })

  it('maps app validation errors to InvalidParams', () => {
    const error = mapErrorToMcpError(
      new ValidationError('Validation failed: missing query', { query: ['Query is required'] })
    )

    expect(error.code).toBe(McpProtocolErrorCode.InvalidParams)
    expect(error.message).toContain('fieldErrors=')
    expect(error.message).toContain('query')
  })
})

describe('createRateLimitErrorResponse', () => {
  it('returns a structured MCP error envelope', () => {
    const response = createRateLimitErrorResponse(
      {
        allowed: false,
        remaining: 0,
        resetIn: 30,
        limit: 20,
        limitType: 'tool',
      },
      'supermemory_add'
    )

    expect(response.isError).toBe(true)
    expect(response.structuredContent.ok).toBe(false)
    expect(response.structuredContent.errors[0]?.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(response.content[0].text).toContain('Try again in 30 seconds')
  })
})
