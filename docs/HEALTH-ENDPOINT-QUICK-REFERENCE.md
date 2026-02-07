# Health Endpoint - Quick Reference

## Quick Test Commands

### Local Testing
```bash
# Test health endpoint
curl -s http://localhost:3000/health | jq .

# Check HTTP status code
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health

# Run automated tests
./scripts/test-health-endpoint.sh
```

### Docker Testing
```bash
# Check container health status
docker compose ps

# View health check details
docker inspect supermemory-api --format='{{json .State.Health}}' | jq .

# Run Docker-specific tests
./scripts/test-health-endpoint.sh --docker

# Watch health status in real-time
watch -n 1 'docker compose ps'
```

## Expected Responses

### Healthy (200 OK)
```json
{
  "timestamp": "2026-02-04T12:00:00.000Z",
  "status": "healthy",
  "version": "1.0.0",
  "database": "connected",
  "uptime": 123.456
}
```

### Unhealthy (503 Service Unavailable)
```json
{
  "timestamp": "2026-02-04T12:00:00.000Z",
  "status": "unhealthy",
  "version": "1.0.0",
  "database": "disconnected",
  "uptime": 123.456
}
```

## Docker Health Check Configuration

### docker-compose.yml
```yaml
healthcheck:
  test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 10s
```

### Dockerfile
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
```

## Common Issues

### Issue: Container shows (unhealthy)
**Debug**:
```bash
docker compose logs api
docker compose exec api ls -la /app/data/
curl http://localhost:3000/health
```

### Issue: Health check times out
**Fix**: Increase timeout in docker-compose.yml
```yaml
healthcheck:
  timeout: 20s  # Increase from 10s
```

### Issue: Flapping health status
**Fix**: Increase retries and interval
```yaml
healthcheck:
  retries: 5
  interval: 60s
```

## Health Status Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 timestamp |
| `status` | string | `healthy` or `unhealthy` |
| `version` | string | Application version |
| `database` | string | `connected`, `disconnected`, or `not_initialized` |
| `uptime` | number | Process uptime in seconds |

## HTTP Status Codes

- **200**: All checks passed
- **503**: One or more checks failed

## Files Reference

| File | Description |
|------|-------------|
| `src/api/index.ts` | Health endpoint implementation (lines 54-82) |
| `src/db/index.ts` | Database module with health check support |
| `docs/HEALTH-ENDPOINT-IMPLEMENTATION.md` | Comprehensive documentation |
| `scripts/test-health-endpoint.sh` | Automated test suite |

## Monitoring Integration Examples

### Prometheus
```yaml
scrape_configs:
  - job_name: 'supermemory'
    metrics_path: '/health'
    static_configs:
      - targets: ['api:3000']
```

### Kubernetes
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30
```

### AWS ALB
- Health Check Path: `/health`
- Success Codes: `200`
- Interval: `30` seconds
- Timeout: `10` seconds

## Quick Start

1. **Start the application**:
   ```bash
   docker compose up -d api
   ```

2. **Wait for health check**:
   ```bash
   sleep 15
   ```

3. **Verify health**:
   ```bash
   docker compose ps
   curl http://localhost:3000/health
   ```

4. **Run tests**:
   ```bash
   ./scripts/test-health-endpoint.sh
   ```

## Production Checklist

- [ ] Health endpoint returns 200 for healthy state
- [ ] Database connectivity check passes
- [ ] Docker health check passes (container shows "healthy")
- [ ] Response time < 100ms
- [ ] Automated tests pass
- [ ] Load balancer configured with `/health` path
- [ ] Monitoring system scraping `/health` endpoint

## Support

For detailed documentation, see:
- `/docs/HEALTH-ENDPOINT-IMPLEMENTATION.md` - Full documentation
- `/docs/BLOCKER-5-HEALTH-ENDPOINT-COMPLETE.md` - Implementation summary
