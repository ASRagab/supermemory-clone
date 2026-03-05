/**
 * Pipeline Service Tests
 *
 * Tests for the document processing pipeline including extraction,
 * chunking, embedding, and storage stages.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Pipeline types
interface PipelineConfig {
  extractors: Extractor[]
  chunker: Chunker
  embedder: Embedder
  storage: Storage
  hooks?: PipelineHooks
}

interface PipelineHooks {
  onExtract?: (result: ExtractionResult) => void | Promise<void>
  onChunk?: (chunks: Chunk[]) => void | Promise<void>
  onEmbed?: (embeddings: number[][]) => void | Promise<void>
  onComplete?: (result: PipelineResult) => void | Promise<void>
  onError?: (error: Error, stage: string) => void | Promise<void>
}

interface Extractor {
  canHandle(content: string | Buffer): boolean
  extract(content: string | Buffer, options?: Record<string, unknown>): Promise<ExtractionResult>
}

interface ExtractionResult {
  content: string
  contentType: string
  metadata: Record<string, unknown>
  rawContent?: string
}

interface Chunker {
  chunk(content: string, options?: ChunkOptions): Chunk[]
}

interface ChunkOptions {
  maxSize?: number
  overlap?: number
  preserveSentences?: boolean
}

interface Chunk {
  content: string
  index: number
  startOffset: number
  endOffset: number
}

interface Embedder {
  embed(texts: string[]): Promise<number[][]>
}

interface Storage {
  store(document: StorageDocument): Promise<string>
}

interface StorageDocument {
  content: string
  chunks: Array<Chunk & { embedding: number[] }>
  metadata: Record<string, unknown>
}

interface PipelineResult {
  documentId: string
  chunks: number
  extractionMetadata: Record<string, unknown>
  timing: {
    extraction: number
    chunking: number
    embedding: number
    storage: number
    total: number
  }
}

// Pipeline implementation
class DocumentPipeline {
  private config: PipelineConfig

  constructor(config: PipelineConfig) {
    this.config = config
  }

  async process(input: string | Buffer): Promise<PipelineResult> {
    const startTime = Date.now()
    const timing = {
      extraction: 0,
      chunking: 0,
      embedding: 0,
      storage: 0,
      total: 0,
    }

    try {
      // Stage 1: Extraction
      const extractStart = Date.now()
      const extractor = this.config.extractors.find((e) => e.canHandle(input))
      if (!extractor) {
        throw new Error('No extractor found for content')
      }
      const extracted = await extractor.extract(input)
      timing.extraction = Date.now() - extractStart

      if (this.config.hooks?.onExtract) {
        await this.config.hooks.onExtract(extracted)
      }

      // Stage 2: Chunking
      const chunkStart = Date.now()
      const chunks = this.config.chunker.chunk(extracted.content)
      timing.chunking = Date.now() - chunkStart

      if (this.config.hooks?.onChunk) {
        await this.config.hooks.onChunk(chunks)
      }

      if (chunks.length === 0) {
        throw new Error('No chunks generated from content')
      }

      // Stage 3: Embedding
      const embedStart = Date.now()
      const embeddings = await this.config.embedder.embed(chunks.map((c) => c.content))
      timing.embedding = Date.now() - embedStart

      if (this.config.hooks?.onEmbed) {
        await this.config.hooks.onEmbed(embeddings)
      }

      // Stage 4: Storage
      const storageStart = Date.now()
      const chunksWithEmbeddings = chunks.map((chunk, i) => ({
        ...chunk,
        embedding: embeddings[i] ?? [],
      }))

      const documentId = await this.config.storage.store({
        content: extracted.content,
        chunks: chunksWithEmbeddings,
        metadata: extracted.metadata,
      })
      timing.storage = Date.now() - storageStart

      timing.total = Date.now() - startTime

      const result: PipelineResult = {
        documentId,
        chunks: chunks.length,
        extractionMetadata: extracted.metadata,
        timing,
      }

      if (this.config.hooks?.onComplete) {
        await this.config.hooks.onComplete(result)
      }

      return result
    } catch (error) {
      if (this.config.hooks?.onError && error instanceof Error) {
        await this.config.hooks.onError(error, 'pipeline')
      }
      throw error
    }
  }
}

describe('DocumentPipeline', () => {
  let mockExtractor: Extractor
  let mockChunker: Chunker
  let mockEmbedder: Embedder
  let mockStorage: Storage

  beforeEach(() => {
    mockExtractor = {
      canHandle: vi.fn().mockReturnValue(true),
      extract: vi.fn().mockResolvedValue({
        content: 'Extracted content',
        contentType: 'text',
        metadata: { source: 'test' },
      }),
    }

    mockChunker = {
      chunk: vi.fn().mockReturnValue([
        { content: 'Chunk 1', index: 0, startOffset: 0, endOffset: 8 },
        { content: 'Chunk 2', index: 1, startOffset: 9, endOffset: 17 },
      ]),
    }

    mockEmbedder = {
      embed: vi.fn().mockResolvedValue([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]),
    }

    mockStorage = {
      store: vi.fn().mockResolvedValue('doc-123'),
    }
  })

  describe('process()', () => {
    it('should process content through all stages', async () => {
      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
      })

      const result = await pipeline.process('Test content')

      expect(result.documentId).toBe('doc-123')
      expect(result.chunks).toBe(2)
      expect(mockExtractor.canHandle).toHaveBeenCalledWith('Test content')
      expect(mockExtractor.extract).toHaveBeenCalledWith('Test content')
      expect(mockChunker.chunk).toHaveBeenCalledWith('Extracted content')
      expect(mockEmbedder.embed).toHaveBeenCalledWith(['Chunk 1', 'Chunk 2'])
      expect(mockStorage.store).toHaveBeenCalled()
    })

    it('should include timing information', async () => {
      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
      })

      const result = await pipeline.process('Test')

      expect(result.timing).toBeDefined()
      expect(result.timing.extraction).toBeGreaterThanOrEqual(0)
      expect(result.timing.chunking).toBeGreaterThanOrEqual(0)
      expect(result.timing.embedding).toBeGreaterThanOrEqual(0)
      expect(result.timing.storage).toBeGreaterThanOrEqual(0)
      expect(result.timing.total).toBeGreaterThanOrEqual(0)
    })

    it('should include extraction metadata', async () => {
      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
      })

      const result = await pipeline.process('Test')

      expect(result.extractionMetadata).toEqual({ source: 'test' })
    })

    it('should select correct extractor', async () => {
      const textExtractor: Extractor = {
        canHandle: vi.fn().mockImplementation((content) => typeof content === 'string'),
        extract: vi.fn().mockResolvedValue({
          content: 'Text extracted',
          contentType: 'text',
          metadata: {},
        }),
      }

      const bufferExtractor: Extractor = {
        canHandle: vi.fn().mockImplementation((content) => Buffer.isBuffer(content)),
        extract: vi.fn().mockResolvedValue({
          content: 'Buffer extracted',
          contentType: 'binary',
          metadata: {},
        }),
      }

      const pipeline = new DocumentPipeline({
        extractors: [textExtractor, bufferExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
      })

      await pipeline.process('Text content')

      expect(textExtractor.extract).toHaveBeenCalled()
      expect(bufferExtractor.extract).not.toHaveBeenCalled()
    })

    it('should throw error when no extractor matches', async () => {
      mockExtractor.canHandle = vi.fn().mockReturnValue(false)

      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
      })

      await expect(pipeline.process('Test')).rejects.toThrow('No extractor found')
    })

    it('should throw error when no chunks generated', async () => {
      mockChunker.chunk = vi.fn().mockReturnValue([])

      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
      })

      await expect(pipeline.process('Test')).rejects.toThrow('No chunks generated')
    })
  })

  describe('hooks', () => {
    it('should call onExtract hook', async () => {
      const onExtract = vi.fn()

      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
        hooks: { onExtract },
      })

      await pipeline.process('Test')

      expect(onExtract).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Extracted content',
          contentType: 'text',
        })
      )
    })

    it('should call onChunk hook', async () => {
      const onChunk = vi.fn()

      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
        hooks: { onChunk },
      })

      await pipeline.process('Test')

      expect(onChunk).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: 'Chunk 1' }),
          expect.objectContaining({ content: 'Chunk 2' }),
        ])
      )
    })

    it('should call onEmbed hook', async () => {
      const onEmbed = vi.fn()

      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
        hooks: { onEmbed },
      })

      await pipeline.process('Test')

      expect(onEmbed).toHaveBeenCalledWith([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ])
    })

    it('should call onComplete hook', async () => {
      const onComplete = vi.fn()

      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
        hooks: { onComplete },
      })

      await pipeline.process('Test')

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-123',
          chunks: 2,
        })
      )
    })

    it('should call onError hook on failure', async () => {
      const onError = vi.fn()
      mockExtractor.extract = vi.fn().mockRejectedValue(new Error('Extraction failed'))

      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
        hooks: { onError },
      })

      await expect(pipeline.process('Test')).rejects.toThrow()
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'pipeline')
    })
  })

  describe('error handling', () => {
    it('should propagate extraction errors', async () => {
      mockExtractor.extract = vi.fn().mockRejectedValue(new Error('Extraction failed'))

      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
      })

      await expect(pipeline.process('Test')).rejects.toThrow('Extraction failed')
    })

    it('should propagate embedding errors', async () => {
      mockEmbedder.embed = vi.fn().mockRejectedValue(new Error('Embedding API error'))

      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
      })

      await expect(pipeline.process('Test')).rejects.toThrow('Embedding API error')
    })

    it('should propagate storage errors', async () => {
      mockStorage.store = vi.fn().mockRejectedValue(new Error('Storage full'))

      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
      })

      await expect(pipeline.process('Test')).rejects.toThrow('Storage full')
    })
  })

  describe('Buffer input', () => {
    it('should process Buffer content', async () => {
      mockExtractor.canHandle = vi.fn().mockReturnValue(true)
      mockExtractor.extract = vi.fn().mockResolvedValue({
        content: 'PDF content extracted',
        contentType: 'pdf',
        metadata: { pages: 5 },
      })

      const pipeline = new DocumentPipeline({
        extractors: [mockExtractor],
        chunker: mockChunker,
        embedder: mockEmbedder,
        storage: mockStorage,
      })

      const buffer = Buffer.from('%PDF-1.4...')
      const result = await pipeline.process(buffer)

      expect(result.documentId).toBe('doc-123')
      expect(mockExtractor.extract).toHaveBeenCalledWith(buffer)
    })
  })
})
