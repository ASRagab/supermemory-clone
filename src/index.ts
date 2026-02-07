import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { timing } from 'hono/timing';
import pkg from 'pg';
import { config } from './config/index.js';
import { getDatabase } from './db/client.js';

// Import route modules
import { documentsRouter } from './api/routes/documents.js';
import { searchRouter } from './api/routes/search.js';
import { profilesRouter } from './api/routes/profiles.js';
import { authMiddleware } from './api/middleware/auth.js';
import { errorHandlerMiddleware } from './api/middleware/errorHandler.js';
import { standardRateLimit } from './api/middleware/rateLimit.js';
import { setCsrfCookie, csrfProtection } from './api/middleware/csrf.js';
import { initializeAndValidate } from './startup.js';

const { Pool } = pkg;

// Initialize database
const db = getDatabase();

let healthPool: pkg.Pool | null = null;

function getHealthPool(): pkg.Pool {
  if (!healthPool) {
    healthPool = new Pool({
      connectionString: config.databaseUrl,
      max: 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  return healthPool;
}

// Create Hono app
const app = new Hono();

// ============================================================================
// Global Middleware
// ============================================================================

// Error handler (must be first to catch all errors)
app.use('*', errorHandlerMiddleware);

// Request logging
app.use('*', logger());

// CORS configuration
app.use(
  '*',
  cors({
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'],
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    credentials: true,
    maxAge: 86400,
  })
);

// Pretty JSON responses in development
if (process.env.NODE_ENV !== 'production') {
  app.use('*', prettyJSON());
}

// Request timing
app.use('*', timing());

// ============================================================================
// Health Check (No Auth Required)
// ============================================================================

app.get('/health', async (c) => {
  const checks = {
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  };

  try {
    const pool = getHealthPool();
    await pool.query('SELECT 1');
  } catch {
    checks.status = 'unhealthy';
  }

  const statusCode = checks.status === 'healthy' ? 200 : 503;
  return c.json(checks, statusCode);
});

app.get('/', (c) => {
  return c.json({
    name: 'Supermemory Clone API',
    version: '1.0.0',
    description: 'Personal AI memory assistant with semantic search',
    endpoints: {
      documents: '/api/v1/documents',
      search: '/api/v1/search',
      profiles: '/api/v1/profiles',
    },
  });
});

// CSRF token endpoint for SPA clients
// Apply CSRF cookie middleware to provide token
app.get('/api/v1/csrf-token', setCsrfCookie(), (c) => {
  const csrfToken = c.get('csrfToken');

  return c.json({
    csrfToken,
    expiresIn: 3600, // 1 hour in seconds
  });
});

// ============================================================================
// API Routes (Auth Required)
// ============================================================================

const api = new Hono();

// Apply middleware stack to all API routes
// Order: auth → CSRF → rate limit → routes
api.use('*', authMiddleware);
api.use('*', setCsrfCookie());
api.use(
  '*',
  csrfProtection({
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:5173',
    ],
  })
);
api.use('*', standardRateLimit);

// Mount route modules
api.route('/documents', documentsRouter);
api.route('/search', searchRouter);
api.route('/profiles', profilesRouter);

// Mount API under versioned path
app.route('/api/v1', api);

// ============================================================================
// 404 Handler
// ============================================================================

app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
      status: 404,
    },
    404
  );
});

// ============================================================================
// Error Handler
// ============================================================================

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
      },
      status: 500,
    },
    500
  );
});

// ============================================================================
// Start Server
// ============================================================================

const port = config.apiPort;
const host = config.apiHost;

console.log(`
================================================
  Supermemory Clone API Server
================================================
  Version:     1.0.0
  Port:        ${port}
  Host:        ${host}
  Environment: ${process.env.NODE_ENV ?? 'development'}
================================================

Available endpoints:
  GET  /                          - API info
  GET  /health                    - Health check

  POST /api/v1/documents          - Create document
  GET  /api/v1/documents          - List documents
  GET  /api/v1/documents/:id      - Get document
  PUT  /api/v1/documents/:id      - Update document
  DELETE /api/v1/documents/:id    - Delete document
  POST /api/v1/documents/file     - Upload file
  POST /api/v1/documents/bulk-delete - Bulk delete

  POST /api/v1/search             - Search documents

  GET  /api/v1/profiles           - List profiles
  GET  /api/v1/profiles/:tag      - Get profile
  PUT  /api/v1/profiles/:tag      - Update profile
  DELETE /api/v1/profiles/:tag    - Delete profile
`);

async function startServer(): Promise<void> {
  await initializeAndValidate();

  serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });
}

startServer().catch((error) => {
  console.error('Failed to start API server:', error);
  process.exit(1);
});

export { app, db };
