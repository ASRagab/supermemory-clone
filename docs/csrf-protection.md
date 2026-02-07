# CSRF Protection Implementation

## Overview

This document describes the Cross-Site Request Forgery (CSRF) protection implementation for the Supermemory Clone HTTP API.

## Architecture

### Components

1. **CSRF Service** (`src/services/csrf.service.ts`)
   - Token generation using `crypto.randomBytes(32)`
   - HMAC-SHA256 token signing
   - Constant-time token validation using `crypto.timingSafeEqual`
   - Token rotation support
   - Automatic token cleanup

2. **CSRF Middleware** (`src/api/middleware/csrf.ts`)
   - Double-submit cookie pattern
   - Origin/Referer validation
   - Safe method exemption (GET, HEAD, OPTIONS)
   - SameSite=Strict cookies
   - Custom configuration support

3. **API Integration** (`src/api/index.ts`)
   - CSRF token endpoint at `/api/v1/csrf-token`
   - Middleware ordering: auth → CSRF → rate limit → routes
   - CORS header configuration for X-CSRF-Token

## Security Features

### Token Generation
- **Cryptographically Secure**: Uses `crypto.randomBytes(32)` for 256-bit entropy
- **HMAC-SHA256 Signing**: Tokens are signed with HMAC-SHA256 using a secret key
- **Expiration**: Tokens expire after 1 hour by default
- **Session Association**: Optional session ID binding for additional security

### Token Validation
- **Constant-Time Comparison**: Uses `crypto.timingSafeEqual` to prevent timing attacks
- **Double-Submit Pattern**: Cookie and header tokens must match
- **Signature Verification**: HMAC signature is validated before accepting token
- **Expiration Check**: Expired tokens are automatically rejected

### Cookie Security
- **HttpOnly**: Prevents JavaScript access to cookies
- **Secure**: Set in production to require HTTPS
- **SameSite=Strict**: Prevents cross-site cookie transmission
- **Path=/**: Cookie available for all API routes

### Origin Validation
- **Whitelist**: Configurable list of allowed origins
- **Origin Header**: Validates against whitelist if present
- **Referer Header**: Falls back to referer validation
- **Production Mode**: Requires origin/referer headers in production

## Configuration

### Environment Variables

```bash
# CSRF secret key for token signing (REQUIRED in production)
# Generate with: openssl rand -base64 48
# Minimum 32 characters required
CSRF_SECRET=your-secret-key-here

# Allowed origins for CSRF validation (comma-separated)
# Should match your frontend origins
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

### Development Mode

In development (NODE_ENV !== 'production'):
- CSRF_SECRET is auto-generated if not set (with warning)
- Origin/Referer validation is relaxed when headers are missing
- Secure cookie flag is disabled for HTTP testing

### Production Mode

In production (NODE_ENV === 'production'):
- CSRF_SECRET environment variable is REQUIRED
- Origin/Referer validation is enforced
- Secure cookie flag is enabled (HTTPS required)

## API Usage

### Getting a CSRF Token

```bash
# Request a CSRF token
curl -c cookies.txt http://localhost:3000/api/v1/csrf-token

# Response:
{
  "csrfToken": "token-value-here",
  "expiresIn": 3600
}
```

### Using the CSRF Token

The token must be provided in two places (double-submit pattern):

1. **Cookie**: Automatically set by the `/api/v1/csrf-token` endpoint
2. **Header**: Include `X-CSRF-Token` header in state-changing requests

```bash
# POST request with CSRF token
curl -X POST http://localhost:3000/api/v1/documents \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: token-value-here" \
  -b cookies.txt \
  -d '{"content": "Document content"}'
```

### SPA Integration

For Single Page Applications:

```javascript
// 1. Get CSRF token on app initialization
const response = await fetch('/api/v1/csrf-token', {
  credentials: 'include' // Include cookies
});
const { csrfToken } = await response.json();

// 2. Store token in app state
sessionStorage.setItem('csrfToken', csrfToken);

// 3. Include token in all state-changing requests
fetch('/api/v1/documents', {
  method: 'POST',
  credentials: 'include', // Send cookies
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken
  },
  body: JSON.stringify({ content: 'Document content' })
});
```

### Form Integration

For traditional HTML forms:

```html
<!-- Include CSRF token as hidden field -->
<form method="POST" action="/api/v1/documents">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}" />
  <textarea name="content"></textarea>
  <button type="submit">Submit</button>
</form>
```

The middleware automatically checks for `_csrf` in form data when `Content-Type: application/x-www-form-urlencoded`.

## Protected Methods

### Safe Methods (No CSRF Required)
- GET
- HEAD
- OPTIONS

### Unsafe Methods (CSRF Required)
- POST
- PUT
- DELETE
- PATCH

## Error Responses

### Missing Cookie Token (403 Forbidden)
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "CSRF token missing in cookie"
  },
  "status": 403
}
```

### Missing Request Token (403 Forbidden)
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "CSRF token missing in request"
  },
  "status": 403
}
```

### Token Mismatch (403 Forbidden)
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "CSRF token mismatch"
  },
  "status": 403
}
```

### Invalid/Expired Token (403 Forbidden)
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Invalid or expired CSRF token"
  },
  "status": 403
}
```

### Invalid Origin (403 Forbidden)
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Invalid origin or referer"
  },
  "status": 403
}
```

## Testing

### Service Tests
```bash
npm test tests/services/csrf.service.test.ts
```

Tests cover:
- Token generation (24 tests)
- Token validation
- Token rotation
- Security features
- HMAC signing
- Factory functions

### Integration Tests
```bash
npm test tests/api/integration/csrf-api.test.ts
```

Tests cover:
- Token endpoint
- Safe/unsafe methods
- Attack prevention
- CORS integration

## Security Best Practices

### DO
✅ Generate CSRF_SECRET with at least 32 characters: `openssl rand -base64 48`
✅ Set ALLOWED_ORIGINS to match your frontend domains
✅ Use HTTPS in production (required for Secure cookies)
✅ Rotate CSRF_SECRET periodically
✅ Monitor for CSRF-related 403 errors

### DON'T
❌ Use the auto-generated secret in production
❌ Disable CSRF protection on state-changing endpoints
❌ Allow wildcard origins in production
❌ Expose CSRF tokens in URLs (use headers/cookies only)
❌ Share CSRF secrets across environments

## Performance Considerations

- **Token Storage**: In-memory Map with automatic cleanup
- **Cleanup Interval**: Every 60 seconds
- **Token Expiration**: 1 hour (configurable)
- **Signature Algorithm**: HMAC-SHA256 (fast, secure)
- **Comparison**: Constant-time (timing-attack resistant)

## Compatibility

- **MCP STDIO Transport**: CSRF protection is NOT applied to stdio transport
- **HTTP API**: Full CSRF protection enabled
- **Existing Auth**: Works with Bearer token authentication
- **Rate Limiting**: Applied after CSRF validation

## Troubleshooting

### Token Not Working

1. Check that cookies are enabled
2. Verify origin/referer headers match ALLOWED_ORIGINS
3. Ensure token hasn't expired (1 hour TTL)
4. Check that cookie and header tokens match

### CORS Issues

1. Ensure X-CSRF-Token is in allowedHeaders
2. Set credentials: 'include' in fetch requests
3. Verify origin is in CORS allowed origins

### Production Deployment

1. Set CSRF_SECRET environment variable
2. Configure ALLOWED_ORIGINS for your domains
3. Enable HTTPS for Secure cookies
4. Monitor CSRF rejection rate

## Future Enhancements

- [ ] Redis backend for distributed token storage
- [ ] Per-user token limits
- [ ] Token refresh endpoint
- [ ] Metrics and monitoring
- [ ] Rate limiting for token endpoint
- [ ] WebSocket CSRF protection

## References

- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Double Submit Cookie Pattern](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#double-submit-cookie)
- [SameSite Cookies](https://web.dev/samesite-cookies-explained/)
