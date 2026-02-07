/**
 * MCP Authentication Middleware
 *
 * Provides API key authentication for MCP server requests.
 *
 * Authentication Flow:
 * 1. Extract X-API-Key header from request
 * 2. Validate key using auth service
 * 3. Check expiration and revocation status
 * 4. Attach key info to request context
 *
 * Security Features:
 * - Bcrypt hash verification
 * - Expiration checking
 * - Revocation support
 * - Usage tracking
 * - Scope-based authorization
 */

import { validateApiKey, hasScope, type ApiKey } from '../services/auth.service.js';

/**
 * Authentication result
 */
export interface AuthResult {
  /** Whether authentication succeeded */
  authenticated: boolean;
  /** The authenticated API key (if successful) */
  apiKey?: ApiKey;
  /** Error message (if failed) */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: 'MISSING_KEY' | 'INVALID_KEY' | 'EXPIRED_KEY' | 'REVOKED_KEY';
}

/**
 * Extract API key from MCP request headers
 *
 * Supports multiple header formats:
 * - X-API-Key: sk-mem_...
 * - Authorization: Bearer sk-mem_...
 *
 * @param headers - Request headers object
 * @returns The API key or null if not found
 */
export function extractApiKey(
  headers?: Record<string, string | string[] | undefined>
): string | null {
  if (!headers) {
    return null;
  }

  // Try X-API-Key header first (recommended)
  const apiKeyHeader = headers['x-api-key'] ?? headers['X-API-Key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader) {
    return apiKeyHeader.trim();
  }

  // Fall back to Authorization: Bearer header
  const authHeader = headers['authorization'] ?? headers['Authorization'];
  if (typeof authHeader === 'string' && authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Authenticate an MCP request
 *
 * @param headers - Request headers
 * @returns Authentication result
 */
export async function authenticateRequest(
  headers?: Record<string, string | string[] | undefined>
): Promise<AuthResult> {
  // Extract API key from headers
  const key = extractApiKey(headers);

  if (!key) {
    return {
      authenticated: false,
      error: 'API key required. Provide X-API-Key header or Authorization: Bearer header.',
      errorCode: 'MISSING_KEY',
    };
  }

  // Validate the key
  const apiKey = await validateApiKey(key);

  if (!apiKey) {
    return {
      authenticated: false,
      error: 'Invalid API key',
      errorCode: 'INVALID_KEY',
    };
  }

  // Key is valid
  return {
    authenticated: true,
    apiKey,
  };
}

/**
 * Check if authenticated request has required scopes
 *
 * @param authResult - The authentication result
 * @param requiredScopes - Scopes required for this operation
 * @returns Authorization result
 */
export function authorizeRequest(
  authResult: AuthResult,
  requiredScopes: string[]
): { authorized: boolean; error?: string } {
  if (!authResult.authenticated || !authResult.apiKey) {
    return {
      authorized: false,
      error: 'Authentication required',
    };
  }

  // Check each required scope
  for (const scope of requiredScopes) {
    if (!hasScope(authResult.apiKey, scope)) {
      return {
        authorized: false,
        error: `Missing required scope: ${scope}`,
      };
    }
  }

  return { authorized: true };
}

/**
 * Get scope requirements for MCP tools
 *
 * Maps tool names to required scopes.
 */
export const TOOL_SCOPES: Record<string, string[]> = {
  // Read operations
  supermemory_search: ['read'],
  supermemory_list: ['read'],
  supermemory_recall: ['read'],
  supermemory_profile: ['read'], // Getting profile requires read

  // Write operations
  supermemory_add: ['write'],
  supermemory_remember: ['write'],

  // Admin operations
  supermemory_delete: ['admin'],

  // Key management (admin only)
  supermemory_create_api_key: ['admin'],
  supermemory_revoke_api_key: ['admin'],
  supermemory_list_api_keys: ['admin'],
  supermemory_rotate_api_key: ['admin'],
};

/**
 * Get required scopes for a tool
 *
 * @param toolName - The MCP tool name
 * @returns Array of required scopes
 */
export function getToolScopes(toolName: string): string[] {
  return TOOL_SCOPES[toolName] ?? ['read'];
}

/**
 * Format authentication error for MCP response
 *
 * @param authResult - The authentication result
 * @returns MCP-compatible error response
 */
export function formatAuthError(authResult: AuthResult): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: 'text',
        text: authResult.error ?? 'Authentication failed',
      },
    ],
    isError: true,
  };
}

/**
 * Format authorization error for MCP response
 *
 * @param error - The authorization error message
 * @returns MCP-compatible error response
 */
export function formatAuthzError(error: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: 'text',
        text: error,
      },
    ],
    isError: true,
  };
}
