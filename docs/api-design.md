# Supermemory API Specification

## Overview

This document defines the REST API architecture for the Supermemory clone, a personal knowledge management system that stores, indexes, and retrieves user content using semantic search.

**Base URL:** `https://api.supermemory.local/api`

**API Versions:**
- Documents, Profiles, Connections: `v3`
- Search: `v4`

---

## Authentication

All API endpoints require authentication via Bearer token.

### Request Header

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

### Token Format

JWT tokens with the following claims:
- `sub`: User ID
- `iat`: Issued at timestamp
- `exp`: Expiration timestamp (1 hour default)
- `scope`: Permission scopes (e.g., `read`, `write`, `admin`)

---

## Rate Limiting

### Strategy

Token bucket algorithm with the following tiers:

| Tier       | Requests/Minute | Burst Limit | Description           |
|------------|-----------------|-------------|-----------------------|
| Free       | 60              | 10          | Basic access          |
| Pro        | 300             | 50          | Professional users    |
| Enterprise | 1000            | 100         | Enterprise customers  |

### Rate Limit Headers

```http
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 299
X-RateLimit-Reset: 1706745600
Retry-After: 60
```

### Rate Limit Exceeded Response

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please retry after 60 seconds.",
    "retryAfter": 60
  }
}
```

---

## Error Response Format

All errors follow a consistent structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {},
    "requestId": "req_abc123def456"
  }
}
```

### HTTP Status Codes

| Code | Meaning                | Error Code Examples                    |
|------|------------------------|----------------------------------------|
| 400  | Bad Request            | `INVALID_REQUEST`, `VALIDATION_ERROR`  |
| 401  | Unauthorized           | `INVALID_TOKEN`, `TOKEN_EXPIRED`       |
| 403  | Forbidden              | `INSUFFICIENT_PERMISSIONS`, `QUOTA_EXCEEDED` |
| 404  | Not Found              | `RESOURCE_NOT_FOUND`                   |
| 409  | Conflict               | `DUPLICATE_RESOURCE`                   |
| 422  | Unprocessable Entity   | `CONTENT_TOO_LARGE`, `UNSUPPORTED_FORMAT` |
| 429  | Too Many Requests      | `RATE_LIMIT_EXCEEDED`                  |
| 500  | Internal Server Error  | `INTERNAL_ERROR`                       |
| 503  | Service Unavailable    | `SERVICE_UNAVAILABLE`                  |

---

## Documents API

### Add Document

Creates a new document from text, URL, or file reference.

**Endpoint:** `POST /v3/documents`

**Request Body:**

```json
{
  "content": "The text content to store",
  "contentType": "text",
  "containerTag": "work-notes",
  "metadata": {
    "title": "Meeting Notes",
    "source": "manual",
    "tags": ["meeting", "q1-2024"]
  }
}
```

**Content Types:**
- `text`: Plain text content
- `url`: URL to fetch and extract content from
- `markdown`: Markdown formatted text
- `html`: HTML content (will be converted to text)

**Request Body (URL):**

```json
{
  "content": "https://example.com/article",
  "contentType": "url",
  "containerTag": "bookmarks",
  "metadata": {
    "tags": ["article", "tech"]
  }
}
```

**Response (202 Accepted):**

```json
{
  "id": "doc_abc123def456",
  "status": "processing",
  "contentType": "url",
  "containerTag": "bookmarks",
  "createdAt": "2024-01-31T12:00:00Z",
  "estimatedProcessingTime": 5
}
```

**Response (201 Created - for text/markdown):**

```json
{
  "id": "doc_abc123def456",
  "status": "completed",
  "contentType": "text",
  "containerTag": "work-notes",
  "metadata": {
    "title": "Meeting Notes",
    "source": "manual",
    "tags": ["meeting", "q1-2024"],
    "wordCount": 250,
    "chunkCount": 3
  },
  "createdAt": "2024-01-31T12:00:00Z",
  "updatedAt": "2024-01-31T12:00:00Z"
}
```

---

### Upload File

Uploads a file for processing (PDF, DOCX, TXT, MD).

**Endpoint:** `POST /v3/documents/file`

**Content-Type:** `multipart/form-data`

**Request:**

| Field        | Type   | Required | Description                    |
|--------------|--------|----------|--------------------------------|
| file         | File   | Yes      | The file to upload (max 10MB)  |
| containerTag | String | No       | Container tag for organization |
| metadata     | JSON   | No       | Additional metadata object     |

**Supported File Types:**
- PDF (`.pdf`)
- Word Documents (`.docx`, `.doc`)
- Plain Text (`.txt`)
- Markdown (`.md`)
- Rich Text Format (`.rtf`)

**Response (202 Accepted):**

```json
{
  "id": "doc_file123abc",
  "status": "processing",
  "contentType": "file",
  "fileName": "report.pdf",
  "fileSize": 1048576,
  "mimeType": "application/pdf",
  "containerTag": "reports",
  "createdAt": "2024-01-31T12:00:00Z",
  "estimatedProcessingTime": 30
}
```

---

### Get Document

Retrieves a document by ID.

**Endpoint:** `GET /v3/documents/:id`

**Path Parameters:**

| Parameter | Type   | Required | Description         |
|-----------|--------|----------|---------------------|
| id        | String | Yes      | The document ID     |

**Query Parameters:**

| Parameter      | Type    | Default | Description                    |
|----------------|---------|---------|--------------------------------|
| includeContent | Boolean | false   | Include full document content  |
| includeChunks  | Boolean | false   | Include chunk embeddings info  |

**Response (200 OK):**

```json
{
  "id": "doc_abc123def456",
  "status": "completed",
  "contentType": "text",
  "containerTag": "work-notes",
  "content": "The text content...",
  "metadata": {
    "title": "Meeting Notes",
    "source": "manual",
    "tags": ["meeting", "q1-2024"],
    "wordCount": 250,
    "chunkCount": 3
  },
  "chunks": [
    {
      "id": "chunk_001",
      "position": 0,
      "tokenCount": 128
    }
  ],
  "createdAt": "2024-01-31T12:00:00Z",
  "updatedAt": "2024-01-31T12:00:00Z"
}
```

**Document Status Values:**
- `processing`: Document is being processed
- `completed`: Document is ready for search
- `failed`: Processing failed
- `deleted`: Document has been soft-deleted

---

### Update Document

Updates a document's content or metadata.

**Endpoint:** `PUT /v3/documents/:id`

**Request Body:**

```json
{
  "content": "Updated text content",
  "containerTag": "new-container",
  "metadata": {
    "title": "Updated Title",
    "tags": ["updated", "important"]
  }
}
```

**Response (200 OK):**

```json
{
  "id": "doc_abc123def456",
  "status": "processing",
  "containerTag": "new-container",
  "metadata": {
    "title": "Updated Title",
    "tags": ["updated", "important"]
  },
  "createdAt": "2024-01-31T12:00:00Z",
  "updatedAt": "2024-01-31T12:30:00Z"
}
```

---

### Delete Document

Soft-deletes a document.

**Endpoint:** `DELETE /v3/documents/:id`

**Response (200 OK):**

```json
{
  "id": "doc_abc123def456",
  "status": "deleted",
  "deletedAt": "2024-01-31T13:00:00Z"
}
```

---

### List Documents

Lists documents with pagination and filtering.

**Endpoint:** `GET /v3/documents`

**Query Parameters:**

| Parameter    | Type    | Default | Description                        |
|--------------|---------|---------|----------------------------------|
| containerTag | String  | null    | Filter by container tag            |
| status       | String  | null    | Filter by status                   |
| contentType  | String  | null    | Filter by content type             |
| search       | String  | null    | Full-text search in title/metadata |
| limit        | Integer | 20      | Max results (1-100)                |
| offset       | Integer | 0       | Pagination offset                  |
| sortBy       | String  | createdAt | Sort field                       |
| sortOrder    | String  | desc    | Sort order (asc/desc)              |

**Response (200 OK):**

```json
{
  "documents": [
    {
      "id": "doc_abc123def456",
      "status": "completed",
      "contentType": "text",
      "containerTag": "work-notes",
      "metadata": {
        "title": "Meeting Notes",
        "wordCount": 250
      },
      "createdAt": "2024-01-31T12:00:00Z",
      "updatedAt": "2024-01-31T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### Bulk Delete Documents

Deletes multiple documents in a single request.

**Endpoint:** `POST /v3/documents/bulk-delete`

**Request Body:**

```json
{
  "documentIds": [
    "doc_abc123",
    "doc_def456",
    "doc_ghi789"
  ]
}
```

**Alternative: Delete by filter:**

```json
{
  "filter": {
    "containerTag": "old-notes",
    "createdBefore": "2023-01-01T00:00:00Z"
  }
}
```

**Response (200 OK):**

```json
{
  "deleted": 3,
  "failed": 0,
  "results": [
    { "id": "doc_abc123", "status": "deleted" },
    { "id": "doc_def456", "status": "deleted" },
    { "id": "doc_ghi789", "status": "deleted" }
  ]
}
```

**Response (207 Multi-Status):**

```json
{
  "deleted": 2,
  "failed": 1,
  "results": [
    { "id": "doc_abc123", "status": "deleted" },
    { "id": "doc_def456", "status": "deleted" },
    { "id": "doc_ghi789", "status": "failed", "error": "Document not found" }
  ]
}
```

---

## Search API

### Unified Search

Performs semantic and/or keyword search across documents.

**Endpoint:** `POST /v4/search`

**Request Body:**

```json
{
  "q": "How to implement authentication in Node.js",
  "containerTag": "development-notes",
  "searchMode": "hybrid",
  "limit": 10,
  "threshold": 0.7,
  "rerank": true,
  "rewriteQuery": true,
  "filters": {
    "contentType": ["text", "url"],
    "tags": ["nodejs", "security"],
    "createdAfter": "2024-01-01T00:00:00Z",
    "createdBefore": "2024-12-31T23:59:59Z"
  }
}
```

**Request Parameters:**

| Parameter    | Type     | Default  | Description                                |
|--------------|----------|----------|--------------------------------------------|
| q            | String   | Required | Search query                               |
| containerTag | String   | null     | Filter by container                        |
| searchMode   | String   | "hybrid" | Search mode: hybrid, memories, semantic, keyword |
| limit        | Integer  | 10       | Max results (1-50)                         |
| threshold    | Float    | 0.5      | Minimum similarity score (0.0-1.0)         |
| rerank       | Boolean  | false    | Apply cross-encoder reranking              |
| rewriteQuery | Boolean  | false    | Use LLM to optimize query                  |
| filters      | Object   | null     | Additional filters                         |

**Search Modes:**

| Mode     | Description                                      |
|----------|--------------------------------------------------|
| hybrid   | Combines semantic and keyword search (recommended) |
| memories | Semantic search with memory context              |
| semantic | Pure vector similarity search                    |
| keyword  | Traditional full-text search                     |

**Response (200 OK):**

```json
{
  "query": "How to implement authentication in Node.js",
  "rewrittenQuery": "Node.js authentication implementation JWT passport.js",
  "searchMode": "hybrid",
  "results": [
    {
      "id": "doc_abc123",
      "score": 0.92,
      "semanticScore": 0.89,
      "keywordScore": 0.95,
      "content": "Authentication in Node.js can be implemented using...",
      "highlights": [
        "**Authentication** in **Node.js** can be implemented..."
      ],
      "metadata": {
        "title": "Node.js Auth Guide",
        "source": "url",
        "url": "https://example.com/nodejs-auth"
      },
      "containerTag": "development-notes",
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 10,
    "hasMore": true
  },
  "timing": {
    "queryRewrite": 150,
    "embedding": 50,
    "search": 25,
    "rerank": 200,
    "total": 425
  }
}
```

---

## Profiles API

### Get User Profile

Retrieves a user profile by container tag.

**Endpoint:** `GET /v3/profiles/:containerTag`

**Path Parameters:**

| Parameter    | Type   | Required | Description         |
|--------------|--------|----------|---------------------|
| containerTag | String | Yes      | The container tag   |

**Response (200 OK):**

```json
{
  "containerTag": "work-notes",
  "displayName": "Work Notes",
  "description": "Professional documents and meeting notes",
  "settings": {
    "defaultSearchMode": "hybrid",
    "autoTag": true,
    "retentionDays": 365
  },
  "stats": {
    "documentCount": 150,
    "totalWords": 45000,
    "storageUsedBytes": 5242880
  },
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-31T12:00:00Z"
}
```

---

### Update User Profile

Updates a user profile.

**Endpoint:** `PUT /v3/profiles/:containerTag`

**Request Body:**

```json
{
  "displayName": "Updated Work Notes",
  "description": "Updated description",
  "settings": {
    "defaultSearchMode": "semantic",
    "autoTag": false,
    "retentionDays": 730
  }
}
```

**Response (200 OK):**

```json
{
  "containerTag": "work-notes",
  "displayName": "Updated Work Notes",
  "description": "Updated description",
  "settings": {
    "defaultSearchMode": "semantic",
    "autoTag": false,
    "retentionDays": 730
  },
  "updatedAt": "2024-01-31T13:00:00Z"
}
```

---

## Connections API

### Create OAuth Connection

Initiates an OAuth connection with a third-party provider.

**Endpoint:** `POST /v3/connections/:provider`

**Path Parameters:**

| Parameter | Type   | Required | Description                              |
|-----------|--------|----------|------------------------------------------|
| provider  | String | Yes      | Provider name: google, notion, twitter, github |

**Request Body:**

```json
{
  "redirectUri": "https://app.supermemory.local/oauth/callback",
  "scopes": ["read", "write"],
  "containerTag": "google-docs"
}
```

**Response (200 OK):**

```json
{
  "authUrl": "https://accounts.google.com/oauth/authorize?client_id=...",
  "state": "state_abc123",
  "expiresIn": 600
}
```

---

### List Connections

Lists all active OAuth connections.

**Endpoint:** `GET /v3/connections`

**Query Parameters:**

| Parameter | Type   | Default | Description          |
|-----------|--------|---------|----------------------|
| provider  | String | null    | Filter by provider   |
| status    | String | null    | Filter by status     |

**Response (200 OK):**

```json
{
  "connections": [
    {
      "id": "conn_abc123",
      "provider": "google",
      "email": "user@example.com",
      "status": "active",
      "containerTag": "google-docs",
      "scopes": ["read", "write"],
      "lastSyncAt": "2024-01-31T12:00:00Z",
      "createdAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "conn_def456",
      "provider": "notion",
      "workspaceName": "My Workspace",
      "status": "active",
      "containerTag": "notion-pages",
      "scopes": ["read"],
      "lastSyncAt": "2024-01-31T11:00:00Z",
      "createdAt": "2024-01-15T00:00:00Z"
    }
  ]
}
```

**Connection Status Values:**
- `active`: Connection is active and syncing
- `expired`: OAuth token has expired
- `revoked`: User revoked access
- `error`: Connection has errors

---

### Delete Connection

Removes an OAuth connection.

**Endpoint:** `DELETE /v3/connections/:id`

**Path Parameters:**

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| id        | String | Yes      | The connection ID |

**Query Parameters:**

| Parameter       | Type    | Default | Description                    |
|-----------------|---------|---------|--------------------------------|
| deleteDocuments | Boolean | false   | Also delete synced documents   |

**Response (200 OK):**

```json
{
  "id": "conn_abc123",
  "status": "deleted",
  "documentsDeleted": 0,
  "deletedAt": "2024-01-31T13:00:00Z"
}
```

---

## OpenAPI 3.0 Specification

```yaml
openapi: 3.0.3
info:
  title: Supermemory API
  description: Personal knowledge management API with semantic search
  version: 3.0.0
  contact:
    email: api@supermemory.local
  license:
    name: MIT
    url: https://opensource.org/licenses/MIT

servers:
  - url: https://api.supermemory.local/api
    description: Production server
  - url: https://staging-api.supermemory.local/api
    description: Staging server
  - url: http://localhost:3000/api
    description: Local development

security:
  - bearerAuth: []

tags:
  - name: Documents
    description: Document management operations
  - name: Search
    description: Search and retrieval operations
  - name: Profiles
    description: User profile management
  - name: Connections
    description: OAuth connection management

paths:
  /v3/documents:
    post:
      tags:
        - Documents
      summary: Add document
      description: Creates a new document from text, URL, or file reference
      operationId: createDocument
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateDocumentRequest'
      responses:
        '201':
          description: Document created successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Document'
        '202':
          description: Document accepted for processing
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DocumentProcessing'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '429':
          $ref: '#/components/responses/RateLimited'

    get:
      tags:
        - Documents
      summary: List documents
      description: Lists documents with pagination and filtering
      operationId: listDocuments
      parameters:
        - $ref: '#/components/parameters/ContainerTagQuery'
        - $ref: '#/components/parameters/StatusQuery'
        - $ref: '#/components/parameters/LimitQuery'
        - $ref: '#/components/parameters/OffsetQuery'
      responses:
        '200':
          description: Documents retrieved successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DocumentList'
        '401':
          $ref: '#/components/responses/Unauthorized'

  /v3/documents/{id}:
    get:
      tags:
        - Documents
      summary: Get document
      description: Retrieves a document by ID
      operationId: getDocument
      parameters:
        - $ref: '#/components/parameters/DocumentId'
        - name: includeContent
          in: query
          schema:
            type: boolean
            default: false
      responses:
        '200':
          description: Document retrieved successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Document'
        '404':
          $ref: '#/components/responses/NotFound'

    put:
      tags:
        - Documents
      summary: Update document
      description: Updates a document's content or metadata
      operationId: updateDocument
      parameters:
        - $ref: '#/components/parameters/DocumentId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateDocumentRequest'
      responses:
        '200':
          description: Document updated successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Document'
        '404':
          $ref: '#/components/responses/NotFound'

    delete:
      tags:
        - Documents
      summary: Delete document
      description: Soft-deletes a document
      operationId: deleteDocument
      parameters:
        - $ref: '#/components/parameters/DocumentId'
      responses:
        '200':
          description: Document deleted successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DeletedDocument'
        '404':
          $ref: '#/components/responses/NotFound'

  /v3/documents/file:
    post:
      tags:
        - Documents
      summary: Upload file
      description: Uploads a file for processing
      operationId: uploadFile
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required:
                - file
              properties:
                file:
                  type: string
                  format: binary
                containerTag:
                  type: string
                metadata:
                  type: string
                  description: JSON string of metadata
      responses:
        '202':
          description: File accepted for processing
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DocumentProcessing'
        '422':
          $ref: '#/components/responses/UnprocessableEntity'

  /v3/documents/bulk-delete:
    post:
      tags:
        - Documents
      summary: Bulk delete documents
      description: Deletes multiple documents in a single request
      operationId: bulkDeleteDocuments
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/BulkDeleteRequest'
      responses:
        '200':
          description: All documents deleted successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BulkDeleteResponse'
        '207':
          description: Partial success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BulkDeleteResponse'

  /v4/search:
    post:
      tags:
        - Search
      summary: Unified search
      description: Performs semantic and/or keyword search across documents
      operationId: search
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SearchRequest'
      responses:
        '200':
          description: Search completed successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SearchResponse'
        '400':
          $ref: '#/components/responses/BadRequest'

  /v3/profiles/{containerTag}:
    get:
      tags:
        - Profiles
      summary: Get user profile
      description: Retrieves a user profile by container tag
      operationId: getProfile
      parameters:
        - name: containerTag
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Profile retrieved successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Profile'
        '404':
          $ref: '#/components/responses/NotFound'

    put:
      tags:
        - Profiles
      summary: Update user profile
      description: Updates a user profile
      operationId: updateProfile
      parameters:
        - name: containerTag
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateProfileRequest'
      responses:
        '200':
          description: Profile updated successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Profile'

  /v3/connections:
    get:
      tags:
        - Connections
      summary: List connections
      description: Lists all active OAuth connections
      operationId: listConnections
      parameters:
        - name: provider
          in: query
          schema:
            type: string
            enum: [google, notion, twitter, github]
      responses:
        '200':
          description: Connections retrieved successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ConnectionList'

  /v3/connections/{provider}:
    post:
      tags:
        - Connections
      summary: Create OAuth connection
      description: Initiates an OAuth connection with a third-party provider
      operationId: createConnection
      parameters:
        - name: provider
          in: path
          required: true
          schema:
            type: string
            enum: [google, notion, twitter, github]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateConnectionRequest'
      responses:
        '200':
          description: OAuth URL generated successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OAuthInitResponse'

  /v3/connections/{id}:
    delete:
      tags:
        - Connections
      summary: Delete connection
      description: Removes an OAuth connection
      operationId: deleteConnection
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: deleteDocuments
          in: query
          schema:
            type: boolean
            default: false
      responses:
        '200':
          description: Connection deleted successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DeletedConnection'

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  parameters:
    DocumentId:
      name: id
      in: path
      required: true
      schema:
        type: string
      description: The document ID

    ContainerTagQuery:
      name: containerTag
      in: query
      schema:
        type: string
      description: Filter by container tag

    StatusQuery:
      name: status
      in: query
      schema:
        type: string
        enum: [processing, completed, failed, deleted]
      description: Filter by document status

    LimitQuery:
      name: limit
      in: query
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20
      description: Maximum number of results

    OffsetQuery:
      name: offset
      in: query
      schema:
        type: integer
        minimum: 0
        default: 0
      description: Pagination offset

  schemas:
    CreateDocumentRequest:
      type: object
      required:
        - content
        - contentType
      properties:
        content:
          type: string
          description: Text content or URL
        contentType:
          type: string
          enum: [text, url, markdown, html]
        containerTag:
          type: string
        metadata:
          $ref: '#/components/schemas/DocumentMetadata'

    UpdateDocumentRequest:
      type: object
      properties:
        content:
          type: string
        containerTag:
          type: string
        metadata:
          $ref: '#/components/schemas/DocumentMetadata'

    Document:
      type: object
      properties:
        id:
          type: string
        status:
          type: string
          enum: [processing, completed, failed, deleted]
        contentType:
          type: string
        containerTag:
          type: string
        content:
          type: string
        metadata:
          $ref: '#/components/schemas/DocumentMetadata'
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time

    DocumentProcessing:
      type: object
      properties:
        id:
          type: string
        status:
          type: string
          enum: [processing]
        contentType:
          type: string
        containerTag:
          type: string
        createdAt:
          type: string
          format: date-time
        estimatedProcessingTime:
          type: integer
          description: Estimated processing time in seconds

    DocumentMetadata:
      type: object
      properties:
        title:
          type: string
        source:
          type: string
        tags:
          type: array
          items:
            type: string
        wordCount:
          type: integer
        chunkCount:
          type: integer
        url:
          type: string
          format: uri

    DocumentList:
      type: object
      properties:
        documents:
          type: array
          items:
            $ref: '#/components/schemas/Document'
        pagination:
          $ref: '#/components/schemas/Pagination'

    DeletedDocument:
      type: object
      properties:
        id:
          type: string
        status:
          type: string
          enum: [deleted]
        deletedAt:
          type: string
          format: date-time

    BulkDeleteRequest:
      type: object
      properties:
        documentIds:
          type: array
          items:
            type: string
        filter:
          type: object
          properties:
            containerTag:
              type: string
            createdBefore:
              type: string
              format: date-time

    BulkDeleteResponse:
      type: object
      properties:
        deleted:
          type: integer
        failed:
          type: integer
        results:
          type: array
          items:
            type: object
            properties:
              id:
                type: string
              status:
                type: string
              error:
                type: string

    SearchRequest:
      type: object
      required:
        - q
      properties:
        q:
          type: string
          description: Search query
        containerTag:
          type: string
        searchMode:
          type: string
          enum: [hybrid, memories, semantic, keyword]
          default: hybrid
        limit:
          type: integer
          minimum: 1
          maximum: 50
          default: 10
        threshold:
          type: number
          minimum: 0
          maximum: 1
          default: 0.5
        rerank:
          type: boolean
          default: false
        rewriteQuery:
          type: boolean
          default: false
        filters:
          $ref: '#/components/schemas/SearchFilters'

    SearchFilters:
      type: object
      properties:
        contentType:
          type: array
          items:
            type: string
        tags:
          type: array
          items:
            type: string
        createdAfter:
          type: string
          format: date-time
        createdBefore:
          type: string
          format: date-time

    SearchResponse:
      type: object
      properties:
        query:
          type: string
        rewrittenQuery:
          type: string
        searchMode:
          type: string
        results:
          type: array
          items:
            $ref: '#/components/schemas/SearchResult'
        pagination:
          $ref: '#/components/schemas/Pagination'
        timing:
          $ref: '#/components/schemas/SearchTiming'

    SearchResult:
      type: object
      properties:
        id:
          type: string
        score:
          type: number
        semanticScore:
          type: number
        keywordScore:
          type: number
        content:
          type: string
        highlights:
          type: array
          items:
            type: string
        metadata:
          $ref: '#/components/schemas/DocumentMetadata'
        containerTag:
          type: string
        createdAt:
          type: string
          format: date-time

    SearchTiming:
      type: object
      properties:
        queryRewrite:
          type: integer
        embedding:
          type: integer
        search:
          type: integer
        rerank:
          type: integer
        total:
          type: integer

    Profile:
      type: object
      properties:
        containerTag:
          type: string
        displayName:
          type: string
        description:
          type: string
        settings:
          $ref: '#/components/schemas/ProfileSettings'
        stats:
          $ref: '#/components/schemas/ProfileStats'
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time

    ProfileSettings:
      type: object
      properties:
        defaultSearchMode:
          type: string
          enum: [hybrid, memories, semantic, keyword]
        autoTag:
          type: boolean
        retentionDays:
          type: integer

    ProfileStats:
      type: object
      properties:
        documentCount:
          type: integer
        totalWords:
          type: integer
        storageUsedBytes:
          type: integer

    UpdateProfileRequest:
      type: object
      properties:
        displayName:
          type: string
        description:
          type: string
        settings:
          $ref: '#/components/schemas/ProfileSettings'

    Connection:
      type: object
      properties:
        id:
          type: string
        provider:
          type: string
        email:
          type: string
        workspaceName:
          type: string
        status:
          type: string
          enum: [active, expired, revoked, error]
        containerTag:
          type: string
        scopes:
          type: array
          items:
            type: string
        lastSyncAt:
          type: string
          format: date-time
        createdAt:
          type: string
          format: date-time

    ConnectionList:
      type: object
      properties:
        connections:
          type: array
          items:
            $ref: '#/components/schemas/Connection'

    CreateConnectionRequest:
      type: object
      required:
        - redirectUri
      properties:
        redirectUri:
          type: string
          format: uri
        scopes:
          type: array
          items:
            type: string
        containerTag:
          type: string

    OAuthInitResponse:
      type: object
      properties:
        authUrl:
          type: string
          format: uri
        state:
          type: string
        expiresIn:
          type: integer

    DeletedConnection:
      type: object
      properties:
        id:
          type: string
        status:
          type: string
          enum: [deleted]
        documentsDeleted:
          type: integer
        deletedAt:
          type: string
          format: date-time

    Pagination:
      type: object
      properties:
        total:
          type: integer
        limit:
          type: integer
        offset:
          type: integer
        hasMore:
          type: boolean

    Error:
      type: object
      properties:
        error:
          type: object
          properties:
            code:
              type: string
            message:
              type: string
            details:
              type: object
            requestId:
              type: string

  responses:
    BadRequest:
      description: Bad request
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'
          example:
            error:
              code: VALIDATION_ERROR
              message: Invalid request body
              requestId: req_abc123

    Unauthorized:
      description: Unauthorized
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'
          example:
            error:
              code: INVALID_TOKEN
              message: The provided token is invalid or expired
              requestId: req_abc123

    NotFound:
      description: Resource not found
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'
          example:
            error:
              code: RESOURCE_NOT_FOUND
              message: The requested resource was not found
              requestId: req_abc123

    UnprocessableEntity:
      description: Unprocessable entity
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'
          example:
            error:
              code: UNSUPPORTED_FORMAT
              message: The file format is not supported
              requestId: req_abc123

    RateLimited:
      description: Rate limit exceeded
      headers:
        X-RateLimit-Limit:
          schema:
            type: integer
        X-RateLimit-Remaining:
          schema:
            type: integer
        X-RateLimit-Reset:
          schema:
            type: integer
        Retry-After:
          schema:
            type: integer
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'
          example:
            error:
              code: RATE_LIMIT_EXCEEDED
              message: Too many requests. Please retry after 60 seconds.
              retryAfter: 60
```

---

## Implementation Notes

### Document Processing Pipeline

1. **Ingestion**: Accept content via API
2. **Validation**: Validate content type, size limits
3. **Extraction**: For URLs/files, extract text content
4. **Chunking**: Split content into semantic chunks (512 tokens default)
5. **Embedding**: Generate vector embeddings for each chunk
6. **Indexing**: Store in vector database with metadata
7. **Status Update**: Mark document as completed

### Search Pipeline

1. **Query Processing**: Validate and optionally rewrite query
2. **Query Embedding**: Generate vector for semantic search
3. **Hybrid Search**: Execute both semantic and keyword search
4. **Score Fusion**: Combine scores using reciprocal rank fusion
5. **Reranking**: (Optional) Apply cross-encoder for better relevance
6. **Response**: Return ranked results with highlights

### Security Considerations

- All endpoints require authentication
- Input validation on all request bodies
- Content sanitization for stored documents
- Rate limiting to prevent abuse
- Audit logging for sensitive operations
- Encryption at rest for document content
