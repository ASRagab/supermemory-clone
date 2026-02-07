# Production Deployment Guide - Supermemory Clone

**Last Updated**: 2026-02-02
**Status**: Complete
**Version**: 1.0.0

This guide provides production-ready instructions for deploying the Supermemory Clone API with PostgreSQL, Redis, and optional vector databases.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Infrastructure Setup](#infrastructure-setup)
3. [Environment Configuration](#environment-configuration)
4. [Deployment Steps](#deployment-steps)
5. [Database Migrations](#database-migrations)
6. [Monitoring & Observability](#monitoring--observability)
7. [Performance Tuning](#performance-tuning)
8. [Security Hardening](#security-hardening)
9. [Backup & Disaster Recovery](#backup--disaster-recovery)
10. [Troubleshooting](#troubleshooting)
11. [Scaling Considerations](#scaling-considerations)
12. [Maintenance Procedures](#maintenance-procedures)
13. [Production Checklist](#production-checklist)

---

## Prerequisites

### Hardware Requirements

**Minimum Configuration**
```
CPU:     2 cores (2.4 GHz+)
RAM:     4 GB
Storage: 50 GB (SSD recommended)
Network: 100 Mbps uplink
```

**Recommended Configuration**
```
CPU:     4+ cores (3.0 GHz+)
RAM:     8-16 GB
Storage: 100+ GB (SSD)
Network: 1 Gbps uplink
```

**For High-Load Scenarios (10K+ daily users)**
```
CPU:     8+ cores
RAM:     16-32 GB
Storage: 500+ GB (SSD with RAID-10)
Network: 10 Gbps dedicated
```

### Software Requirements

```
Docker:              20.10+
Docker Compose:      1.29+
PostgreSQL:          16.0+
pgvector extension:  0.5.0+
Node.js:             20.0.0+ (for local development)
```

### Network Requirements

- Public IP address or domain name
- SSL/TLS certificate (self-signed or from CA)
- Firewall access to ports: 80, 443, 5432 (internal), 6379 (internal)

### API Key Prerequisites

At least one of the following:
```
OPENAI_API_KEY      - For embeddings (required)
ANTHROPIC_API_KEY   - For LLM memory extraction (optional)
```

### Environment Variables Checklist

Required variables:
- [ ] `OPENAI_API_KEY` - OpenAI API key for embeddings
- [ ] `AUTH_TOKEN` - Strong secret key (32+ characters)
- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `REDIS_URL` - Redis connection string

Recommended variables:
- [ ] `API_HOST` - Set to `0.0.0.0` for Docker
- [ ] `API_PORT` - Set to `3000` (or your preference)
- [ ] `NODE_ENV` - Set to `production`
- [ ] `LOG_LEVEL` - Set to `info` or `warn`

Optional variables:
- [ ] `ANTHROPIC_API_KEY` - Anthropic API key
- [ ] `VECTOR_STORE_PROVIDER` - ChromaDB or other vector store
- [ ] `LLM_PROVIDER` - OpenAI or Anthropic
- [ ] `RATE_LIMIT_REQUESTS` - Rate limit per window

---

## Infrastructure Setup

### PostgreSQL Production Configuration

#### 1. Install PostgreSQL with pgvector

**Option A: Docker Compose (Recommended)**

```bash
# Start PostgreSQL with pgvector pre-installed
docker compose up -d postgres

# Verify PostgreSQL is running
docker compose ps postgres

# Check pgvector extension
docker compose exec postgres psql -U supermemory -d supermemory \
  -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

**Option B: Native Installation (macOS)**

```bash
# Install PostgreSQL and pgvector
brew install postgresql@16 pgvector

# Start PostgreSQL service
brew services start postgresql@16

# Verify installation
psql --version
postgres --version
```

**Option C: Native Installation (Ubuntu/Debian)**

```bash
# Update package list
sudo apt update

# Install PostgreSQL
sudo apt install postgresql-16 postgresql-16-pgvector

# Start PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify installation
psql --version
```

#### 2. Configure PostgreSQL for Production

Create a production configuration file:

```sql
-- production-config.sql
-- Run as superuser: psql postgres -f production-config.sql

-- Optimize for production workloads
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '8GB';
ALTER SYSTEM SET effective_cache_size = '24GB';
ALTER SYSTEM SET maintenance_work_mem = '2GB';
ALTER SYSTEM SET work_mem = '256MB';
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
ALTER SYSTEM SET random_page_cost = 1.1;

-- Logging configuration
ALTER SYSTEM SET log_statement = 'all';
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- Log queries > 1s
ALTER SYSTEM SET log_duration = on;
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;
ALTER SYSTEM SET log_autovacuum_min_duration = 0;

-- Security configuration
ALTER SYSTEM SET ssl = on;
ALTER SYSTEM SET password_encryption = 'scram-sha-256';

-- Apply configuration changes
SELECT pg_reload_conf();

-- Verify settings
SHOW max_connections;
SHOW shared_buffers;
SHOW effective_cache_size;
```

Deploy the configuration:

```bash
# Local PostgreSQL
psql -U postgres -f production-config.sql

# Docker PostgreSQL
docker compose exec postgres psql -U postgres -f /production-config.sql
```

#### 3. Configure Connection Pooling

The application supports connection pooling via environment variables:

```bash
# .env configuration for production
DATABASE_POOL_MIN=15
DATABASE_POOL_MAX=75
DATABASE_IDLE_TIMEOUT=60000          # 60 seconds
DATABASE_CONNECTION_TIMEOUT=10000    # 10 seconds
DATABASE_STATEMENT_TIMEOUT=120000    # 120 seconds
DATABASE_APP_NAME=supermemory-api

# SSL/TLS configuration
DATABASE_SSL_MODE=require
DATABASE_SSL_REJECT_UNAUTHORIZED=true

# TCP keepalive for detecting stale connections
DATABASE_TCP_KEEPALIVES=1
DATABASE_TCP_KEEPALIVES_IDLE=60
DATABASE_TCP_KEEPALIVES_INTERVAL=10
```

#### 4. Create Database User and Permissions

```sql
-- Run as superuser
psql postgres

-- Create database
CREATE DATABASE supermemory;

-- Create role with strong password
CREATE USER supermemory WITH PASSWORD 'generate-strong-random-password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE supermemory TO supermemory;

-- Connect to database
\c supermemory

-- Grant schema permissions
GRANT ALL PRIVILEGES ON SCHEMA public TO supermemory;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO supermemory;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO supermemory;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO supermemory;

-- Exit
\q
```

### Redis Configuration

#### 1. Start Redis Container

```bash
# Using Docker Compose
docker compose up -d redis

# Verify Redis is running
docker compose ps redis

# Test Redis connection
docker compose exec redis redis-cli ping
# Expected: PONG
```

#### 2. Configure Redis for Production

```bash
# In docker-compose.prod.yml or as command-line args:
redis-server \
  --appendonly yes \
  --appendfsync everysec \
  --maxmemory 1gb \
  --maxmemory-policy allkeys-lru \
  --timeout 300 \
  --tcp-keepalive 60 \
  --requirepass your-strong-redis-password
```

#### 3. Environment Configuration

```bash
# .env configuration
REDIS_URL=redis://:redis-password@redis:6379
# Or with authentication:
REDIS_URL=redis://:your-redis-password@redis-host:6379
```

### Reverse Proxy Setup (nginx)

Create a production-grade nginx configuration:

```nginx
# /etc/nginx/sites-available/supermemory

# Rate limiting
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;
limit_req_zone $binary_remote_addr zone=upload_limit:10m rate=10r/s;

# Upstream API server
upstream supermemory_api {
    least_conn;
    server api:3000 max_fails=3 fail_timeout=30s;
    server api-2:3000 max_fails=3 fail_timeout=30s;  # For load balancing
    keepalive 32;
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name api.supermemory.example.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name api.supermemory.example.com;

    # SSL/TLS configuration
    ssl_certificate /etc/letsencrypt/live/api.supermemory.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.supermemory.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_stapling on;
    ssl_stapling_verify on;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    # CORS headers (adjust as needed)
    add_header Access-Control-Allow-Origin "https://app.supermemory.example.com" always;
    add_header Access-Control-Allow-Credentials "true" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;

    # Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1000;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json;

    # Logging
    access_log /var/log/nginx/supermemory-access.log combined;
    error_log /var/log/nginx/supermemory-error.log warn;

    # Rate limiting
    location ~ ^/api/v1/(documents/file|documents/bulk-delete) {
        limit_req zone=upload_limit burst=20 nodelay;
        proxy_pass http://supermemory_api;
        include proxy_params;
    }

    location ~ ^/api/ {
        limit_req zone=api_limit burst=200 nodelay;
        proxy_pass http://supermemory_api;
        include proxy_params;
    }

    # Health check endpoint (no rate limiting)
    location /health {
        proxy_pass http://supermemory_api;
        proxy_connect_timeout 5s;
        proxy_read_timeout 5s;
    }

    # Metrics endpoint (optional)
    location /metrics {
        proxy_pass http://supermemory_api;
        allow 10.0.0.0/8;     # Internal network only
        deny all;
    }

    # Root redirect
    location / {
        return 404;
    }
}

# Proxy parameters (create /etc/nginx/proxy_params)
# proxy_set_header Host $host;
# proxy_set_header X-Real-IP $remote_addr;
# proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
# proxy_set_header X-Forwarded-Proto $scheme;
# proxy_http_version 1.1;
# proxy_set_header Connection "";
# proxy_connect_timeout 60s;
# proxy_send_timeout 60s;
# proxy_read_timeout 60s;
```

Enable the nginx configuration:

```bash
# Symlink to sites-enabled
sudo ln -s /etc/nginx/sites-available/supermemory /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### SSL/TLS Configuration

#### Option 1: Let's Encrypt (Free)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Create certificate
sudo certbot certonly --nginx -d api.supermemory.example.com

# Auto-renewal (cron job)
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Test renewal
sudo certbot renew --dry-run
```

#### Option 2: Self-Signed Certificate (Development)

```bash
# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt -days 365 -nodes

# Copy to secure location
sudo cp server.crt /etc/ssl/certs/
sudo cp server.key /etc/ssl/private/
sudo chmod 600 /etc/ssl/private/server.key
```

#### Option 3: Commercial Certificate

```bash
# Configure nginx with commercial certificate
ssl_certificate /path/to/certificate.crt;
ssl_certificate_key /path/to/private.key;
ssl_trusted_certificate /path/to/ca-bundle.crt;
```

---

## Environment Configuration

### Production .env Template

Create `.env` file with production values:

```bash
# =============================================================================
# Production Environment - Supermemory Clone
# =============================================================================

# Server Configuration
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=3000
AUTH_TOKEN=generate-strong-random-secret-32-chars-minimum

# Database Configuration (PostgreSQL)
DATABASE_URL=postgresql://supermemory:your-strong-password@postgres:5432/supermemory
DATABASE_POOL_MIN=15
DATABASE_POOL_MAX=75
DATABASE_IDLE_TIMEOUT=60000
DATABASE_CONNECTION_TIMEOUT=10000
DATABASE_STATEMENT_TIMEOUT=120000
DATABASE_SSL_MODE=require
DATABASE_TCP_KEEPALIVES=1

# Redis Configuration (for caching and job queues)
REDIS_URL=redis://:redis-password@redis:6379

# OpenAI API Configuration
OPENAI_API_KEY=sk-your-openai-api-key
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# Anthropic API Configuration (optional)
# ANTHROPIC_API_KEY=sk-ant-your-anthropic-key

# Vector Store Configuration
VECTOR_STORE_PROVIDER=memory  # Options: memory, sqlite-vss, chroma
# For ChromaDB:
# VECTOR_STORE_PROVIDER=chroma
# CHROMA_URL=http://chromadb:8000
# CHROMA_COLLECTION=supermemory_vectors

# LLM Provider Configuration (optional)
LLM_PROVIDER=openai           # Options: openai, anthropic, regex (default: disabled)
LLM_MODEL=gpt-4o-mini         # For OpenAI: gpt-4o-mini, gpt-4, etc.
LLM_MAX_TOKENS=2000
LLM_TEMPERATURE=0.1
LLM_TIMEOUT_MS=30000
LLM_MAX_RETRIES=3

# LLM Caching
LLM_CACHE_ENABLED=true
LLM_CACHE_TTL_MS=900000       # 15 minutes

# Rate Limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000    # 1 minute

# Logging
LOG_LEVEL=info                # Options: debug, info, warn, error

# HNSW Index Configuration (for PostgreSQL vector search)
HNSW_EF_SEARCH=100            # Balanced (99% recall), options: 40 (fast), 200 (accurate)

# Docker-specific
SKIP_MIGRATIONS=false
MAX_RETRIES=30
RETRY_INTERVAL=2
```

### Security Best Practices

#### 1. Generate Strong API Secret Key

```bash
# Generate 32-character random secret
openssl rand -base64 32

# Or using Python
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### 2. API Key Generation for Clients

```bash
# Create client-specific API keys
# Format: Generate random 32+ character tokens for each client

# Store securely in environment variables or secrets manager
# Example: SUPERMEMORY_API_KEY_CLIENT_A=key-a-value
```

#### 3. Database Password Security

```bash
# Generate strong PostgreSQL password
python3 -c "import secrets; print(secrets.token_urlsafe(24))"

# Update in database
psql postgres -c "ALTER USER supermemory WITH PASSWORD 'new-strong-password';"
```

#### 4. Redis Password Configuration

```bash
# Generate Redis password
openssl rand -base64 32

# Set in Redis configuration
redis-server --requirepass your-generated-password

# Update REDIS_URL in .env
REDIS_URL=redis://:your-generated-password@redis:6379
```

#### 5. Environment Variables Security

Store sensitive variables in a secrets manager:

```bash
# Using AWS Secrets Manager
aws secretsmanager create-secret \
  --name supermemory/prod/api-secret \
  --secret-string "your-api-secret-key"

# Using Azure Key Vault
az keyvault secret set \
  --vault-name supermemory-vault \
  --name api-secret-key \
  --value "your-api-secret-key"

# Using HashiCorp Vault
vault kv put secret/supermemory/api api_secret_key="your-api-secret-key"
```

---

## Deployment Steps

### Step 1: Prepare Server

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Docker and Docker Compose
sudo apt install -y docker.io docker-compose curl wget

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify Docker installation
docker --version
docker compose --version
```

### Step 2: Clone Repository

```bash
# Clone supermemory-clone repository
git clone https://github.com/your-org/supermemory-clone.git /opt/supermemory
cd /opt/supermemory

# Checkout production branch
git checkout main

# Verify branch
git branch -v
```

### Step 3: Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit with production values
nano .env

# Set proper permissions
chmod 600 .env

# Verify configuration
cat .env | grep -E "^[^#]"  # Show all non-comment lines
```

### Step 4: Start PostgreSQL

```bash
# Start PostgreSQL container
docker compose up -d postgres

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
  docker compose exec postgres pg_isready -U supermemory -d supermemory && break
  echo "Attempt $i/30..."
  sleep 2
done

# Verify PostgreSQL is running
docker compose ps postgres
```

### Step 5: Run Database Migrations

```bash
# Make migrations script executable
chmod +x scripts/migrations/run_migrations.sh

# Run all migrations
./scripts/migrations/run_migrations.sh

# Or run migrations individually
docker compose exec postgres psql -U supermemory -d supermemory \
  -f /migrations/001_create_pgvector_extension.sql

docker compose exec postgres psql -U supermemory -d supermemory \
  -f /migrations/002_create_memory_embeddings_table.sql

docker compose exec postgres psql -U supermemory -d supermemory \
  -f /migrations/003_create_hnsw_index.sql
```

### Step 6: Start Redis

```bash
# Start Redis container
docker compose up -d redis

# Verify Redis is running
docker compose ps redis

# Test Redis connection
docker compose exec redis redis-cli ping
# Expected: PONG
```

### Step 7: Build and Start API

```bash
# Build Docker image
docker compose build api

# Start API container
docker compose up -d api

# Check if API is running
docker compose ps api

# View startup logs
docker compose logs api --tail 50

# Test health endpoint
curl -s http://localhost:3000/health | jq .
```

### Step 8: Verify Deployment

```bash
# Check all containers are running
docker compose ps

# Verify health check
curl -s http://localhost:3000/health

# Expected response:
# {
#   "status": "ok",
#   "timestamp": "2025-02-02T12:00:00.000Z",
#   "version": "1.0.0"
# }

# Test API with authentication
curl -X POST http://localhost:3000/api/v1/search \
  -H "Authorization: Bearer your-api-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"q": "test", "containerTag": "test"}'
```

### Step 9: Configure Reverse Proxy

```bash
# Install nginx
sudo apt install -y nginx

# Copy nginx configuration
sudo cp nginx.conf /etc/nginx/sites-available/supermemory

# Enable site
sudo ln -s /etc/nginx/sites-available/supermemory /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx

# Enable auto-start
sudo systemctl enable nginx
```

### Step 10: Enable SSL/TLS

```bash
# Install Let's Encrypt certificate
sudo certbot certonly --nginx -d api.supermemory.example.com

# Verify certificate
sudo certbot certificates

# Set auto-renewal
sudo systemctl enable certbot.timer
```

---

## Database Migrations

### Migration Execution Procedure

#### Pre-Migration Checklist

```bash
# 1. Backup current database
docker compose exec postgres pg_dump -U supermemory supermemory > backup-$(date +%Y%m%d-%H%M%S).sql

# 2. Verify backup was created
ls -lh backup-*.sql

# 3. Check current schema state
docker compose exec postgres psql -U supermemory -d supermemory -c "\dt"

# 4. Enable maintenance mode (optional)
# Redirect API traffic or put behind maintenance page

# 5. Verify no active connections
docker compose exec postgres psql -U supermemory -d supermemory -c "
  SELECT count(*) FROM pg_stat_activity WHERE datname = 'supermemory' AND state != 'idle';"
```

#### Running Migrations

```bash
# Option 1: Using migration runner script
chmod +x scripts/migrations/run_migrations.sh
DATABASE_URL="postgresql://supermemory:password@localhost:5432/supermemory" \
  ./scripts/migrations/run_migrations.sh

# Option 2: Running migrations manually
export DATABASE_URL="postgresql://supermemory:password@localhost:5432/supermemory"

# Run pgvector extension migration
psql $DATABASE_URL -f scripts/migrations/001_create_pgvector_extension.sql

# Create embeddings table
psql $DATABASE_URL -f scripts/migrations/002_create_memory_embeddings_table.sql

# Create HNSW index
psql $DATABASE_URL -f scripts/migrations/003_create_hnsw_index.sql

# Option 3: Using Docker Compose
docker compose exec postgres psql -U supermemory -d supermemory \
  -f /migrations/001_create_pgvector_extension.sql
```

#### Verification Steps

```bash
# Verify pgvector extension
docker compose exec postgres psql -U supermemory -d supermemory -c \
  "SELECT * FROM pg_extension WHERE extname = 'vector';"

# Verify tables exist
docker compose exec postgres psql -U supermemory -d supermemory -c "\dt"

# Verify indexes
docker compose exec postgres psql -U supermemory -d supermemory -c "\di"

# Verify vector operations
docker compose exec postgres psql -U supermemory -d supermemory -c \
  "SELECT '[1,2,3]'::vector <=> '[4,5,6]'::vector;"

# Test HNSW index
docker compose exec postgres psql -U supermemory -d supermemory -c \
  "SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_memory_embeddings_hnsw';"
```

### Rollback Procedures

#### Rollback HNSW Index (Migration 003)

```bash
docker compose exec postgres psql -U supermemory -d supermemory << 'EOF'
-- Drop HNSW index
DROP INDEX IF EXISTS idx_memory_embeddings_hnsw;

-- Verify rollback
SELECT indexname FROM pg_indexes WHERE tablename = 'memory_embeddings';
EOF
```

#### Rollback Embeddings Table (Migration 002)

```bash
docker compose exec postgres psql -U supermemory -d supermemory << 'EOF'
-- Drop trigger and function
DROP TRIGGER IF EXISTS trg_memory_embeddings_updated_at ON memory_embeddings;
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop table
DROP TABLE IF EXISTS memory_embeddings CASCADE;

-- Verify rollback
\dt memory_embeddings
EOF
```

#### Rollback pgvector Extension (Migration 001)

```bash
docker compose exec postgres psql -U supermemory -d supermemory << 'EOF'
-- WARNING: This will break vector functionality
DROP EXTENSION IF EXISTS vector CASCADE;

-- Verify rollback
SELECT * FROM pg_available_extensions WHERE name = 'vector';
EOF
```

#### Restore from Backup

```bash
# Stop API to prevent conflicts
docker compose stop api

# Restore database from backup
docker compose exec -T postgres psql -U supermemory supermemory < backup-YYYYMMDD-HHMMSS.sql

# Restart API
docker compose up -d api

# Verify restore
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT COUNT(*) FROM memory_embeddings;"
```

---

## Monitoring & Observability

### Health Check Endpoints

#### Application Health

```bash
# Check API health
curl -s http://localhost:3000/health | jq .

# Expected response:
{
  "status": "ok",
  "timestamp": "2025-02-02T12:00:00.000Z",
  "version": "1.0.0"
}

# Check with interval
watch -n 5 'curl -s http://localhost:3000/health | jq .'
```

#### Container Health

```bash
# Check all services
docker compose ps

# Monitor logs in real-time
docker compose logs -f

# Check specific service
docker compose logs api --tail 100

# Check PostgreSQL health
docker compose exec postgres pg_isready -U supermemory -d supermemory

# Check Redis health
docker compose exec redis redis-cli ping
```

### Prometheus Metrics (Optional)

Create a Prometheus configuration to scrape metrics:

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'supermemory-api'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    basic_auth:
      username: 'admin'
      password: 'your-prometheus-password'

  - job_name: 'postgresql'
    static_configs:
      - targets: ['localhost:5432']

  - job_name: 'redis'
    static_configs:
      - targets: ['localhost:6379']
```

### Grafana Dashboards

Create dashboards to monitor:

**API Metrics**
- Request rate (req/s)
- Response time (p50, p95, p99)
- Error rate (4xx, 5xx)
- Authentication failures
- Rate limit hits

**Database Metrics**
- Active connections
- Query latency
- Index usage
- Table size
- Cache hit ratio

**Redis Metrics**
- Memory usage
- Connected clients
- Operations/sec
- Key eviction rate
- Command latency

### Log Aggregation

#### Using Loki + Promtail

```yaml
# promtail-config.yaml
scrape_configs:
  - job_name: supermemory-api
    static_configs:
      - targets:
          - localhost
        labels:
          job: supermemory-api
          service: api
          __path__: /var/log/supermemory/api.log

  - job_name: postgresql
    static_configs:
      - targets:
          - localhost
        labels:
          job: postgresql
          service: database
          __path__: /var/log/postgresql/*.log

  - job_name: redis
    static_configs:
      - targets:
          - localhost
        labels:
          job: redis
          service: cache
          __path__: /var/log/redis/*.log
```

#### Using ELK Stack

```bash
# Start Elasticsearch, Logstash, Kibana
docker compose up -d elasticsearch logstash kibana

# Configure Logstash to collect Docker logs
# See logstash.conf for configuration
```

### Custom Alerts

Set up alerting for critical conditions:

```yaml
# alerts.yml
groups:
  - name: supermemory
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        annotations:
          summary: "High error rate detected"

      - alert: HighLatency
        expr: histogram_quantile(0.95, http_request_duration_seconds) > 1
        for: 5m
        annotations:
          summary: "High request latency detected"

      - alert: DatabaseConnectionPoolExhausted
        expr: database_connections_used / database_connections_max > 0.9
        for: 2m
        annotations:
          summary: "Database connection pool nearly exhausted"

      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.9
        for: 5m
        annotations:
          summary: "Redis memory usage critically high"

      - alert: DatabaseDiskLow
        expr: node_filesystem_avail_bytes{mountpoint="/var/lib/postgresql/data"} < 1e9
        for: 5m
        annotations:
          summary: "PostgreSQL disk space below 1GB"
```

---

## Performance Tuning

### PostgreSQL Tuning Parameters

#### Memory Configuration

```sql
-- Optimize for 16GB server
ALTER SYSTEM SET shared_buffers = '4GB';          -- 25% of RAM
ALTER SYSTEM SET effective_cache_size = '12GB';   -- 75% of RAM
ALTER SYSTEM SET work_mem = '256MB';              -- Per operation
ALTER SYSTEM SET maintenance_work_mem = '2GB';    -- For VACUUM, index creation
ALTER SYSTEM SET wal_buffers = '16MB';

-- For 8GB server
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET effective_cache_size = '6GB';

-- For 32GB+ server
ALTER SYSTEM SET shared_buffers = '8GB';
ALTER SYSTEM SET effective_cache_size = '24GB';
ALTER SYSTEM SET work_mem = '512MB';
ALTER SYSTEM SET maintenance_work_mem = '4GB';

-- Apply changes
SELECT pg_reload_conf();
```

#### Query Optimization

```sql
-- Enable query statistics
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Find slow queries
SELECT
    query,
    calls,
    total_time,
    mean_time,
    max_time
FROM pg_stat_statements
WHERE query LIKE '%memory_embeddings%'
ORDER BY mean_time DESC
LIMIT 10;

-- Update statistics
ANALYZE memory_embeddings;

-- Check index usage
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename = 'memory_embeddings'
ORDER BY idx_scan DESC;
```

### HNSW Index Optimization

The application uses HNSW (Hierarchical Navigable Small World) indexing for vector search:

```sql
-- Current index configuration
-- m=16: Number of connections per node (balance between speed and accuracy)
-- ef_construction=64: Quality during index building (higher = better quality, slower)
-- ef_search=100: Quality during search (configurable per query)

-- Check current settings
SELECT * FROM pg_indexes WHERE indexname = 'idx_memory_embeddings_hnsw';

-- For higher accuracy (slower queries)
DROP INDEX idx_memory_embeddings_hnsw;
CREATE INDEX idx_memory_embeddings_hnsw
ON memory_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 128);  -- Increased ef_construction

-- For faster queries (lower recall)
DROP INDEX idx_memory_embeddings_hnsw;
CREATE INDEX idx_memory_embeddings_hnsw
ON memory_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 8, ef_construction = 32);  -- Reduced parameters

-- After index changes, analyze
ANALYZE memory_embeddings;
```

### Connection Pool Tuning

Adjust based on workload:

```bash
# High concurrency (many concurrent users)
DATABASE_POOL_MIN=20
DATABASE_POOL_MAX=100

# Moderate concurrency
DATABASE_POOL_MIN=15
DATABASE_POOL_MAX=75

# Low concurrency (batch processing)
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20

# Monitor pool utilization
docker compose logs api | grep "pool"
```

### Redis Configuration

```bash
# Optimize Redis memory
redis-server \
  --maxmemory 1gb \
  --maxmemory-policy allkeys-lru \
  --appendonly yes \
  --appendfsync everysec
```

### Caching Strategies

```bash
# Configure LLM response caching
LLM_CACHE_ENABLED=true
LLM_CACHE_TTL_MS=3600000          # 1 hour

# Configure API-level caching (optional)
CACHE_ENABLED=true
CACHE_TTL_MS=300000                # 5 minutes
```

---

## Security Hardening

### Firewall Rules

```bash
# Allow only necessary ports
sudo ufw enable

# HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# SSH (change port from 22 if possible)
sudo ufw allow 22/tcp

# Block database ports from external access
sudo ufw deny 5432/tcp
sudo ufw allow from 10.0.0.0/8 to any port 5432

# Redis (internal only)
sudo ufw deny 6379/tcp
sudo ufw allow from 10.0.0.0/8 to any port 6379

# Verify rules
sudo ufw status
```

### API Authentication

#### X-API-Key Header

```bash
# Generate strong API key
openssl rand -base64 32

# Test API with key
curl -X POST http://localhost:3000/api/v1/search \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"q": "test", "containerTag": "test"}'
```

#### API Key Rotation

```bash
# Generate new API keys
NEW_KEY=$(openssl rand -base64 32)

# Update environment variable
sed -i "s/AUTH_TOKEN=.*/AUTH_TOKEN=$NEW_KEY/" .env

# Restart API
docker compose restart api

# Notify clients of new key
```

### SQL Injection Prevention

The application uses parameterized queries with Drizzle ORM and pgvector:

```sql
-- Safe: Parameterized query
SELECT * FROM memory_embeddings
WHERE embedding <=> $1::vector < 0.5
ORDER BY embedding <=> $1::vector
LIMIT 10;

-- Always use parameters, never string concatenation
```

### Input Validation

Environment configuration:

```bash
# Enforce HTTPS only
DATABASE_SSL_MODE=require

# Enable request logging
LOG_LEVEL=info

# Rate limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
```

### CORS Configuration

In production, restrict CORS to known domains:

```typescript
// Example: Set CORS in nginx or application
add_header Access-Control-Allow-Origin "https://app.example.com" always;
add_header Access-Control-Allow-Credentials "true" always;
add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
```

### Rate Limiting

```bash
# Configure rate limits
RATE_LIMIT_REQUESTS=100          # Requests per window
RATE_LIMIT_WINDOW_MS=60000       # 1 minute window

# Per-endpoint limits in nginx
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;
limit_req_zone $binary_remote_addr zone=upload_limit:10m rate=10r/s;

limit_req zone=api_limit burst=200 nodelay;
limit_req zone=upload_limit burst=20 nodelay;
```

### DDoS Protection

```bash
# Use fail2ban to block abusive IPs
sudo apt install fail2ban

# Configure for API protection
sudo tee /etc/fail2ban/jail.local << EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
port = http,https
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
EOF

sudo systemctl restart fail2ban
```

---

## Backup & Disaster Recovery

### Automated Backup Strategy

#### Database Backup Script

Create `/opt/supermemory/scripts/backup-database.sh`:

```bash
#!/bin/bash
set -e

BACKUP_DIR="/backups/supermemory"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/supermemory-$TIMESTAMP.sql.gz"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Backup database
docker compose exec -T postgres pg_dump \
  -U supermemory \
  supermemory | gzip > "$BACKUP_FILE"

# Verify backup
if [ -f "$BACKUP_FILE" ]; then
  echo "Backup successful: $BACKUP_FILE ($(du -h $BACKUP_FILE | cut -f1))"
else
  echo "Backup failed"
  exit 1
fi

# Remove old backups
find "$BACKUP_DIR" -name "supermemory-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete

# Upload to remote storage (optional)
# aws s3 cp "$BACKUP_FILE" s3://backups/supermemory/
# azure storage blob upload --file "$BACKUP_FILE" --container-name backups

echo "Backup retention: keeping backups from last $RETENTION_DAYS days"
ls -lh "$BACKUP_DIR" | tail -5
```

#### Scheduling Backups with Cron

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * /opt/supermemory/scripts/backup-database.sh >> /var/log/supermemory-backup.log 2>&1

# Add weekly backup at 3 AM on Sundays
0 3 * * 0 /opt/supermemory/scripts/backup-database.sh >> /var/log/supermemory-backup.log 2>&1
```

### Backup Verification

```bash
# Test backup integrity
gzip -t /backups/supermemory/supermemory-*.sql.gz

# Test restore procedure monthly
docker compose stop api
psql postgres -c "DROP DATABASE IF EXISTS supermemory_test;"
psql postgres -c "CREATE DATABASE supermemory_test;"
zcat /backups/supermemory/supermemory-latest.sql.gz | psql supermemory_test
docker compose up -d api
```

### Recovery Procedures

#### Point-in-Time Recovery (PITR)

```bash
# Enable WAL archiving (if not already enabled)
psql postgres << 'EOF'
ALTER SYSTEM SET wal_level = replica;
ALTER SYSTEM SET max_wal_senders = 3;
ALTER SYSTEM SET wal_keep_size = '1GB';
SELECT pg_reload_conf();
EOF

# Restart PostgreSQL
docker compose restart postgres

# Archive WAL files (for production)
# Configure pg_wal_archiver or use WAL-E/WAL-G
```

#### Disaster Recovery Steps

```bash
# 1. Stop API
docker compose down

# 2. Check available backups
ls -lh /backups/supermemory/

# 3. Stop PostgreSQL container
docker compose stop postgres

# 4. Remove corrupted volume (if necessary)
docker volume rm supermemory_postgres_data
docker volume create supermemory_postgres_data

# 5. Start PostgreSQL
docker compose up -d postgres

# 6. Wait for PostgreSQL to be ready
sleep 10
docker compose exec postgres pg_isready -U supermemory

# 7. Restore backup
zcat /backups/supermemory/supermemory-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose exec -T postgres psql -U supermemory supermemory

# 8. Verify restore
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT COUNT(*) FROM memory_embeddings;"

# 9. Start API
docker compose up -d api

# 10. Verify API is healthy
curl http://localhost:3000/health
```

### Backup Storage Options

#### AWS S3

```bash
# Install AWS CLI
sudo apt install awscli

# Configure credentials
aws configure

# Upload backup
aws s3 cp /backups/supermemory/supermemory-*.sql.gz s3://my-backup-bucket/

# Set lifecycle policy to delete old backups
aws s3api put-bucket-lifecycle-configuration \
  --bucket my-backup-bucket \
  --lifecycle-configuration file://lifecycle.json
```

#### Azure Blob Storage

```bash
# Install Azure CLI
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Login
az login

# Upload backup
az storage blob upload \
  --account-name mystorageaccount \
  --container-name backups \
  --file /backups/supermemory/supermemory-*.sql.gz
```

#### Google Cloud Storage

```bash
# Install Google Cloud SDK
curl https://sdk.cloud.google.com | bash

# Initialize
gcloud init

# Upload backup
gsutil cp /backups/supermemory/supermemory-*.sql.gz gs://my-backup-bucket/
```

---

## Troubleshooting

### Database Connection Issues

#### Error: "could not connect to server"

```bash
# Check if PostgreSQL is running
docker compose ps postgres

# Check logs
docker compose logs postgres

# Test connection
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT 1;"

# Verify DATABASE_URL
echo $DATABASE_URL
```

#### Error: "FATAL: remaining connection slots are reserved"

```bash
# Reduce connection pool size
DATABASE_POOL_MAX=50

# Or increase PostgreSQL max_connections
ALTER SYSTEM SET max_connections = 300;
SELECT pg_reload_conf();
```

### API Issues

#### API not starting

```bash
# Check logs
docker compose logs api --tail 100

# Common issues:
# 1. Missing AUTH_TOKEN
# 2. Database not ready
# 3. Redis not available
# 4. Port 3000 already in use

# Check port availability
lsof -i :3000

# Check dependencies
docker compose ps
```

#### High latency

```bash
# Check query performance
docker compose exec postgres psql -U supermemory -d supermemory << 'EOF'
EXPLAIN ANALYZE
SELECT * FROM memory_embeddings
ORDER BY embedding <=> '[...]'::vector
LIMIT 10;
EOF

# Monitor active connections
docker compose exec postgres psql -U supermemory -d supermemory -c \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = 'supermemory';"

# Check index usage
docker compose exec postgres psql -U supermemory -d supermemory -c \
  "SELECT idx_scan FROM pg_stat_user_indexes WHERE indexname = 'idx_memory_embeddings_hnsw';"
```

### Performance Issues

#### Slow vector search

```bash
# Check if index is being used
EXPLAIN ANALYZE
SELECT * FROM memory_embeddings
ORDER BY embedding <=> $1::vector
LIMIT 10;

# Look for "Index Scan using idx_memory_embeddings_hnsw"

# If not using index:
1. Check index exists: SELECT indexname FROM pg_indexes WHERE tablename = 'memory_embeddings';
2. Analyze table: ANALYZE memory_embeddings;
3. Check dimensions: SELECT DISTINCT vector_dims(embedding) FROM memory_embeddings;
```

#### High memory usage

```bash
# Check Redis memory
docker compose exec redis redis-cli INFO memory

# Check PostgreSQL memory
docker compose exec postgres psql -U supermemory -d supermemory -c \
  "SELECT pg_size_pretty(pg_total_relation_size('memory_embeddings'));"

# Check API container memory
docker stats supermemory-api
```

---

## Scaling Considerations

### Horizontal Scaling

#### Load Balancing

```bash
# In docker-compose.prod.yml, scale API service
docker compose up -d --scale api=3

# Configure nginx upstream for load balancing
upstream supermemory_api {
    least_conn;
    server api:3000;
    server api-2:3000;
    server api-3:3000;
    keepalive 32;
}
```

#### Database Read Replicas

```sql
-- Set up PostgreSQL streaming replication
-- On primary server, configure postgresql.conf
ALTER SYSTEM SET max_wal_senders = 10;
ALTER SYSTEM SET wal_keep_size = '1GB';
ALTER SYSTEM SET hot_standby = on;

-- Create replication user
CREATE ROLE replication WITH LOGIN REPLICATION PASSWORD 'replica-password';

-- On replica server, configure recovery.conf
primary_conninfo = 'host=primary-host port=5432 user=replication password=replica-password'
```

### Caching Layers

#### Redis Caching

```bash
# Enable LLM response caching
LLM_CACHE_ENABLED=true
LLM_CACHE_TTL_MS=3600000      # 1 hour

# Configure Redis eviction
maxmemory 1gb
maxmemory-policy allkeys-lru
```

#### CDN Integration

```bash
# For static assets, use CDN like CloudFlare
# In nginx configuration
add_header Cache-Control "public, max-age=31536000, immutable" for static assets;
```

### Database Sharding

For very large deployments (billions of memories):

```bash
# Shard by containerTag hash
# Example: containerTag % 4 determines database instance

# Shard 0: container_hash % 4 == 0
# Shard 1: container_hash % 4 == 1
# Shard 2: container_hash % 4 == 2
# Shard 3: container_hash % 4 == 3

# Application routes to appropriate shard based on containerTag
```

---

## Maintenance Procedures

### Regular Maintenance Tasks

#### Daily Tasks

```bash
# Check disk space
df -h /var/lib/postgresql/data

# Monitor error logs
tail -f /var/log/nginx/supermemory-error.log
docker compose logs --since 1h | grep error
```

#### Weekly Tasks

```bash
# Update statistics
docker compose exec postgres psql -U supermemory -d supermemory -c "ANALYZE;"

# Check slow queries
docker compose exec postgres psql -U supermemory -d supermemory << 'EOF'
SELECT query, calls, mean_time FROM pg_stat_statements
WHERE query NOT LIKE 'ANALYZE%'
ORDER BY mean_time DESC LIMIT 10;
EOF

# Verify backups
ls -lh /backups/supermemory/ | tail -10
```

#### Monthly Tasks

```bash
# Full database vacuum
docker compose exec postgres psql -U supermemory -d supermemory -c "VACUUM ANALYZE;"

# Test restore procedure
/opt/supermemory/scripts/test-backup-restore.sh

# Review security logs
grep "unauthorized\|failed" /var/log/nginx/supermemory-access.log | wc -l

# Check certificate expiration (if using Let's Encrypt)
certbot certificates
```

### Log Rotation

```bash
# Create logrotate config
sudo tee /etc/logrotate.d/supermemory << 'EOF'
/var/log/supermemory/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 root root
    sharedscripts
}
EOF

# Test rotation
sudo logrotate -f /etc/logrotate.d/supermemory
```

### Database Maintenance

```bash
-- Rebuild indexes to optimize performance
REINDEX INDEX CONCURRENTLY idx_memory_embeddings_hnsw;

-- Update table statistics
ANALYZE memory_embeddings;

-- Vacuum to reclaim space
VACUUM ANALYZE memory_embeddings;

-- Monitor bloat
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
    pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) as indexes_size
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Update Procedures

```bash
# Check for updates
git fetch origin
git status

# Review changes
git log origin/main --oneline -5

# Update code
git pull origin main

# Rebuild Docker image
docker compose build api

# Deploy new version
docker compose up -d api

# Monitor startup
docker compose logs api --tail 50

# Verify health
curl http://localhost:3000/health
```

---

## Production Checklist

### Pre-Deployment

- [ ] All environment variables configured and verified
- [ ] SSL/TLS certificate installed and valid
- [ ] Database backups automated and tested
- [ ] Monitoring and alerting configured
- [ ] Security hardening completed
- [ ] Load testing performed
- [ ] Disaster recovery plan documented and tested
- [ ] Team trained on deployment and rollback procedures

### Deployment Day

- [ ] Stakeholders notified of maintenance window
- [ ] Pre-deployment backup created
- [ ] Health checks passing on staging environment
- [ ] Deployment performed during low-traffic period
- [ ] Post-deployment monitoring enabled
- [ ] API health verified
- [ ] Database migrations successful
- [ ] Sample requests tested with real API keys

### Post-Deployment

- [ ] All monitoring dashboards active
- [ ] Error logs reviewed for issues
- [ ] Performance metrics within expected range
- [ ] Stakeholders notified of successful deployment
- [ ] Deployment documented with version number and changes
- [ ] Team debriefing scheduled if any issues occurred

### Ongoing Operations

- [ ] Daily: Check logs and monitor metrics
- [ ] Weekly: Review performance data and backup integrity
- [ ] Monthly: Full maintenance and optimization
- [ ] Quarterly: Security audit and penetration testing
- [ ] Semi-annually: Disaster recovery drill
- [ ] Annually: Capacity planning and scalability assessment

---

## Support & Resources

### Documentation References

- [Database Setup Guide](./database-setup.md) - Comprehensive PostgreSQL configuration
- [Database Performance Guide](./database-performance.md) - Benchmarks and optimization
- [Database Quick Start](./database-quickstart.md) - Fast setup guide
- [README.md](../README.md) - Project overview and features

### External Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/16/)
- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [Docker Documentation](https://docs.docker.com/)
- [Let's Encrypt](https://letsencrypt.org/)
- [nginx Documentation](https://nginx.org/en/docs/)

### Getting Help

1. Check this guide's troubleshooting section
2. Review application logs: `docker compose logs -f`
3. Check PostgreSQL logs: `docker compose logs postgres`
4. Open an issue on GitHub with detailed information
5. Contact the development team

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-02 | 1.0.0 | Comprehensive production deployment guide created with full infrastructure setup, monitoring, security hardening, and disaster recovery procedures |

---

**Document Status**: Production Ready
**Last Reviewed**: 2026-02-02
**Next Review**: 2026-05-02

For questions or updates to this guide, please contact the development team or open an issue on GitHub.
