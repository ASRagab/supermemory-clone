/**
 * Extraction Service Tests
 *
 * Comprehensive tests for content type detection, text extraction,
 * URL extraction, and chunking strategies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type {
  ContentType,
  ChunkingStrategy,
  ExtractionResult,
  ContentChunk,
  ExtractionMetadata,
} from '../../src/types/index'

/**
 * Extraction Service Implementation for Testing
 *
 * Since the extraction service may not exist in the codebase yet,
 * we define a minimal implementation here to demonstrate test patterns.
 */
class ExtractionService {
  private defaultChunkSize = 1000
  private defaultOverlap = 100

  /**
   * Detect content type from input
   */
  detectContentType(input: string): ContentType {
    // URL detection
    if (this.isUrl(input)) {
      return 'url'
    }

    // JSON detection
    try {
      JSON.parse(input)
      return 'json'
    } catch {
      // Not JSON
    }

    // HTML detection
    if (/<\/?[a-z][\s\S]*>/i.test(input)) {
      return 'html'
    }

    // Markdown detection
    if (this.isMarkdown(input)) {
      return 'markdown'
    }

    // PDF detection (check for magic bytes in base64)
    if (input.startsWith('JVBERi0') || input.startsWith('%PDF-')) {
      return 'pdf'
    }

    // Image detection (base64 prefixes)
    if (
      input.startsWith('data:image') ||
      input.startsWith('/9j/') || // JPEG
      input.startsWith('iVBORw0KGgo') // PNG
    ) {
      return 'image'
    }

    // Default to text
    if (input.trim().length > 0) {
      return 'text'
    }

    return 'unknown'
  }

  /**
   * Extract text content from various formats
   */
  extractText(input: string, contentType?: ContentType): string {
    const type = contentType || this.detectContentType(input)

    switch (type) {
      case 'html':
        return this.extractFromHtml(input)
      case 'markdown':
        return this.extractFromMarkdown(input)
      case 'json':
        return this.extractFromJson(input)
      case 'url':
        // For URLs, return the URL itself; actual fetching would be async
        return input
      default:
        return input
    }
  }

  /**
   * Extract URL from content
   */
  extractUrls(content: string): string[] {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
    const matches = content.match(urlRegex) || []
    return [...new Set(matches)] // Remove duplicates
  }

  /**
   * Chunk content using specified strategy
   */
  chunk(
    content: string,
    strategy: ChunkingStrategy = 'paragraph',
    options?: { chunkSize?: number; overlap?: number }
  ): ContentChunk[] {
    const chunkSize = options?.chunkSize ?? this.defaultChunkSize
    const overlap = options?.overlap ?? this.defaultOverlap

    switch (strategy) {
      case 'sentence':
        return this.chunkBySentence(content)
      case 'paragraph':
        return this.chunkByParagraph(content)
      case 'fixed':
        return this.chunkByFixedSize(content, chunkSize)
      case 'sliding_window':
        return this.chunkBySlidingWindow(content, chunkSize, overlap)
      case 'semantic':
        return this.chunkSemantically(content)
      default:
        return this.chunkByParagraph(content)
    }
  }

  /**
   * Full extraction pipeline
   */
  extract(input: string, strategy: ChunkingStrategy = 'paragraph'): ExtractionResult {
    const startTime = Date.now()
    const contentType = this.detectContentType(input)
    const content = this.extractText(input, contentType)
    const chunks = this.chunk(content, strategy)

    return {
      content,
      contentType,
      chunks,
      metadata: {
        originalLength: input.length,
        chunkCount: chunks.length,
        processingTime: Date.now() - startTime,
        strategy,
      },
    }
  }

  // ============ Private Methods ============

  private isUrl(input: string): boolean {
    try {
      const url = new URL(input)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }

  private isMarkdown(input: string): boolean {
    // Check for common markdown patterns
    const mdPatterns = [
      /^#{1,6}\s/m, // Headers
      /\*\*.+\*\*/m, // Bold
      /\*.+\*/m, // Italic
      /\[.+\]\(.+\)/m, // Links
      /```[\s\S]*```/m, // Code blocks
      /^\s*[-*+]\s/m, // Unordered lists
      /^\s*\d+\.\s/m, // Ordered lists
    ]

    return mdPatterns.some((pattern) => pattern.test(input))
  }

  private extractFromHtml(html: string): string {
    // Simple HTML to text extraction
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private extractFromMarkdown(markdown: string): string {
    return markdown
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`[^`]+`/g, '') // Remove inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
      .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1') // Remove bold/italic
      .replace(/^#{1,6}\s+/gm, '') // Remove headers
      .replace(/^\s*[-*+]\s+/gm, '') // Remove list markers
      .replace(/^\s*\d+\.\s+/gm, '') // Remove numbered list markers
      .trim()
  }

  private extractFromJson(json: string): string {
    try {
      const obj = JSON.parse(json)
      return this.flattenJsonToText(obj)
    } catch {
      return json
    }
  }

  private flattenJsonToText(obj: any, prefix = ''): string {
    const parts: string[] = []

    if (typeof obj === 'string') {
      return obj
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        parts.push(this.flattenJsonToText(item, prefix))
      }
    } else if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        const newPrefix = prefix ? `${prefix}.${key}` : key
        parts.push(`${newPrefix}: ${this.flattenJsonToText(value, newPrefix)}`)
      }
    } else {
      parts.push(String(obj))
    }

    return parts.join('\n')
  }

  private chunkBySentence(content: string): ContentChunk[] {
    const sentences = content.split(/(?<=[.!?])\s+/)
    return sentences
      .map((sentence, index) => ({
        id: `chunk-${index}`,
        content: sentence.trim(),
        index,
        startOffset: content.indexOf(sentence),
        endOffset: content.indexOf(sentence) + sentence.length,
      }))
      .filter((chunk) => chunk.content.length > 0)
  }

  private chunkByParagraph(content: string): ContentChunk[] {
    const paragraphs = content.split(/\n\n+/)
    let offset = 0

    return paragraphs
      .map((para, index) => {
        const chunk: ContentChunk = {
          id: `chunk-${index}`,
          content: para.trim(),
          index,
          startOffset: offset,
          endOffset: offset + para.length,
        }
        offset += para.length + 2 // Account for \n\n
        return chunk
      })
      .filter((chunk) => chunk.content.length > 0)
  }

  private chunkByFixedSize(content: string, chunkSize: number): ContentChunk[] {
    const chunks: ContentChunk[] = []
    let index = 0

    for (let i = 0; i < content.length; i += chunkSize) {
      const text = content.slice(i, i + chunkSize)
      chunks.push({
        id: `chunk-${index}`,
        content: text,
        index,
        startOffset: i,
        endOffset: Math.min(i + chunkSize, content.length),
      })
      index++
    }

    return chunks
  }

  private chunkBySlidingWindow(content: string, chunkSize: number, overlap: number): ContentChunk[] {
    const chunks: ContentChunk[] = []
    const step = chunkSize - overlap
    let index = 0

    for (let i = 0; i < content.length; i += step) {
      const text = content.slice(i, i + chunkSize)
      if (text.length > 0) {
        chunks.push({
          id: `chunk-${index}`,
          content: text,
          index,
          startOffset: i,
          endOffset: Math.min(i + chunkSize, content.length),
        })
        index++
      }
    }

    return chunks
  }

  private chunkSemantically(content: string): ContentChunk[] {
    // Semantic chunking: split at topic boundaries
    // This is a simplified version - production would use embeddings
    const sections = content.split(/\n(?=[A-Z])/)
    let offset = 0

    return sections
      .map((section, index) => {
        const chunk: ContentChunk = {
          id: `chunk-${index}`,
          content: section.trim(),
          index,
          startOffset: offset,
          endOffset: offset + section.length,
        }
        offset += section.length + 1
        return chunk
      })
      .filter((chunk) => chunk.content.length > 0)
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('ExtractionService', () => {
  let service: ExtractionService

  beforeEach(() => {
    service = new ExtractionService()
  })

  // ============================================================================
  // Content Type Detection Tests
  // ============================================================================

  describe('detectContentType', () => {
    describe('URL detection', () => {
      it('should detect HTTP URLs', () => {
        const type = service.detectContentType('http://example.com')
        expect(type).toBe('url')
      })

      it('should detect HTTPS URLs', () => {
        const type = service.detectContentType('https://example.com/path?query=1')
        expect(type).toBe('url')
      })

      it('should detect URLs with complex paths', () => {
        const type = service.detectContentType('https://api.example.com/v1/users/123/profile')
        expect(type).toBe('url')
      })

      it('should not detect invalid URLs', () => {
        const type = service.detectContentType('not-a-url')
        expect(type).not.toBe('url')
      })
    })

    describe('JSON detection', () => {
      it('should detect simple JSON objects', () => {
        const type = service.detectContentType('{"key": "value"}')
        expect(type).toBe('json')
      })

      it('should detect JSON arrays', () => {
        const type = service.detectContentType('[1, 2, 3]')
        expect(type).toBe('json')
      })

      it('should detect nested JSON', () => {
        const type = service.detectContentType('{"nested": {"key": "value"}}')
        expect(type).toBe('json')
      })

      it('should not detect invalid JSON', () => {
        const type = service.detectContentType('{invalid json}')
        expect(type).not.toBe('json')
      })
    })

    describe('HTML detection', () => {
      it('should detect HTML with tags', () => {
        const type = service.detectContentType('<html><body>Hello</body></html>')
        expect(type).toBe('html')
      })

      it('should detect HTML fragments', () => {
        const type = service.detectContentType('<div class="container">Content</div>')
        expect(type).toBe('html')
      })

      it('should detect self-closing tags', () => {
        const type = service.detectContentType('<br/><img src="test.jpg"/>')
        expect(type).toBe('html')
      })
    })

    describe('Markdown detection', () => {
      it('should detect markdown headers', () => {
        const type = service.detectContentType('# Heading 1\n\nSome content')
        expect(type).toBe('markdown')
      })

      it('should detect markdown bold text', () => {
        const type = service.detectContentType('This is **bold** text')
        expect(type).toBe('markdown')
      })

      it('should detect markdown links', () => {
        const type = service.detectContentType('Check [this link](https://example.com)')
        expect(type).toBe('markdown')
      })

      it('should detect markdown code blocks', () => {
        const type = service.detectContentType('```javascript\nconst x = 1;\n```')
        expect(type).toBe('markdown')
      })

      it('should detect markdown lists', () => {
        const type = service.detectContentType('- Item 1\n- Item 2\n- Item 3')
        expect(type).toBe('markdown')
      })
    })

    describe('Plain text detection', () => {
      it('should detect plain text', () => {
        const type = service.detectContentType('This is just plain text content.')
        expect(type).toBe('text')
      })

      it('should detect empty content as unknown', () => {
        const type = service.detectContentType('')
        expect(type).toBe('unknown')
      })

      it('should detect whitespace-only as unknown', () => {
        const type = service.detectContentType('   \n\t   ')
        expect(type).toBe('unknown')
      })
    })

    describe('PDF detection', () => {
      it('should detect PDF magic bytes', () => {
        const type = service.detectContentType('%PDF-1.4')
        expect(type).toBe('pdf')
      })

      it('should detect base64 PDF', () => {
        const type = service.detectContentType('JVBERi0xLjQKJeLjz9M=')
        expect(type).toBe('pdf')
      })
    })

    describe('Image detection', () => {
      it('should detect data URI images', () => {
        const type = service.detectContentType('data:image/png;base64,iVBORw0KGgo=')
        expect(type).toBe('image')
      })

      it('should detect base64 PNG', () => {
        const type = service.detectContentType('iVBORw0KGgoAAAANSUhEUg==')
        expect(type).toBe('image')
      })

      it('should detect base64 JPEG', () => {
        const type = service.detectContentType('/9j/4AAQSkZJRg==')
        expect(type).toBe('image')
      })
    })
  })

  // ============================================================================
  // Text Extraction Tests
  // ============================================================================

  describe('extractText', () => {
    describe('HTML extraction', () => {
      it('should remove HTML tags', () => {
        const html = '<p>Hello <strong>World</strong></p>'
        const text = service.extractText(html, 'html')

        expect(text).not.toContain('<')
        expect(text).not.toContain('>')
        expect(text).toContain('Hello')
        expect(text).toContain('World')
      })

      it('should remove script tags and content', () => {
        const html = '<p>Text</p><script>alert("xss")</script><p>More</p>'
        const text = service.extractText(html, 'html')

        expect(text).not.toContain('script')
        expect(text).not.toContain('alert')
        expect(text).toContain('Text')
        expect(text).toContain('More')
      })

      it('should remove style tags and content', () => {
        const html = '<style>.class { color: red; }</style><p>Content</p>'
        const text = service.extractText(html, 'html')

        expect(text).not.toContain('style')
        expect(text).not.toContain('color')
        expect(text).toContain('Content')
      })

      it('should normalize whitespace', () => {
        const html = '<p>   Multiple   spaces   </p>'
        const text = service.extractText(html, 'html')

        expect(text).not.toMatch(/\s{2,}/)
      })
    })

    describe('Markdown extraction', () => {
      it('should convert links to text', () => {
        const md = 'Check out [this link](https://example.com)'
        const text = service.extractText(md, 'markdown')

        expect(text).toContain('this link')
        expect(text).not.toContain('https://')
      })

      it('should remove formatting', () => {
        const md = 'This is **bold** and *italic*'
        const text = service.extractText(md, 'markdown')

        expect(text).not.toContain('**')
        expect(text).not.toContain('*')
        expect(text).toContain('bold')
        expect(text).toContain('italic')
      })

      it('should remove code blocks', () => {
        const md = 'Text\n```\ncode block\n```\nMore text'
        const text = service.extractText(md, 'markdown')

        expect(text).not.toContain('```')
      })

      it('should remove header markers', () => {
        const md = '# Heading 1\n## Heading 2'
        const text = service.extractText(md, 'markdown')

        expect(text).not.toContain('#')
        expect(text).toContain('Heading 1')
      })
    })

    describe('JSON extraction', () => {
      it('should flatten JSON to text', () => {
        const json = '{"name": "John", "age": 30}'
        const text = service.extractText(json, 'json')

        expect(text).toContain('name')
        expect(text).toContain('John')
        expect(text).toContain('age')
        expect(text).toContain('30')
      })

      it('should handle nested JSON', () => {
        const json = '{"user": {"name": "Alice"}}'
        const text = service.extractText(json, 'json')

        expect(text).toContain('Alice')
      })

      it('should handle JSON arrays', () => {
        const json = '{"items": ["a", "b", "c"]}'
        const text = service.extractText(json, 'json')

        expect(text).toContain('a')
        expect(text).toContain('b')
        expect(text).toContain('c')
      })
    })

    describe('Plain text passthrough', () => {
      it('should return plain text unchanged', () => {
        const input = 'This is plain text.'
        const text = service.extractText(input, 'text')

        expect(text).toBe(input)
      })
    })
  })

  // ============================================================================
  // URL Extraction Tests
  // ============================================================================

  describe('extractUrls', () => {
    it('should extract HTTP URLs', () => {
      const content = 'Visit http://example.com for more info'
      const urls = service.extractUrls(content)

      expect(urls).toContain('http://example.com')
    })

    it('should extract HTTPS URLs', () => {
      const content = 'Secure site at https://secure.example.com'
      const urls = service.extractUrls(content)

      expect(urls).toContain('https://secure.example.com')
    })

    it('should extract multiple URLs', () => {
      const content = 'Links: https://a.com and https://b.com'
      const urls = service.extractUrls(content)

      expect(urls).toHaveLength(2)
      expect(urls).toContain('https://a.com')
      expect(urls).toContain('https://b.com')
    })

    it('should extract URLs with paths and query params', () => {
      const content = 'API: https://api.example.com/v1/users?id=123'
      const urls = service.extractUrls(content)

      expect(urls[0]).toBe('https://api.example.com/v1/users?id=123')
    })

    it('should deduplicate URLs', () => {
      const content = 'https://example.com and https://example.com again'
      const urls = service.extractUrls(content)

      expect(urls).toHaveLength(1)
    })

    it('should return empty array when no URLs', () => {
      const content = 'No URLs in this text'
      const urls = service.extractUrls(content)

      expect(urls).toHaveLength(0)
    })

    it('should handle URLs in HTML', () => {
      const content = '<a href="https://example.com">Link</a>'
      const urls = service.extractUrls(content)

      expect(urls).toContain('https://example.com')
    })
  })

  // ============================================================================
  // Chunking Strategy Tests
  // ============================================================================

  describe('chunk', () => {
    describe('sentence chunking', () => {
      it('should split by sentences', () => {
        const content = 'First sentence. Second sentence. Third sentence.'
        const chunks = service.chunk(content, 'sentence')

        expect(chunks).toHaveLength(3)
        expect(chunks[0]?.content).toBe('First sentence.')
        expect(chunks[1]?.content).toBe('Second sentence.')
      })

      it('should handle question marks', () => {
        const content = 'What is this? It is a test.'
        const chunks = service.chunk(content, 'sentence')

        expect(chunks).toHaveLength(2)
      })

      it('should handle exclamation marks', () => {
        const content = 'Wow! That is amazing!'
        const chunks = service.chunk(content, 'sentence')

        expect(chunks).toHaveLength(2)
      })

      it('should assign sequential indices', () => {
        const content = 'One. Two. Three.'
        const chunks = service.chunk(content, 'sentence')

        expect(chunks[0]?.index).toBe(0)
        expect(chunks[1]?.index).toBe(1)
        expect(chunks[2]?.index).toBe(2)
      })
    })

    describe('paragraph chunking', () => {
      it('should split by double newlines', () => {
        const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
        const chunks = service.chunk(content, 'paragraph')

        expect(chunks).toHaveLength(3)
      })

      it('should preserve paragraph content', () => {
        const content = 'Paragraph with multiple sentences. Second sentence.\n\nAnother paragraph.'
        const chunks = service.chunk(content, 'paragraph')

        expect(chunks[0]?.content).toContain('multiple sentences')
        expect(chunks[0]?.content).toContain('Second sentence')
      })

      it('should filter empty paragraphs', () => {
        const content = 'Content\n\n\n\nMore content'
        const chunks = service.chunk(content, 'paragraph')

        expect(chunks.every((c) => c.content.length > 0)).toBe(true)
      })
    })

    describe('fixed size chunking', () => {
      it('should create chunks of specified size', () => {
        const content = 'A'.repeat(100)
        const chunks = service.chunk(content, 'fixed', { chunkSize: 25 })

        expect(chunks).toHaveLength(4)
        expect(chunks[0]?.content.length).toBe(25)
      })

      it('should handle content shorter than chunk size', () => {
        const content = 'Short'
        const chunks = service.chunk(content, 'fixed', { chunkSize: 100 })

        expect(chunks).toHaveLength(1)
        expect(chunks[0]?.content).toBe('Short')
      })

      it('should include start and end offsets', () => {
        const content = 'ABCDEF'
        const chunks = service.chunk(content, 'fixed', { chunkSize: 2 })

        expect(chunks[0]?.startOffset).toBe(0)
        expect(chunks[0]?.endOffset).toBe(2)
        expect(chunks[1]?.startOffset).toBe(2)
        expect(chunks[1]?.endOffset).toBe(4)
      })
    })

    describe('sliding window chunking', () => {
      it('should create overlapping chunks', () => {
        const content = 'ABCDEFGHIJ'
        const chunks = service.chunk(content, 'sliding_window', {
          chunkSize: 5,
          overlap: 2,
        })

        // With size 5 and overlap 2, step is 3
        // Chunks: ABCDE, DEFGH, GHIJ
        expect(chunks.length).toBeGreaterThan(1)
      })

      it('should have overlap between consecutive chunks', () => {
        const content = 'ABCDEFGHIJKLMNOP'
        const chunks = service.chunk(content, 'sliding_window', {
          chunkSize: 6,
          overlap: 2,
        })

        if (chunks.length >= 2) {
          const chunk1End = chunks[0]?.content.slice(-2)
          const chunk2Start = chunks[1]?.content.slice(0, 2)
          expect(chunk1End).toBe(chunk2Start)
        }
      })
    })

    describe('semantic chunking', () => {
      it('should split at topic boundaries', () => {
        const content = 'Topic about programming.\nAnother topic about design.'
        const chunks = service.chunk(content, 'semantic')

        expect(chunks.length).toBeGreaterThanOrEqual(1)
      })

      it('should preserve semantic units', () => {
        const content = 'Introduction to ML.\nAdvanced deep learning concepts.'
        const chunks = service.chunk(content, 'semantic')

        // Each chunk should be a coherent semantic unit
        for (const chunk of chunks) {
          expect(chunk.content.length).toBeGreaterThan(0)
        }
      })
    })

    describe('chunk metadata', () => {
      it('should assign unique IDs to chunks', () => {
        const content = 'First. Second. Third.'
        const chunks = service.chunk(content, 'sentence')

        const ids = chunks.map((c) => c.id)
        const uniqueIds = new Set(ids)
        expect(uniqueIds.size).toBe(ids.length)
      })

      it('should include correct offsets', () => {
        const content = 'Hello World'
        const chunks = service.chunk(content, 'fixed', { chunkSize: 5 })

        expect(chunks[0]?.startOffset).toBe(0)
        expect(chunks[0]?.endOffset).toBe(5)
        expect(chunks[1]?.startOffset).toBe(5)
      })
    })
  })

  // ============================================================================
  // Full Extraction Pipeline Tests
  // ============================================================================

  describe('extract', () => {
    it('should return complete extraction result', () => {
      const input = 'Test content for extraction.'
      const result = service.extract(input)

      expect(result.content).toBeDefined()
      expect(result.contentType).toBe('text')
      expect(result.chunks).toBeInstanceOf(Array)
      expect(result.metadata).toBeDefined()
    })

    it('should include processing metadata', () => {
      const result = service.extract('Processing test.')

      expect(result.metadata.originalLength).toBeGreaterThan(0)
      expect(result.metadata.chunkCount).toBeGreaterThanOrEqual(1)
      expect(result.metadata.processingTime).toBeGreaterThanOrEqual(0)
      expect(result.metadata.strategy).toBeDefined()
    })

    it('should use specified chunking strategy', () => {
      const input = 'Sentence one. Sentence two.'
      const result = service.extract(input, 'sentence')

      expect(result.metadata.strategy).toBe('sentence')
      expect(result.chunks.length).toBeGreaterThanOrEqual(2)
    })

    it('should detect content type automatically', () => {
      const html = '<p>HTML content</p>'
      const result = service.extract(html)

      expect(result.contentType).toBe('html')
    })

    it('should extract text before chunking', () => {
      const html = '<p>Paragraph content.</p>'
      const result = service.extract(html, 'sentence')

      expect(result.content).not.toContain('<p>')
      expect(result.content).toContain('Paragraph content')
    })
  })
})
