# Relationship Detection - C4 Architecture Diagrams

> Status: **Implemented** - These diagrams reflect the current implementation in `src/services/relationships/`

## Level 1: System Context

```mermaid
C4Context
    title System Context - Memory Relationship Detection

    Person(user, "User", "Creates memories through conversations or API")

    System(supermemory, "Supermemory System", "Stores and relates personal memories using semantic understanding")

    System_Ext(openai, "OpenAI API", "Provides embeddings and LLM capabilities")
    System_Ext(vectordb, "Vector Database", "Future: Persistent vector storage")

    Rel(user, supermemory, "Creates/queries memories", "API/SDK")
    Rel(supermemory, openai, "Generates embeddings", "HTTPS")
    Rel(supermemory, vectordb, "Stores/searches vectors", "SDK")
```

## Level 2: Container Diagram

```mermaid
C4Container
    title Container Diagram - Relationship Detection System

    Person(user, "User")

    Container_Boundary(supermemory, "Supermemory System") {
        Container(api, "API Layer", "Node.js/Express", "Handles HTTP requests and authentication")
        Container(memservice, "Memory Service", "TypeScript", "Orchestrates memory operations")
        Container(reldetector, "Relationship Detector", "TypeScript", "Detects semantic relationships")
        Container(embservice, "Embedding Service", "TypeScript", "Generates vector embeddings")
        Container(searchservice, "Search Service", "TypeScript", "Hybrid search capabilities")
        Container(vectorstore, "Vector Store", "In-Memory/SQLite", "Stores and searches embeddings")
        Container(memrepo, "Memory Repository", "TypeScript", "Persistence layer")
        ContainerDb(sqlite, "SQLite Database", "SQLite", "Stores memories, relationships, chunks")
    }

    System_Ext(openai, "OpenAI API")

    Rel(user, api, "HTTP/REST")
    Rel(api, memservice, "Calls")
    Rel(memservice, reldetector, "Detects relationships")
    Rel(memservice, memrepo, "CRUD operations")
    Rel(reldetector, embservice, "Gets embeddings")
    Rel(reldetector, vectorstore, "Candidate retrieval")
    Rel(searchservice, vectorstore, "Searches")
    Rel(searchservice, embservice, "Embeds queries")
    Rel(embservice, openai, "API calls")
    Rel(memrepo, sqlite, "SQL queries")
    Rel(vectorstore, sqlite, "Stores vectors")
```

## Level 3: Component Diagram - Relationship Detector (As Implemented)

```mermaid
C4Component
    title Component Diagram - Relationship Detector Module (Actual Implementation)

    Container_Boundary(reldetector, "Relationship Detector (src/services/relationships/)") {
        Component(types, "types.ts", "Module", "Type definitions, interfaces, configuration")
        Component(detector, "detector.ts", "Class", "EmbeddingRelationshipDetector - main orchestrator")
        Component(strategies, "strategies.ts", "Classes", "SimilarityStrategy, TemporalStrategy, EntityOverlapStrategy, LLMVerificationStrategy, HybridStrategy")
        Component(vectoradapter, "InMemoryVectorStoreAdapter", "Class", "In-memory vector storage for candidate retrieval")
        Component(index, "index.ts", "Module", "Exports, factory functions, singleton management")
    }

    Container(embservice, "EmbeddingService", "External")
    Container(memservice, "MemoryService", "External")

    Rel(memservice, index, "getRelationshipDetector()")
    Rel(index, detector, "Creates/manages singleton")
    Rel(detector, strategies, "Executes detection strategies")
    Rel(detector, vectoradapter, "findSimilar()")
    Rel(detector, embservice, "generateEmbedding()")
    Rel(strategies, types, "Uses RelationshipConfig")
    Rel(vectoradapter, types, "Implements VectorStore interface")
```

## Strategy Pattern (As Implemented)

```mermaid
classDiagram
    class DetectionStrategy {
        <<interface>>
        +name: DetectionStrategyType
        +detect(input: StrategyInput): Promise~StrategyOutput~
        +shouldApply(config: RelationshipConfig): boolean
    }

    class SimilarityStrategy {
        +name = "similarity"
        +detect(input): Promise~StrategyOutput~
        +shouldApply(config): boolean
    }

    class TemporalStrategy {
        +name = "temporal"
        +detect(input): Promise~StrategyOutput~
        +shouldApply(config): boolean
    }

    class EntityOverlapStrategy {
        +name = "entityOverlap"
        +detect(input): Promise~StrategyOutput~
        +shouldApply(config): boolean
    }

    class LLMVerificationStrategy {
        +name = "llmVerification"
        -llmProvider: LLMProvider
        +detect(input): Promise~StrategyOutput~
        +shouldApply(config): boolean
        +setLLMProvider(provider): void
    }

    class HybridStrategy {
        +name = "hybrid"
        -strategies: DetectionStrategy[]
        +detect(input): Promise~StrategyOutput~
        +shouldApply(config): boolean
        +addStrategy(strategy): void
    }

    DetectionStrategy <|.. SimilarityStrategy
    DetectionStrategy <|.. TemporalStrategy
    DetectionStrategy <|.. EntityOverlapStrategy
    DetectionStrategy <|.. LLMVerificationStrategy
    DetectionStrategy <|.. HybridStrategy
    HybridStrategy o-- DetectionStrategy : contains
```

## Level 4: Code Diagram - Detection Flow (As Implemented)

```mermaid
sequenceDiagram
    participant Client
    participant RD as EmbeddingRelationshipDetector
    participant VS as InMemoryVectorStoreAdapter
    participant ES as EmbeddingService
    participant Strat as HybridStrategy
    participant SS as SimilarityStrategy
    participant TS as TemporalStrategy
    participant EOS as EntityOverlapStrategy

    Client->>RD: detectRelationships(memory, options)

    RD->>ES: getOrGenerateEmbedding(memory)
    ES-->>RD: embedding[]

    RD->>VS: findSimilar(embedding, limit, threshold, filters)
    VS-->>RD: VectorSearchResult[]

    RD->>RD: buildCandidates(memory, searchResults)
    Note over RD: Calculate temporal score, entity overlap

    RD->>Strat: detect({newMemory, candidates, config})

    par Parallel Strategy Execution
        Strat->>SS: detect(input)
        SS-->>Strat: StrategyOutput
    and
        Strat->>TS: detect(input)
        TS-->>Strat: StrategyOutput
    and
        Strat->>EOS: detect(input)
        EOS-->>Strat: StrategyOutput
    end

    Strat->>Strat: mergeResults()
    Strat-->>RD: StrategyOutput

    opt Contradiction Detection Enabled
        RD->>RD: detectContradictions(memory, candidates)
    end

    RD-->>Client: RelationshipDetectionResult
```

## Data Flow Diagram

```mermaid
flowchart TB
    subgraph Input
        NM[New Memory]
        EM[Existing Memories]
    end

    subgraph "Embedding Generation"
        EMB[Embedding Service]
        NE[New Embedding]
        EE[Existing Embeddings]
    end

    subgraph "Candidate Scoring"
        CS[Cosine Similarity]
        TS[Temporal Score]
        EO[Entity Overlap]
        COMB[Combined Score]
    end

    subgraph "Classification"
        THR{Threshold Check}
        UPD[Updates]
        EXT[Extends]
        REL[Related]
        CON[Contradicts]
    end

    subgraph "Verification"
        LLM{LLM Verify?}
        VER[Verified Relationship]
    end

    subgraph Output
        DR[Detected Relationships]
        SM[Superseded Memory IDs]
        CTR[Contradictions]
    end

    NM --> EMB
    EM --> EMB
    EMB --> NE
    EMB --> EE

    NE --> CS
    EE --> CS
    NM --> TS
    EM --> TS
    NM --> EO
    EM --> EO

    CS --> COMB
    TS --> COMB
    EO --> COMB

    COMB --> THR
    THR -->|>= 0.85| UPD
    THR -->|>= 0.75| EXT
    THR -->|>= 0.70| REL
    THR -->|>= 0.60 + indicators| CON

    UPD --> LLM
    CON --> LLM
    EXT --> DR
    REL --> DR

    LLM -->|Yes| VER
    LLM -->|No| DR
    VER --> DR

    UPD --> SM
    DR --> Output
    SM --> Output
    CON --> CTR
    CTR --> Output
```

## State Diagram - Memory Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: Memory extracted

    Created --> Embedded: Generate embedding
    Embedded --> Indexed: Add to vector store

    Indexed --> RelationshipCheck: Detect relationships

    RelationshipCheck --> Latest: No updates found
    RelationshipCheck --> Superseded: Update detected
    RelationshipCheck --> Extended: Extension found
    RelationshipCheck --> Contradicted: Contradiction detected

    Latest --> [*]: Active memory
    Superseded --> [*]: isLatest = false
    Extended --> [*]: Link to extending memory
    Contradicted --> [*]: Flag for review

    note right of Superseded
        Memory marked with:
        - isLatest = false
        - supersededBy = newMemoryId
    end note
```

## Threshold Configuration Visualization (As Implemented)

```mermaid
graph LR
    subgraph "Actual Thresholds (DEFAULT_RELATIONSHIP_THRESHOLDS)"
        S0[0.0]
        S60[0.60 - Related]
        S65[0.65 - Derives]
        S70[0.70 - Extends]
        S80[0.80 - Contradicts]
        S85[0.85 - Updates]
        S90[0.90 - Supersedes]
        S100[1.0]
    end

    S0 -->|"< 0.60: No relationship"| S60
    S60 -->|"0.60-0.65: Related"| S65
    S65 -->|"0.65-0.70: Derives (causal)"| S70
    S70 -->|"0.70-0.80: Extends"| S80
    S80 -->|"0.80-0.85: Contradicts"| S85
    S85 -->|"0.85-0.90: Updates"| S90
    S90 -->|"0.90-1.0: Supersedes"| S100

    style S60 fill:#e0e0e0
    style S65 fill:#fff3e0
    style S70 fill:#e8f5e9
    style S80 fill:#ffebee
    style S85 fill:#e3f2fd
    style S90 fill:#f3e5f5
```

## Integration Architecture

```mermaid
flowchart TB
    subgraph "API Layer"
        API[REST API]
    end

    subgraph "Service Layer"
        MS[MemoryService]
        SS[SearchService]
        PS[ProfileService]
    end

    subgraph "Relationship Detection"
        RD[RelationshipDetector]
        Config[RelationshipConfig]
    end

    subgraph "Core Services"
        ES[EmbeddingService]
        VS[VectorStore]
    end

    subgraph "Storage"
        MR[MemoryRepository]
        DB[(SQLite)]
    end

    API --> MS
    API --> SS

    MS --> RD
    MS --> MR
    SS --> VS
    SS --> ES

    RD --> ES
    RD --> VS
    RD --> Config

    MR --> DB
    VS --> DB

    style RD fill:#e1f5fe
    style Config fill:#e1f5fe
```

## File Structure

```
src/services/relationships/
    types.ts        - Type definitions, interfaces, configuration constants
                      - RelationshipConfig, RelationshipThresholds
                      - DetectedRelationship, Contradiction
                      - VectorStore, LLMProvider interfaces
                      - generateCacheKey utility

    strategies.ts   - Detection strategy implementations
                      - SimilarityStrategy (cosine similarity thresholds)
                      - TemporalStrategy (time-based inference)
                      - EntityOverlapStrategy (shared entity detection)
                      - LLMVerificationStrategy (LLM classification)
                      - HybridStrategy (combines all strategies)
                      - createStrategy, createDefaultStrategy factories

    detector.ts     - Main detector class
                      - EmbeddingRelationshipDetector
                      - InMemoryVectorStoreAdapter
                      - Caching, batch processing
                      - Contradiction detection

    index.ts        - Module exports and factories
                      - getRelationshipDetector singleton
                      - createRelationshipDetector factory
                      - Convenience functions (detectRelationshipsQuick, etc.)
                      - Integration helpers (indexMemoryForRelationships, etc.)
```

## Key Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Lines of Code | ~1,100 | Across 4 files |
| Detection Strategies | 5 | Similarity, Temporal, Entity, LLM, Hybrid |
| Relationship Types | 6 | updates, extends, derives, contradicts, related, supersedes |
| Default Thresholds | 6 | 0.60 to 0.90 |
| Cache TTL | 5 min | Configurable |
