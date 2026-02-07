import { Context, MiddlewareHandler } from 'hono';
import { AuthContext, ErrorCodes } from '../../types/api.types.js';

function isAuthEnabled(): boolean {
  const raw = process.env.AUTH_ENABLED;
  return raw === 'true' || raw === '1';
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

/**
 * Minimal optional bearer-token auth middleware.
 * - AUTH_ENABLED=false (default): pass-through
 * - AUTH_ENABLED=true: require Authorization: Bearer <AUTH_TOKEN>
 */
export const authMiddleware: MiddlewareHandler = async (c: Context, next) => {
  if (!isAuthEnabled()) {
    c.set('auth', { userId: 'anonymous', apiKey: '', scopes: ['*'] });
    return next();
  }

  const configuredToken = process.env.AUTH_TOKEN;
  if (!configuredToken) {
    return c.json(
      {
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: 'AUTH_TOKEN is required when AUTH_ENABLED=true',
        },
        status: 500,
      },
      500
    );
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      {
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Authorization header is required (Bearer token)',
        },
        status: 401,
      },
      401
    );
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token !== configuredToken) {
    return c.json(
      {
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Invalid authentication token',
        },
        status: 401,
      },
      401
    );
  }

  c.set('auth', { userId: 'authenticated', apiKey: token, scopes: ['*'] });
  return next();
};

/**
 * Scope checks are intentionally no-op in minimal auth mode.
 * Kept for backward compatibility with route declarations.
 */
export const requireScopes = (..._requiredScopes: string[]): MiddlewareHandler => {
  return async (_c: Context, next) => {
    return next();
  };
};
