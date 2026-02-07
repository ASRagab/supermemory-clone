# Authentication Configuration

Supermemory now uses a minimal bearer-token model for REST API protection.

## Modes

- `AUTH_ENABLED=false` (default): No auth required.
- `AUTH_ENABLED=true`: Require `Authorization: Bearer <AUTH_TOKEN>` on API routes.

## Environment variables

```bash
AUTH_ENABLED=false
AUTH_TOKEN=
```

When `AUTH_ENABLED=true`, set `AUTH_TOKEN` to a strong random value (16+ chars).

## Notes

- The previous API-key management subsystem has been removed.
- MCP API-key tools were removed; MCP now focuses on memory/document/profile tools.
- For trusted local environments, keep auth disabled and restrict network access at the host level.
