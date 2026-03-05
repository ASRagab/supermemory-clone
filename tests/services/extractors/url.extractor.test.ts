/**
 * URL Extractor Tests
 *
 * Tests for URL content fetching and HTML parsing including
 * metadata extraction and text cleaning.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Types
interface ExtractionResult {
  content: string
  contentType: string
  metadata: Record<string, unknown>
  rawContent?: string
}

interface FetchOptions {
  timeout?: number
  userAgent?: string
  followRedirects?: boolean
}

// URL Extractor implementation
class UrlExtractor {
  private defaultTimeout = 30000
  private defaultUserAgent = 'Mozilla/5.0 (compatible; SupermemoryBot/1.0)'
  private mockFetch: typeof fetch

  constructor(mockFetch?: typeof fetch) {
    this.mockFetch = mockFetch ?? fetch
  }

  canHandle(content: string): boolean {
    try {
      const trimmed = content.trim()
      const url = new URL(trimmed)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }

  async extract(url: string, options?: FetchOptions & Record<string, unknown>): Promise<ExtractionResult> {
    const trimmedUrl = url.trim()
    const html = await this.fetchUrl(trimmedUrl, options)
    const { content, metadata } = this.parseHtml(html, trimmedUrl)

    return {
      content,
      contentType: 'url',
      metadata: {
        ...metadata,
        sourceUrl: trimmedUrl,
        source: 'web',
      },
      rawContent: html,
    }
  }

  private async fetchUrl(url: string, options?: FetchOptions): Promise<string> {
    const timeout = options?.timeout ?? this.defaultTimeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await this.mockFetch(url, {
        headers: {
          'User-Agent': options?.userAgent ?? this.defaultUserAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: options?.followRedirects !== false ? 'follow' : 'manual',
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return await response.text()
    } finally {
      clearTimeout(timeoutId)
    }
  }

  parseHtml(html: string, url: string): { content: string; metadata: ExtractionResult['metadata'] } {
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    const title = titleMatch?.[1] ? this.decodeHtmlEntities(titleMatch[1].trim()) : undefined

    const descMatch =
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ??
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i)
    const description = descMatch?.[1] ? this.decodeHtmlEntities(descMatch[1].trim()) : undefined

    const authorMatch =
      html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']*)["']/i) ??
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']author["']/i)
    const author = authorMatch?.[1] ? this.decodeHtmlEntities(authorMatch[1].trim()) : undefined

    const ogTags = this.extractOpenGraphTags(html)
    const content = this.htmlToText(html)
    const words = content.split(/\s+/).filter((w) => w.length > 0)

    let domain: string | undefined
    try {
      domain = new URL(url).hostname
    } catch {
      // URL parsing failed
    }

    return {
      content,
      metadata: {
        title: title ?? ogTags['title'],
        description: description ?? ogTags['description'],
        author,
        wordCount: words.length,
        charCount: content.length,
        mimeType: 'text/html',
        ogImage: ogTags['image'],
        ogType: ogTags['type'],
        domain,
      },
    }
  }

  extractOpenGraphTags(html: string): Record<string, string | undefined> {
    const tags: Record<string, string | undefined> = {}
    const ogPattern = /<meta[^>]*property=["']og:([^"']*)["'][^>]*content=["']([^"']*)["']/gi
    let match: RegExpExecArray | null

    while ((match = ogPattern.exec(html)) !== null) {
      const key = match[1]
      const value = match[2]
      if (key && value) {
        tags[key] = this.decodeHtmlEntities(value)
      }
    }

    return tags
  }

  htmlToText(html: string): string {
    let text = html

    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    text = text.replace(/<!--[\s\S]*?-->/g, '')
    text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    text = text.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n')
    text = text.replace(/<(br|hr)[^>]*\/?>/gi, '\n')
    text = text.replace(/<[^>]+>/g, ' ')
    text = this.decodeHtmlEntities(text)
    text = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return text
  }

  decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&nbsp;': ' ',
      '&mdash;': '--',
      '&ndash;': '-',
      '&hellip;': '...',
      '&copy;': '(c)',
      '&reg;': '(R)',
      '&trade;': '(TM)',
    }

    let result = text
    for (const [entity, char] of Object.entries(entities)) {
      result = result.replace(new RegExp(entity, 'gi'), char)
    }

    result = result.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    result = result.replace(/&#x([a-fA-F0-9]+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))

    return result
  }

  async isAccessible(url: string): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await this.mockFetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      return response.ok
    } catch {
      return false
    }
  }
}

describe('UrlExtractor', () => {
  let extractor: UrlExtractor
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    extractor = new UrlExtractor(mockFetch as unknown as typeof fetch)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('canHandle()', () => {
    it('should accept valid HTTP URLs', () => {
      expect(extractor.canHandle('http://example.com')).toBe(true)
      expect(extractor.canHandle('http://localhost:3000')).toBe(true)
    })

    it('should accept valid HTTPS URLs', () => {
      expect(extractor.canHandle('https://example.com')).toBe(true)
      expect(extractor.canHandle('https://example.com/path')).toBe(true)
    })

    it('should reject FTP URLs', () => {
      expect(extractor.canHandle('ftp://example.com')).toBe(false)
    })

    it('should reject file URLs', () => {
      expect(extractor.canHandle('file:///path/to/file')).toBe(false)
    })

    it('should reject invalid URLs', () => {
      expect(extractor.canHandle('not a url')).toBe(false)
      expect(extractor.canHandle('')).toBe(false)
    })

    it('should handle URLs with whitespace', () => {
      expect(extractor.canHandle('  https://example.com  ')).toBe(true)
    })
  })

  describe('extract()', () => {
    it('should fetch and parse HTML', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><title>Test</title><body>Content</body></html>',
      })

      const result = await extractor.extract('https://example.com')

      expect(result.contentType).toBe('url')
      expect(result.metadata.title).toBe('Test')
    })

    it('should include source URL in metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><body>Content</body></html>',
      })

      const result = await extractor.extract('https://example.com/page')

      expect(result.metadata.sourceUrl).toBe('https://example.com/page')
      expect(result.metadata.source).toBe('web')
    })

    it('should extract domain from URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '<html></html>',
      })

      const result = await extractor.extract('https://www.example.com/path')

      expect(result.metadata.domain).toBe('www.example.com')
    })

    it('should preserve raw HTML', async () => {
      const html = '<html><body>Test</body></html>'
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => html,
      })

      const result = await extractor.extract('https://example.com')

      expect(result.rawContent).toBe(html)
    })

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      await expect(extractor.extract('https://example.com/404')).rejects.toThrow('HTTP 404')
    })
  })

  describe('parseHtml()', () => {
    it('should extract title', () => {
      const html = '<html><head><title>Page Title</title></head></html>'
      const result = extractor.parseHtml(html, 'https://example.com')

      expect(result.metadata.title).toBe('Page Title')
    })

    it('should extract meta description', () => {
      const html = '<meta name="description" content="Page description">'
      const result = extractor.parseHtml(html, 'https://example.com')

      expect(result.metadata.description).toBe('Page description')
    })

    it('should handle reverse attribute order in meta tags', () => {
      const html = '<meta content="Description text" name="description">'
      const result = extractor.parseHtml(html, 'https://example.com')

      expect(result.metadata.description).toBe('Description text')
    })

    it('should extract author', () => {
      const html = '<meta name="author" content="John Doe">'
      const result = extractor.parseHtml(html, 'https://example.com')

      expect(result.metadata.author).toBe('John Doe')
    })

    it('should calculate word and char counts', () => {
      const html = '<p>One two three four five</p>'
      const result = extractor.parseHtml(html, 'https://example.com')

      expect(result.metadata.wordCount).toBe(5)
      expect(result.metadata.charCount).toBeGreaterThan(0)
    })
  })

  describe('extractOpenGraphTags()', () => {
    it('should extract og:title', () => {
      const html = '<meta property="og:title" content="OG Title">'
      const tags = extractor.extractOpenGraphTags(html)

      expect(tags['title']).toBe('OG Title')
    })

    it('should extract og:description', () => {
      const html = '<meta property="og:description" content="OG Description">'
      const tags = extractor.extractOpenGraphTags(html)

      expect(tags['description']).toBe('OG Description')
    })

    it('should extract og:image', () => {
      const html = '<meta property="og:image" content="https://example.com/image.jpg">'
      const tags = extractor.extractOpenGraphTags(html)

      expect(tags['image']).toBe('https://example.com/image.jpg')
    })

    it('should extract og:type', () => {
      const html = '<meta property="og:type" content="article">'
      const tags = extractor.extractOpenGraphTags(html)

      expect(tags['type']).toBe('article')
    })

    it('should extract multiple OG tags', () => {
      const html = `
        <meta property="og:title" content="Title">
        <meta property="og:description" content="Desc">
        <meta property="og:type" content="website">
      `
      const tags = extractor.extractOpenGraphTags(html)

      expect(tags['title']).toBe('Title')
      expect(tags['description']).toBe('Desc')
      expect(tags['type']).toBe('website')
    })
  })

  describe('htmlToText()', () => {
    it('should remove script tags', () => {
      const html = '<p>Text</p><script>alert("hi")</script><p>More</p>'
      const text = extractor.htmlToText(html)

      expect(text).not.toContain('alert')
      expect(text).toContain('Text')
      expect(text).toContain('More')
    })

    it('should remove style tags', () => {
      const html = '<p>Text</p><style>body { color: red; }</style>'
      const text = extractor.htmlToText(html)

      expect(text).not.toContain('color')
    })

    it('should remove noscript tags', () => {
      const html = '<noscript>Enable JavaScript</noscript><p>Content</p>'
      const text = extractor.htmlToText(html)

      expect(text).not.toContain('Enable')
    })

    it('should remove comments', () => {
      const html = '<p>Before</p><!-- comment --><p>After</p>'
      const text = extractor.htmlToText(html)

      expect(text).not.toContain('comment')
    })

    it('should remove header/footer/nav/aside', () => {
      const html = `
        <header>Header</header>
        <nav>Navigation</nav>
        <main>Main content</main>
        <aside>Sidebar</aside>
        <footer>Footer</footer>
      `
      const text = extractor.htmlToText(html)

      expect(text).not.toContain('Header')
      expect(text).not.toContain('Navigation')
      expect(text).toContain('Main content')
      expect(text).not.toContain('Sidebar')
      expect(text).not.toContain('Footer')
    })

    it('should convert block elements to newlines', () => {
      const html = '<p>Para 1</p><p>Para 2</p>'
      const text = extractor.htmlToText(html)

      expect(text).toContain('Para 1')
      expect(text).toContain('Para 2')
    })

    it('should remove all HTML tags', () => {
      const html = '<div class="container"><span>Text</span></div>'
      const text = extractor.htmlToText(html)

      expect(text).not.toContain('<')
      expect(text).not.toContain('>')
      expect(text).toContain('Text')
    })
  })

  describe('decodeHtmlEntities()', () => {
    it('should decode common entities', () => {
      expect(extractor.decodeHtmlEntities('&amp;')).toBe('&')
      expect(extractor.decodeHtmlEntities('&lt;')).toBe('<')
      expect(extractor.decodeHtmlEntities('&gt;')).toBe('>')
      expect(extractor.decodeHtmlEntities('&quot;')).toBe('"')
      expect(extractor.decodeHtmlEntities('&#39;')).toBe("'")
    })

    it('should decode special entities', () => {
      expect(extractor.decodeHtmlEntities('&nbsp;')).toBe(' ')
      expect(extractor.decodeHtmlEntities('&mdash;')).toBe('--')
      expect(extractor.decodeHtmlEntities('&ndash;')).toBe('-')
      expect(extractor.decodeHtmlEntities('&hellip;')).toBe('...')
    })

    it('should decode numeric entities', () => {
      expect(extractor.decodeHtmlEntities('&#65;')).toBe('A')
      expect(extractor.decodeHtmlEntities('&#97;')).toBe('a')
    })

    it('should decode hex entities', () => {
      expect(extractor.decodeHtmlEntities('&#x41;')).toBe('A')
      expect(extractor.decodeHtmlEntities('&#x61;')).toBe('a')
    })

    it('should decode multiple entities', () => {
      const text = '&lt;div&gt;&amp;&lt;/div&gt;'
      expect(extractor.decodeHtmlEntities(text)).toBe('<div>&</div>')
    })
  })

  describe('isAccessible()', () => {
    it('should return true for accessible URLs', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })

      const result = await extractor.isAccessible('https://example.com')

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ method: 'HEAD' }))
    })

    it('should return false for inaccessible URLs', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false })

      const result = await extractor.isAccessible('https://example.com/404')

      expect(result).toBe(false)
    })

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await extractor.isAccessible('https://example.com')

      expect(result).toBe(false)
    })
  })

  describe('fetch options', () => {
    it('should use custom timeout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '<html></html>',
      })

      await extractor.extract('https://example.com', { timeout: 5000 })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should use custom user agent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '<html></html>',
      })

      await extractor.extract('https://example.com', { userAgent: 'CustomBot/1.0' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'CustomBot/1.0',
          }),
        })
      )
    })
  })
})
