import { ErrorCode as McpProtocolErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ZodError } from 'zod'
import { AppError, ValidationError, ErrorCode as AppErrorCode } from '../utils/errors.js'

export interface McpEnvelopeError {
  code: string
  message: string
  details?: unknown
  retriable?: boolean
}

export interface McpResultEnvelope<T> extends Record<string, unknown> {
  ok: boolean
  data: T | null
  warnings: string[]
  errors: McpEnvelopeError[]
  meta: {
    tool: string
    timestamp: string
    partial?: boolean
  }
}

function extractHumanMessage<T>(toolName: string, data: T | null, ok: boolean): string {
  if (data && typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') {
    return data.message
  }

  return ok ? `${toolName} completed successfully.` : `${toolName} completed with errors.`
}

function formatValidationMessage(error: ValidationError): string {
  return `${error.message} | fieldErrors=${JSON.stringify(error.fieldErrors)}`
}

export function createMcpEnvelopeError(
  code: string,
  message: string,
  details?: unknown,
  retriable?: boolean
): McpEnvelopeError {
  return { code, message, details, retriable }
}

export function createToolResponse<T>(options: {
  data: T | null
  errors?: McpEnvelopeError[]
  ok: boolean
  tool: string
  warnings?: string[]
  partial?: boolean
}): CallToolResult {
  const warnings = options.warnings ?? []
  const errors = options.errors ?? []
  const envelope: McpResultEnvelope<T> = {
    ok: options.ok,
    data: options.data,
    warnings,
    errors,
    meta: {
      tool: options.tool,
      timestamp: new Date().toISOString(),
      ...(options.partial ? { partial: true } : {}),
    },
  }

  const text = `${extractHumanMessage(options.tool, options.data, options.ok)}\n\n${JSON.stringify(envelope, null, 2)}`

  return {
    content: [{ type: 'text', text }],
    structuredContent: envelope,
    ...(options.ok && errors.length === 0 ? {} : { isError: true }),
  }
}

export function mapErrorToMcpError(error: unknown): McpError {
  if (error instanceof McpError) {
    return error
  }

  if (error instanceof ZodError) {
    const validationError = ValidationError.fromZodError(error)
    return new McpError(McpProtocolErrorCode.InvalidParams, formatValidationMessage(validationError))
  }

  if (error instanceof ValidationError) {
    return new McpError(McpProtocolErrorCode.InvalidParams, formatValidationMessage(error))
  }

  if (error instanceof AppError) {
    if (error.code === AppErrorCode.NOT_FOUND || error.statusCode === 404) {
      return new McpError(McpProtocolErrorCode.InvalidRequest, error.message)
    }

    if (error.statusCode >= 400 && error.statusCode < 500) {
      return new McpError(McpProtocolErrorCode.InvalidParams, error.message)
    }

    return new McpError(McpProtocolErrorCode.InternalError, error.message)
  }

  const message = error instanceof Error ? error.message : 'Unknown error'
  return new McpError(McpProtocolErrorCode.InternalError, message)
}
