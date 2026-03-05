/**
 * Main extraction orchestrator - routes documents to appropriate extractors
 */

import { Document, ContentType, ExtractionResult, ExtractorInterface } from '../types/document.types.js'
import { TextExtractor } from './extractors/text.extractor.js'
import { UrlExtractor } from './extractors/url.extractor.js'
import { PdfExtractor } from './extractors/pdf.extractor.js'
import { MarkdownExtractor } from './extractors/markdown.extractor.js'
import { CodeExtractor } from './extractors/code.extractor.js'

interface ExtractorConfig {
  extractor: ExtractorInterface
  priority: number
  contentType: ContentType
}

export class ExtractionService {
  private readonly extractors: ExtractorConfig[]
  private readonly textExtractor: TextExtractor
  private readonly urlExtractor: UrlExtractor
  private readonly pdfExtractor: PdfExtractor
  private readonly markdownExtractor: MarkdownExtractor
  private readonly codeExtractor: CodeExtractor

  constructor() {
    // Initialize all extractors
    this.textExtractor = new TextExtractor()
    this.urlExtractor = new UrlExtractor()
    this.pdfExtractor = new PdfExtractor()
    this.markdownExtractor = new MarkdownExtractor()
    this.codeExtractor = new CodeExtractor()

    // Configure extractors with priorities (higher = checked first)
    this.extractors = [
      { extractor: this.urlExtractor, priority: 100, contentType: 'url' as ContentType },
      { extractor: this.pdfExtractor, priority: 90, contentType: 'pdf' as ContentType },
      { extractor: this.codeExtractor, priority: 80, contentType: 'code' as ContentType },
      { extractor: this.markdownExtractor, priority: 70, contentType: 'markdown' as ContentType },
      { extractor: this.textExtractor, priority: 10, contentType: 'text' as ContentType },
    ].sort((a, b) => b.priority - a.priority)
  }

  /**
   * Extract content from a document, routing to the appropriate extractor
   */
  async extract(document: Document): Promise<ExtractionResult> {
    const contentType = document.contentType || this.detectContentType(document.content)
    const extractor = this.getExtractor(contentType)

    const options: Record<string, unknown> = {
      metadata: document.metadata,
      fileName: document.fileName,
      language: document.language,
    }

    let result: ExtractionResult
    try {
      result = await extractor.extract(document.content, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown extraction error'
      throw new Error(`Extraction failed for document ${document.id} (type: ${contentType}): ${message}`)
    }

    return {
      ...result,
      metadata: {
        ...result.metadata,
        documentId: document.id,
        originalContentType: document.contentType,
        detectedContentType: contentType,
      },
    }
  }

  /**
   * Auto-detect content type from content
   */
  detectContentType(content: string): ContentType {
    if (!content || typeof content !== 'string') {
      return 'unknown'
    }

    // Check each extractor in priority order
    for (const config of this.extractors) {
      if (config.extractor.canHandle(content)) {
        return config.contentType
      }
    }

    return 'unknown'
  }

  /**
   * Get the appropriate extractor for a content type
   */
  private getExtractor(contentType: ContentType): ExtractorInterface {
    switch (contentType) {
      case 'url':
        return this.urlExtractor
      case 'pdf':
        return this.pdfExtractor
      case 'code':
        return this.codeExtractor
      case 'markdown':
        return this.markdownExtractor
      case 'text':
      case 'unknown':
      default:
        return this.textExtractor
    }
  }

  /**
   * Detect content type from file extension
   */
  detectFromFileName(fileName: string): ContentType {
    const ext = fileName.toLowerCase().split('.').pop()

    if (!ext) return 'unknown'

    // PDF
    if (ext === 'pdf') return 'pdf'

    // Markdown
    if (['md', 'markdown', 'mdx'].includes(ext)) return 'markdown'

    // Code files
    const codeExtensions = [
      'ts',
      'tsx',
      'js',
      'jsx',
      'mjs',
      'cjs',
      'py',
      'pyw',
      'go',
      'java',
      'rs',
      'c',
      'cpp',
      'cc',
      'cxx',
      'h',
      'hpp',
      'cs',
      'rb',
      'php',
      'swift',
      'kt',
      'kts',
      'scala',
      'sh',
      'bash',
      'zsh',
      'sql',
      'json',
      'yaml',
      'yml',
      'toml',
      'xml',
      'css',
      'scss',
      'sass',
      'less',
      'html',
      'htm',
      'vue',
      'svelte',
    ]

    if (codeExtensions.includes(ext)) return 'code'

    // Plain text
    if (['txt', 'text', 'log'].includes(ext)) return 'text'

    return 'unknown'
  }

  /**
   * Detect content type from MIME type
   */
  detectFromMimeType(mimeType: string): ContentType {
    const normalized = mimeType.toLowerCase().split(';')[0]?.trim() ?? ''

    // PDF
    if (normalized === 'application/pdf') return 'pdf'

    // Markdown
    if (normalized === 'text/markdown' || normalized === 'text/x-markdown') {
      return 'markdown'
    }

    // HTML (URL content)
    if (normalized === 'text/html') return 'url'

    // Code types
    const codeTypes = [
      'text/javascript',
      'application/javascript',
      'text/typescript',
      'text/x-python',
      'text/x-go',
      'text/x-java',
      'text/x-rust',
      'text/x-c',
      'text/x-c++',
      'application/json',
      'text/css',
      'text/xml',
      'application/xml',
    ]

    if (codeTypes.includes(normalized)) return 'code'

    // Plain text
    if (normalized === 'text/plain') return 'text'

    return 'unknown'
  }

  /**
   * Extract with all extractors and return the best result
   * Useful for ambiguous content
   */
  async extractWithAllExtractors(
    content: string,
    options?: Record<string, unknown>
  ): Promise<{ results: Map<ContentType, ExtractionResult>; bestType: ContentType }> {
    const results = new Map<ContentType, ExtractionResult>()
    let bestType: ContentType = 'unknown'
    let bestScore = 0

    for (const config of this.extractors) {
      if (config.extractor.canHandle(content)) {
        try {
          const result = await config.extractor.extract(content, options)
          results.set(config.contentType, result)

          // Score based on metadata richness
          const score = this.scoreExtractionResult(result)
          if (score > bestScore) {
            bestScore = score
            bestType = config.contentType
          }
        } catch {
          // Extractor failed, skip it
        }
      }
    }

    return { results, bestType }
  }

  /**
   * Score an extraction result based on metadata quality
   */
  private scoreExtractionResult(result: ExtractionResult): number {
    let score = 0

    if (result.metadata.title) score += 10
    if (result.metadata.description) score += 5
    if (result.metadata.author) score += 3
    if (result.metadata.tags && result.metadata.tags.length > 0) score += 2
    if (result.content.length > 0) score += 1

    // Penalize if content is too short
    if (result.content.length < 50) score -= 5

    return score
  }

  /**
   * Get supported content types
   */
  getSupportedContentTypes(): ContentType[] {
    return this.extractors.map((e) => e.contentType)
  }

  /**
   * Check if a content type is supported
   */
  isContentTypeSupported(contentType: ContentType): boolean {
    return this.extractors.some((e) => e.contentType === contentType)
  }

  /**
   * Get extractor instances for direct access
   */
  getExtractors() {
    return {
      text: this.textExtractor,
      url: this.urlExtractor,
      pdf: this.pdfExtractor,
      markdown: this.markdownExtractor,
      code: this.codeExtractor,
    }
  }
}
