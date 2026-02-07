# Supermemory Documentation Analysis

## Executive Summary

Supermemory is a production-ready "Memory API for the AI era" that provides scalable, powerful, and affordable memory and RAG (Retrieval-Augmented Generation) capabilities. Unlike traditional vector databases or simple RAG systems, Supermemory builds a living knowledge graph where memories connect to other memories, supporting temporal evolution, relationship tracking, and intelligent context management for LLM applications.

**Key Differentiators:**
- Graph-based memory architecture (not just vector similarity)
- Automatic user profile construction from interactions
- Temporal awareness with memory updates, extensions, and derivations
- Hybrid Memory + RAG approach for optimal context retrieval
- 50-100ms profile retrieval vs 200-500ms for multiple search queries

---

## Core Features & Capabilities

### 1. Memory APIs
- **Hyper-fast, scalable, and composable APIs** for memory and RAG operations
- **Real-time context evolution** - Knowledge updates dynamically on top of existing context
- **Intelligent knowledge management** - Handles updates, temporal changes, and forgetfulness
- **Semantic understanding graph** constructed at ingestion time
- **Entity-based containers** - Organize by users, documents, projects, or organizations

### 2. User Profiles
- **Automatic construction** - Builds profiles from user interactions without manual intervention
- **Dual-layer system:**
  - **Static profiles**: Long-term stable information (professional background, expertise, preferences)
  - **Dynamic profiles**: Recent context and temporary states (current projects, upcoming events)
- **Performance optimization**: Single call retrieval (50-100ms) vs multiple queries (200-500ms)
- **Four-step process**: Content ingestion → AI fact extraction → Profile updates → Continuous refinement

### 3. Document Management
- **Supported content types:**
  - Text and conversations
  - URLs (auto-extracted)
  - PDFs, DOCs, images, spreadsheets
  - YouTube videos and MP4s
  - Markdown and HTML
- **File support**: Maximum 50MB per file
- **Processing capabilities**: OCR, transcription, structured data extraction
- **Batch operations**: Upload multiple documents efficiently
- **Update mechanisms**: Intelligent incremental updates via customId

### 4. Search & Retrieval
- **Multi-mode search:**
  - Document search with semantic similarity
  - Memory entry search across knowledge graph
  - User profile-based context retrieval
- **Advanced filtering:**
  - Nested AND/OR logic (up to 5 levels deep)
  - Four filter types: metadata, numeric, array_contains, string_contains
  - Container tag filtering for multi-tenancy
- **Configurable thresholds**: Balance between recall and precision
- **Graph traversal**: Follows relationship chains for comprehensive context

### 5. Connectors & Integrations
**Six cloud connectors:**
1. **Google Drive** - Real-time sync via webhooks for Docs, Slides, Sheets
2. **Gmail** - Email thread processing with Pub/Sub webhooks
3. **Notion** - Pages, databases, blocks with instant sync
4. **OneDrive** - Office documents via scheduled updates
5. **GitHub** - Repository monitoring with incremental sync
6. **Web Crawler** - Automatic page indexing (respects robots.txt)

**12+ platform integrations:**
- Claude Code, Claude Memory Tool
- LangChain, OpenAI SDK, Vercel AI SDK
- n8n, Zapier, Pipecat
- OpenCode, OpenClaw
- Memory Graph, Supermemory SDK

**Sync mechanisms:**
- Real-time webhook triggers for supported platforms
- Scheduled sync every 4 hours for all connectors
- Manual on-demand synchronization
- Web crawler: 7+ day recrawl intervals

---

## Architecture Overview

### System Architecture

**Supermemory operates as a knowledge graph system** that transforms raw documents into interconnected semantic units called "memories." The platform distinguishes between:
- **Documents**: Raw materials you provide (PDFs, web pages, text, images, videos)
- **Memories**: Intelligent Knowledge Units generated through semantic processing

### Processing Pipeline (6 Stages)

```
1. QUEUED       → Initial document intake
2. EXTRACTING   → Content retrieval from various formats
3. CHUNKING     → Breaking content into meaningful memory units
4. EMBEDDING    → Generating vectors for similarity matching
5. INDEXING     → Establishing relationships between memories
6. DONE         → Full searchability achieved
```

**Processing time:** Scales with content size
- 100-page PDF: 1-2 minutes
- 1-hour video: 5-10 minutes

### Graph Memory Architecture

**Structure:** Living knowledge graph where "facts are built on top of other facts" rather than traditional entity-relation-entity triples.

**Three relationship types:**

1. **Updates** - Handles contradictory information
   - New facts conflict with existing ones
   - Tracks currency via `isLatest` field
   - Ensures searches retrieve current info while maintaining history

2. **Extends** - Enriches knowledge without replacement
   - Additional details supplement existing memories
   - Provides comprehensive context in searches
   - No invalidation of previous knowledge

3. **Derives** - Infers insights from patterns
   - System generates new facts from observed relationships
   - Surfaces conclusions not explicitly stated
   - Enables intelligent reasoning

**Memory types extracted:**
- **Facts**: Persist until updated (e.g., "Alex works at Stripe")
- **Preferences**: Strengthen through repetition
- **Episodes**: Decay unless significant

**Automatic forgetting:**
- Time-sensitive memories expire automatically (meetings, deadlines)
- Contradictions resolve through Update relationships
- System maintains historical context while surfacing current state

### Memory vs RAG Architecture

| Aspect | RAG | Memory |
|--------|-----|--------|
| **Purpose** | "What do I know?" | "What do I remember about you?" |
| **Architecture** | Query → Embedding → Vector Search → Top-K → LLM | Query → Entity Recognition → Graph Traversal → Temporal Filter → Context Assembly → LLM |
| **State** | Stateless (each query independent) | Stateful (user/entity specific) |
| **Temporal** | All info equal | Tracks validity and invalidation |
| **Relationships** | Semantic similarity only | Understands causal chains |
| **Versioning** | No change tracking | Evolves over time |

**Supermemory's hybrid approach:** Combines RAG for universal knowledge with Memory for personalized context.

---

## API Endpoints & Interfaces

### Document Management API

**Base URL:** `https://api.supermemory.ai`

#### Add Document
```
POST /v3/documents
```
**Authentication:** Bearer token required

**Request parameters:**
- `content` (string, required): URL, PDF, image, video, or text content
- `containerTag` (string, optional): Organization tag (max 100 chars, alphanumeric + hyphens/underscores)
- `customId` (string, optional): Custom identifier for updates/deduplication (max 100 chars)
- `metadata` (object, optional): Custom key-value pairs (string, number, boolean, or string array values)

**Response (200):**
```json
{
  "id": "string",
  "status": "string"
}
```

**Error responses:**
- 401: Unauthorized (invalid token)
- 500: Internal server error

#### Batch Operations
```
POST /v3/documents/batch
```
Upload 3-5 documents per cycle with 1-2 second delays between batches.

#### File Upload
```
POST /v3/documents/upload
```
Streaming support for large files (max 50MB).

#### List Documents
```
GET /v3/documents
```
Pagination support with container tag filtering.

#### Update Document
```
PATCH /v3/documents/{id}
```
Full replacement or incremental updates via customId.

#### Delete Document
```
DELETE /v3/documents/{id}
```
Permanent deletion with no recovery.

### Search API

#### Search Documents
```
POST /v3/search
```

**Request parameters:**
- `chunkThreshold` (number, 0-1, default: 0): Sensitivity control (lower = more results, higher = better accuracy)
- `containerTags` (array of strings, optional): Filter by tags (user IDs, project IDs)
- `docId` (string, optional, max 255 chars): Restrict to specific document
- `filters` (object, optional): Complex filtering with nested AND/OR logic
  - `metadata`: Key-value matching
  - `numeric`: Comparisons (>, <, >=, <=, =)
  - `array_contains`: Array element matching
  - `string_contains`: Substring matching
  - `negate` & `ignoreCase`: Boolean modifiers

**Filter nesting:** Up to 5 levels deep

**Deprecated:** `documentThreshold` (use chunkThreshold instead)

#### Search Memory Entries
```
POST /v3/search/memories
```
Graph-based search with relationship traversal.

### Memory Operations API (v4)

#### Forget Memory
```
POST /v4/memories/{memoryId}/forget
```
Soft-delete: Excluded from search but preserved in system.

#### Update Memory (Versioned)
```
PATCH /v4/memories
```
Creates new version while preserving original with `isLatest=false`.

**Request body:**
- Memory identification (by ID or original content)
- New content
- Optional metadata

**Note:** SDK support coming soon - use fetch/cURL currently.

### User Profile API

**Profile retrieval:**
```typescript
client.profile({
  containerTag: "user_123",
  query: "conversation prompt",
  threshold: 0.7  // Optional relevance filter
})
```

Returns static facts + dynamic context + relevant memories.

### Connector API

**Create connection:**
```
POST /v3/connections
```

**Configure connection:**
```
PATCH /v3/connections/{id}
```

**List connections:**
```
GET /v3/connections
```

**Delete connection:**
```
DELETE /v3/connections/{id}
```

**Sync resources:**
```
POST /v3/connections/{id}/sync
```

**Fetch resources:**
```
GET /v3/connections/{id}/resources
```

---

## SDK Interfaces

### TypeScript/JavaScript SDK

**Installation:**
```bash
npm install supermemory
```

**Initialization:**
```typescript
import { Supermemory } from 'supermemory';

const client = new Supermemory({
  apiKey: process.env.SUPERMEMORY_API_KEY
});
```

**Core methods:**

```typescript
// Add memory with metadata
await client.add({
  content: "conversation or document content",
  containerTag: "user_123",
  customId: "conv_2024_01",
  metadata: {
    category: "support",
    priority: 1,
    tags: ["urgent", "billing"]
  }
});

// Search documents
const results = await client.search.documents({
  query: "search query",
  containerTags: ["user_123"],
  filters: {
    AND: [
      { metadata: { key: "category", value: "support" } },
      { numeric: { key: "priority", operator: ">=", value: 1 } }
    ]
  }
});

// Get user profile + relevant memories
const context = await client.profile({
  containerTag: "user_123",
  query: "current conversation",
  threshold: 0.7
});

// List documents
const docs = await client.documents.list({
  containerTag: "user_123",
  limit: 20,
  offset: 0
});

// Delete document
await client.documents.delete("doc_id");

// Upload file
await client.documents.uploadFile({
  file: fileStream,
  containerTag: "user_123",
  metadata: { source: "email" }
});
```

### Python SDK

**Installation:**
```bash
pip install supermemory
```

**Initialization:**
```python
from supermemory import Supermemory

client = Supermemory(api_key=os.environ["SUPERMEMORY_API_KEY"])
```

**Core methods:**
```python
# Add memory
client.add(
    content="conversation or document",
    container_tag="user_123",
    custom_id="conv_2024_01",
    metadata={"category": "support", "priority": 1}
)

# Search documents
results = client.search.documents(
    query="search query",
    container_tags=["user_123"],
    filters={
        "AND": [
            {"metadata": {"key": "category", "value": "support"}},
            {"numeric": {"key": "priority", "operator": ">=", "value": 1}}
        ]
    }
)

# Get profile
context = client.profile(
    container_tag="user_123",
    query="current conversation",
    threshold=0.7
)

# List documents
docs = client.documents.list(
    container_tag="user_123",
    limit=20
)

# Delete document
client.documents.delete("doc_id")
```

---

## Storage/Memory Mechanisms

### Vector Storage
- **Embedding generation**: Automatic vectorization during chunking phase
- **Similarity search**: Semantic matching via vector distance
- **Chunk-based retrieval**: Configurable threshold for precision/recall balance

### Graph Database
- **Entity extraction**: Automatic identification of entities and relationships
- **Relationship tracking**: Updates, Extends, Derives connections
- **Temporal indexing**: `isLatest` flags for version control
- **Graph traversal**: Follows relationship chains during retrieval

### Memory Versioning
- **Version history**: Original memories preserved when updated
- **Soft deletion**: Forgotten memories excluded from search but retained in database
- **Conflict resolution**: Update relationships handle contradictions
- **Temporal decay**: Episode-type memories fade unless significant

### Metadata Storage
- **Flexible schema**: Support for strings, numbers, booleans, string arrays
- **Hierarchical tagging**: Container tags for multi-tenant organization
- **Custom indexing**: User-defined metadata for filtering
- **Best practice**: Hierarchical tags like "org_456_team_backend"

### Processing Queue
- **Asynchronous processing**: Documents queued for background extraction
- **Status tracking**: Monitor processing through 6-stage pipeline
- **Rate limiting**: Recommended 1-2 second delays between batch uploads
- **Batch size**: 3-5 documents per upload cycle

---

## Local-only vs Cloud Features

### Cloud-Only Architecture
**Supermemory is exclusively a cloud-based service.** All processing, storage, and synchronization occur through Supermemory's infrastructure.

**Cloud-dependent features:**
- All connector synchronization (Google Drive, Gmail, Notion, OneDrive, GitHub, Web Crawler)
- Document processing pipeline (extraction, chunking, embedding, indexing)
- Vector and graph database storage
- API access and authentication
- User profile construction
- Real-time webhook processing
- Scheduled sync operations

### No Local Deployment Options
The documentation does **not mention**:
- Self-hosted deployment
- On-premise installation
- Local-only data storage
- Offline capabilities
- Private cloud deployment
- Edge computing support

### Data Flow
All data flows through Supermemory's cloud infrastructure:
1. Client uploads documents via API
2. Cloud processes and stores data
3. Connectors sync external sources to cloud
4. Client queries retrieve from cloud storage
5. No local caching or processing mentioned

### Privacy & Security Considerations
- **API key authentication**: Required for all operations
- **Bearer token security**: Standard OAuth-style authentication
- **Container tag isolation**: Multi-tenancy support
- **Permanent deletion**: No recovery after delete operations
- **Pro plan requirement**: Claude Code integration requires subscription

---

## Technical Insights

### Performance Characteristics

**Profile retrieval:**
- Single call: 50-100ms
- Traditional search: 200-500ms (3-5 queries)
- Improvement: 2-5x faster, 1 call vs 3-5 calls

**Processing times:**
- 100-page PDF: 1-2 minutes
- 1-hour video: 5-10 minutes
- Scales with content size and complexity

**Sync mechanisms:**
- Real-time webhooks: Instant for supported platforms
- Scheduled sync: Every 4 hours
- Manual trigger: On-demand
- Web crawler: 7+ day recrawl intervals

### Best Practices

**Container tags:**
- Use hierarchical structure: "org_456_team_backend"
- Consistent naming for multi-tenancy
- Max 100 characters, alphanumeric + hyphens/underscores

**Batch operations:**
- Upload 3-5 documents per cycle
- 1-2 second delays between batches
- Monitor rate limits (handle 429 errors)

**Update strategy:**
- Use customId for deduplication
- Incremental updates for conversations
- Full replacement for documents
- Version control via v4 API

**Error handling:**
- Handle 401 authentication errors
- Retry on 429 rate limits
- Monitor 500 server errors
- Permanent deletion has no recovery

**Metadata design:**
- Keep values simple (strings, numbers, booleans)
- Use arrays for multi-value fields
- Design for filter queries
- Consistent key naming

### Limitations & Constraints

**File size:** 50MB maximum per file
**Container tag:** 100 characters max
**Custom ID:** 100 characters max
**Doc ID search:** 255 characters max
**Filter nesting:** 5 levels deep max
**Batch size:** 3-5 documents recommended
**Deletion:** Permanent, no recovery

---

## Implementation Patterns

### 1. Personalized AI Assistant Pattern

```typescript
// Retrieve context at conversation start
const context = await client.profile({
  containerTag: userId,
  query: currentMessage,
  threshold: 0.7
});

// Enrich messages with context
const messages = [
  { role: "system", content: context.profile },
  ...context.memories,
  ...conversationHistory
];

// Get LLM response
const response = await llm.chat(messages);

// Store conversation for future retrieval
await client.add({
  content: JSON.stringify([
    { role: "user", content: currentMessage },
    { role: "assistant", content: response }
  ]),
  containerTag: userId,
  customId: `conv_${timestamp}`,
  metadata: { type: "conversation" }
});
```

### 2. Document Q&A Pattern

```typescript
// Upload documents
await client.documents.uploadFile({
  file: documentStream,
  containerTag: projectId,
  metadata: { type: "documentation", category: "api" }
});

// Search relevant chunks
const results = await client.search.documents({
  query: userQuestion,
  containerTags: [projectId],
  filters: {
    metadata: { key: "category", value: "api" }
  },
  chunkThreshold: 0.75  // Higher precision
});

// Generate answer with context
const answer = await llm.complete({
  context: results.chunks,
  question: userQuestion
});
```

### 3. Customer Support Bot Pattern

```typescript
// Sync support history
await client.connectors.create({
  type: "gmail",
  config: { labels: ["support"] },
  containerTag: "support_team"
});

// Query customer context
const context = await client.profile({
  containerTag: customerId,
  query: currentIssue,
  threshold: 0.6
});

// Search similar issues
const similar = await client.search.documents({
  query: currentIssue,
  containerTags: ["support_team"],
  filters: {
    metadata: { key: "status", value: "resolved" }
  }
});

// Generate contextual response
const response = await generateResponse(context, similar);
```

### 4. Knowledge Hub Pattern

```typescript
// Connect multiple sources
await Promise.all([
  client.connectors.create({ type: "notion", containerTag: orgId }),
  client.connectors.create({ type: "google_drive", containerTag: orgId }),
  client.connectors.create({ type: "github", containerTag: orgId })
]);

// Unified search across sources
const results = await client.search.documents({
  query: "authentication implementation",
  containerTags: [orgId],
  filters: {
    OR: [
      { metadata: { key: "source", value: "notion" } },
      { metadata: { key: "source", value: "github" } }
    ]
  }
});
```

---

## Use Cases

### 1. Chat Applications
Build conversational interfaces for:
- Twitter bookmarks
- PDF documents
- Company documentation
- Personal knowledge bases

### 2. Intelligent Search
- Product recommendations
- Document similarity matching
- Research paper analysis
- Contextual discovery

### 3. Agent Development
Construct intelligent agents with extended context for:
- Email management automation
- Meeting summarization
- Calendar coordination
- Task automation

### 4. Personal Knowledge Management
- Note organization and linking
- Cross-document concept connections
- Prevent information loss
- Knowledge graph visualization

### 5. Brand & Content Strategy
- Maintain consistent tone across content
- Analyze unique voice characteristics
- Context-informed writing suggestions
- Brand guideline enforcement

### 6. Healthcare Applications
- Secure patient record summarization
- Clinical information extraction
- Medical history analysis
- Decision support augmentation

### 7. Community Support
- Chat/forum history-powered chatbots
- Instant response generation
- Support workload reduction
- Knowledge base automation

### 8. Academic Tools
- Flashcard generation from notes
- Cross-material search
- Personalized study assistance
- Learning pattern recognition

### 9. Legal & Regulatory Work
- Contract and case law search
- Clause and obligation extraction
- Risk factor identification
- Compliance tracking

### 10. Organizational Knowledge
- Centralized documentation
- Cross-resource search
- New employee onboarding acceleration
- Institutional knowledge preservation

---

## Migration & Compatibility

### Migration from Competitors

**From Mem0:**
- Documentation available at `/docs/migration/from-mem0`
- Migration guides for API compatibility

**From Zep:**
- Documentation available at `/docs/migration/from-zep`
- Mapping of equivalent features

### API Versioning

**v3 API:** Current stable version
- Document management endpoints
- Search endpoints
- Connector endpoints
- Full SDK support

**v4 API:** New memory operations
- Versioned memory updates
- Soft-delete (forget) functionality
- SDK support coming soon
- Use fetch/cURL currently

---

## Integration Ecosystem

### Claude Code Integration
**Setup:**
1. Obtain API key from Supermemory console
2. Set environment variable: `SUPERMEMORY_CC_API_KEY`
3. Install plugin: `/plugin marketplace add supermemoryai/claude-supermemory`
4. Enable: `/plugin install claude-supermemory`

**Automatic capture:**
- Edit tool: Code modifications with before/after
- Write tool: File creation with metadata
- Bash tool: Command execution results
- Task tool: Agent spawning activities

**Configuration:**
- Settings file: `~/.supermemory-claude/settings.json`
- Skip specific tools: `SUPERMEMORY_SKIP_TOOLS`
- Debug logging: `SUPERMEMORY_DEBUG`
- Memory limits: Default 10 context, 20 project memories

**Requirements:** Supermemory Pro plan subscription

### Other Integrations
- **LangChain**: Memory provider integration
- **OpenAI SDK**: Context injection wrapper
- **Vercel AI SDK**: Middleware for memory
- **n8n**: Workflow automation nodes
- **Zapier**: Trigger and action support
- **Pipecat**: Voice assistant memory
- **Memory Graph**: Graph visualization
- **Supermemory MCP**: Model Context Protocol server

---

## Additional Resources

**Documentation:**
- Complete index: `https://supermemory.ai/docs/llms.txt`
- Dashboard: `https://console.supermemory.ai`
- API Reference: `https://api.supermemory.ai`

**Cookbook examples:**
1. Customer Support Bot
2. Document Q&A
3. Personal Assistant
4. Chat with Google Drive
5. Perplexity integration
6. AI SDK integration

**Tools:**
- MemoryBench: Benchmarking framework for memory systems
- Supermemory MCP: Model Context Protocol implementation

**Release Notes:**
- Changelog available in documentation
- Version migration guides
- Feature announcements

---

## Conclusion

Supermemory represents a significant evolution beyond traditional RAG systems by combining vector search with graph-based memory, temporal awareness, and automatic user profiling. Its cloud-first architecture, comprehensive connector ecosystem, and dual SDK support (TypeScript/Python) make it a production-ready solution for building context-aware AI applications.

**Key strengths:**
- Graph-based architecture enables relationship understanding
- Automatic user profiles reduce retrieval complexity
- Temporal awareness prevents outdated information
- Hybrid Memory + RAG approach optimizes for different query types
- Extensive integration ecosystem
- Production-ready performance (50-100ms profile retrieval)

**Considerations:**
- Cloud-only deployment (no local/on-premise options)
- Pro plan required for some integrations (Claude Code)
- v4 API features still maturing (SDK support pending)
- File size limits (50MB)
- Processing time scales with content size

**Best suited for:**
- Multi-user applications requiring personalized context
- Systems needing temporal knowledge management
- Applications combining document search with user preferences
- Production deployments requiring scalability
- Teams seeking comprehensive integration ecosystem
