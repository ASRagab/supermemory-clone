/**
 * Document and extraction types for supermemory content pipeline
 */

export type ContentType = 'text' | 'url' | 'pdf' | 'markdown' | 'code' | 'unknown'

export type DocumentStatus = 'queued' | 'extracting' | 'chunking' | 'embedding' | 'indexing' | 'done' | 'error'

export interface Document {
  id: string
  content: string
  contentType?: ContentType
  sourceUrl?: string
  fileName?: string
  language?: string
  status: DocumentStatus
  metadata: DocumentMetadata
  createdAt: Date
  updatedAt: Date
  errorMessage?: string
  retryCount: number
}

export interface DocumentMetadata {
  title?: string
  author?: string
  description?: string
  tags?: string[]
  source?: string
  mimeType?: string
  wordCount?: number
  charCount?: number
  [key: string]: unknown
}

export interface Chunk {
  id: string
  documentId: string
  content: string
  type: ChunkType
  position: ChunkPosition
  metadata: ChunkMetadata
  embedding?: number[]
}

export type ChunkType =
  | 'paragraph'
  | 'heading'
  | 'code_block'
  | 'function'
  | 'class'
  | 'list'
  | 'table'
  | 'quote'
  | 'section'
  | 'raw'

export interface ChunkPosition {
  index: number
  start: number
  end: number
  lineStart?: number
  lineEnd?: number
}

export interface ChunkMetadata {
  headingLevel?: number
  headingText?: string
  language?: string
  functionName?: string
  className?: string
  parentChunkId?: string
  wordCount: number
  charCount: number
  [key: string]: unknown
}

export interface ExtractionResult {
  content: string
  contentType: ContentType
  metadata: DocumentMetadata
  rawContent?: string
}

export interface ChunkingOptions {
  maxChunkSize?: number
  minChunkSize?: number
  overlap?: number
  preserveStructure?: boolean
}

export interface PipelineResult {
  documentId: string
  status: DocumentStatus
  chunks: Chunk[]
  processingTimeMs: number
  error?: string
}

export interface ExtractorInterface {
  extract(content: string | Buffer, options?: Record<string, unknown>): Promise<ExtractionResult>
  canHandle(content: string | Buffer): boolean
}
