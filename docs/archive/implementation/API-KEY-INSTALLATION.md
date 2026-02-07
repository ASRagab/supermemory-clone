# API Key Authentication - Installation Guide

Quick guide to install and enable API key authentication.

## 1. Install Dependencies

```bash
npm install
```

This will install:
- `bcrypt@^5.1.1` - Password hashing library
- `@types/bcrypt@^5.0.2` - TypeScript definitions

## 2. Run Database Migration

```bash
npm run db:migrate
```

This creates the `api_keys` table with:
- UUID primary keys
- Bcrypt hash storage
- Scopes, expiration, and metadata
- Comprehensive indexes

## 3. Build the Project

```bash
npm run build
```

## 4. Create Initial Admin Key

Create a script or run in Node.js REPL:

```typescript
import { createApiKey } from './src/services/auth.service.js';

const { plaintextKey } = await createApiKey({
  name: 'Initial Admin Key',
  scopes: ['admin'],
});

console.log('🔑 Admin API Key (SAVE THIS):');
console.log(plaintextKey);
```

Or use the MCP server (see step 6).

## 5. Enable Authentication

Add to your environment variables:

```bash
export MCP_AUTH_ENABLED=true
```

Or add to `.env` file:

```env
MCP_AUTH_ENABLED=true
```

## 6. Start the MCP Server

```bash
npm run mcp
```

## 7. Test Authentication

### Create Your First Key (via admin key)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "X-API-Key: <your-admin-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "supermemory_create_api_key",
      "arguments": {
        "name": "Read-Only Test Key",
        "scopes": ["read"],
        "expiresInDays": 30
      }
    }
  }'
```

### Test the New Key

```bash
curl -X POST http://localhost:3000/mcp \
  -H "X-API-Key: <your-read-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "supermemory_search",
      "arguments": {
        "query": "test query"
      }
    }
  }'
```

## 8. Verify Installation

Run the test suite:

```bash
# Test auth service
npm test tests/services/auth.service.test.ts

# Test MCP authentication
npm test tests/mcp/auth.test.ts

# Run all tests
npm test
```

All tests should pass.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_AUTH_ENABLED` | `false` | Enable API key authentication |
| `DATABASE_URL` | - | PostgreSQL connection string |
| `NODE_ENV` | `development` | Environment (production/development) |

## Troubleshooting

### bcrypt Installation Issues

If you encounter native compilation errors:

```bash
# Rebuild bcrypt
npm rebuild bcrypt

# Or install with specific Python version (macOS/Linux)
npm install bcrypt --python=/usr/bin/python3
```

### Migration Fails

Check PostgreSQL connection:

```bash
# Test connection
psql $DATABASE_URL

# Manually run migration
psql $DATABASE_URL < drizzle/0001_api_keys.sql
```

### Authentication Always Disabled

Verify environment variable is set:

```bash
echo $MCP_AUTH_ENABLED
# Should output: true
```

### No Admin Key

If you haven't created an admin key yet:

1. Temporarily disable auth: `export MCP_AUTH_ENABLED=false`
2. Create admin key using the service directly
3. Re-enable auth: `export MCP_AUTH_ENABLED=true`

## Next Steps

1. Read the full documentation: `docs/api-key-authentication.md`
2. Create keys for your use cases (read-only, write, admin)
3. Distribute keys to clients/users
4. Monitor usage via `lastUsedAt` timestamps
5. Set up key rotation schedule

## Security Checklist

- [ ] Run database migration
- [ ] Create initial admin key
- [ ] Store admin key securely (password manager, vault)
- [ ] Enable authentication (`MCP_AUTH_ENABLED=true`)
- [ ] Test authentication works
- [ ] Create service-specific keys (not admin)
- [ ] Set expiration dates on temporary keys
- [ ] Document key distribution process
- [ ] Set up monitoring/auditing
- [ ] Plan key rotation schedule

## Production Deployment

Additional steps for production:

1. **Use environment variables** for `MCP_AUTH_ENABLED`
2. **Store admin key** in secure vault (AWS Secrets Manager, HashiCorp Vault)
3. **Enable database backups** for api_keys table
4. **Set up monitoring** for:
   - Failed authentication attempts
   - Expired keys still in use
   - Suspicious usage patterns
5. **Create runbook** for:
   - Emergency key revocation
   - Key rotation procedures
   - Lost key recovery

## Support

- Documentation: `docs/api-key-authentication.md`
- Implementation details: `docs/API-KEY-IMPLEMENTATION-SUMMARY.md`
- Tests: `tests/services/auth.service.test.ts`, `tests/mcp/auth.test.ts`
