# API Key Authentication for MCP Server

This document describes the API key authentication system for the Supermemory MCP server.

## Overview

The MCP server supports optional API key authentication to secure access to tools and resources. Authentication is based on bcrypt-hashed API keys with scope-based authorization.

## Security Features

- **Bcrypt Hashing**: Keys are hashed with bcrypt (cost factor 10+), never stored in plaintext
- **Key Prefix**: All keys use the `sk-mem_` prefix for easy identification
- **Scope-Based Authorization**: Fine-grained permissions (read, write, admin)
- **Expiration Support**: Keys can have expiration dates
- **Revocation**: Keys can be revoked instantly
- **Audit Logging**: Last used timestamps and metadata tracking
- **Usage Tracking**: Monitor when keys are accessed

## Enabling Authentication

Set the `MCP_AUTH_ENABLED` environment variable to enable authentication:

```bash
export MCP_AUTH_ENABLED=true
```

When disabled (default), the MCP server operates without authentication checks.

## API Key Format

API keys follow this format:

```
sk-mem_<base64url-encoded-random-bytes>
```

Example: `sk-mem_7kRx2P4vN9qL8mK3jH5gF6dS1aW0zY`

The key provides 256 bits of entropy (32 bytes).

## Scopes

Three permission levels are supported:

| Scope | Description | Operations |
|-------|-------------|------------|
| `read` | Read-only access | search, list, recall, profile (get) |
| `write` | Write access | add, remember, profile (update/ingest) |
| `admin` | Full access | delete, key management |

Admin scope grants access to all operations.

## Creating API Keys

### Using MCP Tools (Admin Required)

```typescript
// Create a read-only key
{
  "tool": "supermemory_create_api_key",
  "arguments": {
    "name": "Read-Only Key",
    "scopes": ["read"]
  }
}

// Create a key with expiration
{
  "tool": "supermemory_create_api_key",
  "arguments": {
    "name": "Temporary Key",
    "scopes": ["read", "write"],
    "expiresInDays": 30
  }
}

// Create an admin key
{
  "tool": "supermemory_create_api_key",
  "arguments": {
    "name": "Admin Key",
    "scopes": ["admin"]
  }
}
```

### Using the Auth Service Directly

```typescript
import { createApiKey } from './services/auth.service.js';

const { apiKey, plaintextKey } = await createApiKey({
  name: 'My API Key',
  scopes: ['read', 'write'],
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  metadata: {
    project: 'my-project',
    environment: 'production',
  },
});

console.log('API Key:', plaintextKey);
// Save plaintextKey securely - it won't be shown again!
```

## Using API Keys

### HTTP Headers

Provide the API key in one of two ways:

#### X-API-Key Header (Recommended)

```http
X-API-Key: sk-mem_your_api_key_here
```

#### Authorization Bearer Header

```http
Authorization: Bearer sk-mem_your_api_key_here
```

### MCP Request Example

```typescript
const request = {
  method: 'tools/call',
  params: {
    name: 'supermemory_search',
    arguments: {
      query: 'my search query',
    },
    _meta: {
      headers: {
        'x-api-key': 'sk-mem_your_api_key_here',
      },
    },
  },
};
```

## Managing API Keys

### List Keys

```typescript
// List active keys only (default)
{
  "tool": "supermemory_list_api_keys",
  "arguments": {}
}

// Include revoked and expired keys
{
  "tool": "supermemory_list_api_keys",
  "arguments": {
    "includeRevoked": true,
    "includeExpired": true
  }
}
```

### Revoke a Key

```typescript
{
  "tool": "supermemory_revoke_api_key",
  "arguments": {
    "id": "api-key-uuid"
  }
}
```

### Rotate a Key

Creates a new key with the same scopes and revokes the old one:

```typescript
{
  "tool": "supermemory_rotate_api_key",
  "arguments": {
    "id": "old-api-key-uuid",
    "newName": "Rotated Key (optional)"
  }
}
```

## Database Schema

The `api_keys` table stores hashed keys:

```sql
CREATE TABLE "api_keys" (
  "id" uuid PRIMARY KEY,
  "key_hash" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "scopes" jsonb DEFAULT '["read"]'::jsonb NOT NULL,
  "expires_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "revoked" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

## Tool Authorization Requirements

| Tool | Required Scope |
|------|---------------|
| `supermemory_search` | `read` |
| `supermemory_list` | `read` |
| `supermemory_recall` | `read` |
| `supermemory_profile` (get) | `read` |
| `supermemory_add` | `write` |
| `supermemory_remember` | `write` |
| `supermemory_delete` | `admin` |
| `supermemory_create_api_key` | `admin` |
| `supermemory_revoke_api_key` | `admin` |
| `supermemory_list_api_keys` | `admin` |
| `supermemory_rotate_api_key` | `admin` |

## Error Responses

### Missing API Key

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "API key required. Provide X-API-Key header or Authorization: Bearer header."
  }]
}
```

### Invalid API Key

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "Invalid API key"
  }]
}
```

### Insufficient Permissions

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "Missing required scope: admin"
  }]
}
```

## Best Practices

1. **Store Keys Securely**
   - Save the plaintext key immediately when created
   - Store in environment variables or secure key management systems
   - Never commit keys to version control

2. **Use Minimal Scopes**
   - Grant only the permissions needed for each use case
   - Use read-only keys for search/retrieval operations
   - Reserve admin keys for key management only

3. **Set Expiration Dates**
   - Use temporary keys for short-term access
   - Rotate long-lived keys periodically

4. **Monitor Usage**
   - Review `lastUsedAt` timestamps regularly
   - Audit key usage through metadata
   - Revoke unused keys

5. **Rotate Keys Regularly**
   - Rotate keys when team members leave
   - Rotate if key may be compromised
   - Use the rotate endpoint for zero-downtime rotation

## Integration with Rate Limiting

API keys integrate with the existing rate limiter. Rate limits are applied based on:
- Tool-specific limits (per key)
- Global limits (per key)

See `src/mcp/rateLimit.ts` for rate limit configuration.

## Testing

Run the authentication test suite:

```bash
npm test tests/services/auth.service.test.ts
npm test tests/mcp/auth.test.ts
```

## Migration

To enable API key authentication on an existing deployment:

1. Run the migration:
   ```bash
   npm run migrate
   ```

2. Create an initial admin key:
   ```typescript
   const { plaintextKey } = await createApiKey({
     name: 'Initial Admin Key',
     scopes: ['admin'],
   });
   console.log('Admin Key:', plaintextKey);
   ```

3. Enable authentication:
   ```bash
   export MCP_AUTH_ENABLED=true
   ```

4. Update clients to use the API key

## Security Considerations

- **Bcrypt Cost Factor**: Set to 10 for balance between security and performance
- **Key Entropy**: 256 bits provides sufficient randomness
- **Hash Storage**: Only bcrypt hashes are stored, never plaintext
- **Timing Attacks**: Bcrypt comparison is constant-time
- **Expiration**: Keys are checked for expiration on every request
- **Revocation**: Instant - revoked keys fail immediately

## Troubleshooting

### Authentication Always Fails

- Check `MCP_AUTH_ENABLED` is set to `true`
- Verify key hasn't expired
- Confirm key hasn't been revoked
- Check key prefix is `sk-mem_`

### Insufficient Permissions

- Review tool scope requirements
- Check API key scopes in database
- Verify admin scope for key management operations

### Key Not Found After Creation

- Ensure database connection is working
- Check migration has been run
- Verify `api_keys` table exists
