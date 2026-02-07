import { Context, MiddlewareHandler } from 'hono';
import { AuthContext, ErrorCodes } from '../../types/api.types.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger('auth-middleware');

/**
 * API key configuration loaded from environment variables.
 *
 * Environment variable format:
 *   SUPERMEMORY_API_KEYS=key1:user1:read,write;key2:user2:read
 *
 * Each key is formatted as: apiKey:userId:scope1,scope2
 * Multiple keys are separated by semicolons.
 *
 * Falls back to test keys in development if not configured.
 */
function loadApiKeys(): Map<string, AuthContext> {
  const apiKeysEnv = process.env.SUPERMEMORY_API_KEYS;

  if (apiKeysEnv) {
    const keys = new Map<string, AuthContext>();

    // Parse environment variable format: key1:user1:read,write;key2:user2:read
    const entries = apiKeysEnv.split(';').filter((e) => e.trim());

    for (const entry of entries) {
      const parts = entry.trim().split(':');
      if (parts.length >= 2) {
        const apiKey = parts[0]?.trim();
        const userId = parts[1]?.trim();
        const scopes = parts[2]?.split(',').map((s) => s.trim()) ?? ['read'];

        if (apiKey && userId) {
          keys.set(apiKey, { userId, apiKey, scopes });
        }
      }
    }

    if (keys.size > 0) {
      return keys;
    }
  }

  // Fall back to test keys in development mode only
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('Using development test API keys - set SUPERMEMORY_API_KEYS in production');
    return new Map<string, AuthContext>([
      [
        'test-api-key-123',
        { userId: 'user-1', apiKey: 'test-api-key-123', scopes: ['read', 'write'] },
      ],
      ['read-only-key-456', { userId: 'user-2', apiKey: 'read-only-key-456', scopes: ['read'] }],
    ]);
  }

  // In production without configured keys, return empty map (all requests will fail auth)
  logger.error('CRITICAL: No API keys configured - set SUPERMEMORY_API_KEYS environment variable');
  return new Map();
}

// Load API keys from environment on module initialization
const VALID_API_KEYS = loadApiKeys();

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

/**
 * Bearer token authentication middleware.
 * Validates the Authorization header and attaches auth context to the request.
 */
export const authMiddleware: MiddlewareHandler = async (c: Context, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json(
      {
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Authorization header is required',
        },
        status: 401,
      },
      401
    );
  }

  if (!authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Invalid authorization format. Use Bearer token',
        },
        status: 401,
      },
      401
    );
  }

  const token = authHeader.slice(7);

  if (!token) {
    return c.json(
      {
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'API key is required',
        },
        status: 401,
      },
      401
    );
  }

  // Validate the API key
  const authContext = VALID_API_KEYS.get(token);

  if (!authContext) {
    return c.json(
      {
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Invalid API key',
        },
        status: 401,
      },
      401
    );
  }

  // Attach auth context to the request
  c.set('auth', authContext);

  return next();
};

/**
 * Scope-based authorization middleware.
 * Checks if the authenticated user has the required scopes.
 */
export const requireScopes = (...requiredScopes: string[]): MiddlewareHandler => {
  return async (c: Context, next) => {
    const auth = c.get('auth');

    if (!auth) {
      return c.json(
        {
          error: {
            code: ErrorCodes.UNAUTHORIZED,
            message: 'Authentication required',
          },
          status: 401,
        },
        401
      );
    }

    const hasAllScopes = requiredScopes.every((scope) => auth.scopes.includes(scope));

    if (!hasAllScopes) {
      return c.json(
        {
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: `Insufficient permissions. Required scopes: ${requiredScopes.join(', ')}`,
          },
          status: 403,
        },
        403
      );
    }

    return next();
  };
};
