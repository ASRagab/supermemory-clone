# Health Endpoint Implementation

## Overview

The `/health` endpoint provides application health status for monitoring, load balancers, and Docker health checks. It validates critical system components and returns appropriate HTTP status codes.

## Endpoint Details

### Path
```
GET /health
```

### Authentication
None required - public endpoint

### Response Format

#### Healthy Response (200 OK)
```json
{
  "timestamp": "2026-02-04T12:00:00.000Z",
  "status": "healthy",
  "version": "1.0.0",
  "database": "connected",
  "uptime": 123.456
}
```

#### Unhealthy Response (503 Service Unavailable)
```json
{
  "timestamp": "2026-02-04T12:00:00.000Z",
  "status": "unhealthy",
  "version": "1.0.0",
  "database": "disconnected",
  "uptime": 123.456
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 timestamp of health check |
| `status` | string | Overall status: `healthy` or `unhealthy` |
| `version` | string | Application version |
| `database` | string | Database status: `connected`, `disconnected`, or `unknown` |
| `uptime` | number | Process uptime in seconds |

### Status Codes

- **200 OK**: All health checks passed
- **503 Service Unavailable**: One or more health checks failed

## Health Checks

### 1. Database Connectivity
Tests SQLite database connection by executing a simple query:
```sql
SELECT 1
```

**Pass Criteria**: Query executes without error
**Fail Criteria**: Query throws exception (file not found, permissions, corruption, etc.)

### 2. Process Uptime
Reports how long the Node.js process has been running.

**Purpose**: Detect crash loops or frequent restarts

## Docker Integration

### Docker Compose Configuration

The health endpoint is integrated with Docker health checks in `docker-compose.yml`:

```yaml
healthcheck:
  test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 10s
```

### Dockerfile Configuration

The Dockerfile includes the same health check:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
```

### Health Check Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `interval` | 30s | How often to run the check |
| `timeout` | 10s | Maximum time for check to complete |
| `retries` | 3 | Consecutive failures before marking unhealthy |
| `start_period` | 5-10s | Grace period during startup |

### Container Health States

Docker containers transition through these states:

1. **starting**: Initial state during `start_period`
2. **healthy**: Health check passes
3. **unhealthy**: Health check fails `retries` consecutive times

## Testing

### Local Testing

#### Test Healthy State
```bash
curl -v http://localhost:3000/health
```

Expected response:
```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "timestamp": "2026-02-04T12:00:00.000Z",
  "status": "healthy",
  "version": "1.0.0",
  "database": "connected",
  "uptime": 123.456
}
```

#### Test with jq (JSON formatting)
```bash
curl -s http://localhost:3000/health | jq .
```

### Docker Testing

#### Check Container Health Status
```bash
docker compose ps
```

Expected output:
```
NAME                 STATUS                    PORTS
supermemory-api      Up 2 minutes (healthy)   0.0.0.0:3000->3000/tcp
```

#### View Health Check Logs
```bash
docker inspect supermemory-api --format='{{json .State.Health}}' | jq .
```

#### Monitor Health Checks in Real-Time
```bash
docker compose events api
```

### Failure Scenario Testing

#### Simulate Database Failure

**Option 1: Corrupt database file**
```bash
# Stop container
docker compose stop api

# Corrupt database file
echo "corrupted" > ./data/supermemory.db

# Restart container
docker compose start api

# Check health
curl http://localhost:3000/health
```

Expected response:
```json
{
  "timestamp": "2026-02-04T12:00:00.000Z",
  "status": "unhealthy",
  "version": "1.0.0",
  "database": "disconnected",
  "uptime": 5.123
}
```

**Option 2: Remove database file**
```bash
docker compose exec api rm /app/data/supermemory.db
curl http://localhost:3000/health
```

#### Verify Health Check Retries
```bash
# Watch container status
watch -n 1 'docker compose ps'

# After 3 failed checks (90 seconds), status should show (unhealthy)
```

#### Recovery Test
```bash
# Fix the database
docker compose stop api
rm ./data/supermemory.db
docker compose start api

# Wait for health check to pass
sleep 35

# Verify healthy
docker compose ps
curl http://localhost:3000/health
```

## Monitoring Integration

### Prometheus Metrics
The health endpoint can be monitored by Prometheus:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'supermemory-api'
    metrics_path: '/health'
    static_configs:
      - targets: ['api:3000']
```

### Load Balancer Health Checks

#### AWS Application Load Balancer
```
Health Check Path: /health
Success Codes: 200
Interval: 30 seconds
Timeout: 10 seconds
Healthy Threshold: 2
Unhealthy Threshold: 3
```

#### NGINX Upstream Health Check
```nginx
upstream supermemory_backend {
    server api:3000 max_fails=3 fail_timeout=30s;
}

server {
    location /health {
        proxy_pass http://supermemory_backend/health;
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }
}
```

### Kubernetes Liveness/Readiness Probes

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: supermemory-api
spec:
  containers:
  - name: api
    image: supermemory-api:latest
    livenessProbe:
      httpGet:
        path: /health
        port: 3000
      initialDelaySeconds: 10
      periodSeconds: 30
      timeoutSeconds: 10
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /health
        port: 3000
      initialDelaySeconds: 5
      periodSeconds: 10
      timeoutSeconds: 5
      failureThreshold: 2
```

## Troubleshooting

### Health Check Fails Immediately on Startup

**Symptom**: Container marked unhealthy within seconds

**Solution**: Increase `start_period` to give application time to initialize:
```yaml
healthcheck:
  start_period: 30s  # Increase from 10s
```

### Health Check Times Out

**Symptom**: Health check fails with timeout error

**Causes**:
1. Application deadlocked or frozen
2. Database query hanging
3. Timeout too short for slow systems

**Solutions**:
```yaml
healthcheck:
  timeout: 20s  # Increase from 10s
```

### False Positives (Flapping Health Status)

**Symptom**: Container alternates between healthy and unhealthy

**Causes**:
1. Database connection pool exhausted
2. Resource constraints (CPU/memory)
3. Network issues

**Solutions**:
```yaml
healthcheck:
  retries: 5  # Increase from 3 to tolerate transient failures
  interval: 60s  # Reduce check frequency
```

### Database Connection Fails

**Symptom**: `"database": "disconnected"`

**Debug Steps**:
```bash
# Check database file exists
docker compose exec api ls -la /app/data/

# Check file permissions
docker compose exec api stat /app/data/supermemory.db

# Test database directly
docker compose exec api node -e "
  const Database = require('better-sqlite3');
  const db = new Database('./data/supermemory.db');
  console.log(db.prepare('SELECT 1').get());
"

# Check logs
docker compose logs api
```

### Container Shows Healthy But Application Not Responding

**Symptom**: Health endpoint returns 200 but other endpoints fail

**Cause**: Health check too simplistic

**Solution**: Enhance health check in future to include:
- Redis connectivity (if using caching)
- External API dependencies
- Queue system health
- Memory usage thresholds

## Implementation Details

### Code Location
- **File**: `/Users/ahmad.ragab/Dev/supermemory-clone/src/api/index.ts`
- **Lines**: 54-75 (approximate)

### Dependencies
```typescript
import { getDatabase } from '../db/index.js';
```

### Error Handling
The health check catches all exceptions during database testing to prevent the endpoint from crashing:

```typescript
try {
  const db = getDatabase(databaseUrl);
  db.run('SELECT 1');
  checks.database = 'connected';
} catch (error) {
  checks.database = 'disconnected';
  checks.status = 'unhealthy';
}
```

### Performance Considerations

1. **Lazy Database Import**: Database module is imported on-demand to avoid initialization issues
2. **Simple Query**: `SELECT 1` is fast and doesn't require table access
3. **No External Calls**: Health check doesn't depend on external services
4. **Minimal Processing**: Returns immediately after database check

## Future Enhancements

### Additional Health Checks

1. **Redis Connectivity** (when caching enabled):
```typescript
if (process.env.REDIS_HOST) {
  try {
    await redis.ping();
    checks.redis = 'connected';
  } catch {
    checks.redis = 'disconnected';
    checks.status = 'unhealthy';
  }
}
```

2. **Vector Store Connectivity** (ChromaDB/pgvector):
```typescript
if (process.env.VECTOR_STORE_PROVIDER === 'chroma') {
  try {
    const response = await fetch(`${chromaUrl}/api/v1/heartbeat`);
    checks.vectorStore = response.ok ? 'connected' : 'disconnected';
  } catch {
    checks.vectorStore = 'disconnected';
    checks.status = 'degraded';
  }
}
```

3. **Memory Usage Monitoring**:
```typescript
const memUsage = process.memoryUsage();
checks.memory = {
  heapUsed: memUsage.heapUsed,
  heapTotal: memUsage.heapTotal,
  rss: memUsage.rss,
};

// Mark unhealthy if memory exceeds threshold
if (memUsage.heapUsed / memUsage.heapTotal > 0.9) {
  checks.status = 'degraded';
}
```

4. **Disk Space Check**:
```typescript
import { statfs } from 'fs';

const stats = statfs('./data');
const usagePercent = (stats.blocks - stats.bfree) / stats.blocks;

if (usagePercent > 0.9) {
  checks.diskSpace = 'critical';
  checks.status = 'degraded';
}
```

### Health Status Levels

Consider implementing graduated health states:
- **healthy**: All checks pass
- **degraded**: Non-critical services unavailable (e.g., Redis down but database up)
- **unhealthy**: Critical services unavailable (e.g., database down)

### Detailed Health Endpoint

Add `/health/detailed` for administrative access:
```typescript
app.get('/health/detailed', authMiddleware, async (c) => {
  return c.json({
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {
      database: { status: 'connected', latency: '2ms' },
      redis: { status: 'connected', latency: '1ms' },
      vectorStore: { status: 'connected', latency: '5ms' },
    },
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
    },
  });
});
```

## References

- [Docker Health Check Documentation](https://docs.docker.com/engine/reference/builder/#healthcheck)
- [Kubernetes Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [AWS ALB Health Checks](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)
- [Health Check Best Practices](https://microservices.io/patterns/observability/health-check-api.html)
