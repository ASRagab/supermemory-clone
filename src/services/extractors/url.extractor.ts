/**
 * URL extractor - fetches and cleans web page content
 */

import { ExtractionResult, ExtractorInterface, ContentType } from '../../types/document.types.js'
import { ExternalServiceError } from '../../utils/errors.js'

interface FetchOptions {
  timeout?: number
  userAgent?: string
  followRedirects?: boolean
}

export class UrlExtractor implements ExtractorInterface {
  private readonly defaultTimeout = 30000
  private readonly defaultUserAgent = 'Mozilla/5.0 (compatible; SupermemoryBot/1.0)'

  /**
   * Check if content is a valid URL
   */
  canHandle(content: string): boolean {
    try {
      const trimmed = content.trim()
      const url = new URL(trimmed)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }

  /**
   * Fetch URL and extract clean content
   */
  async extract(url: string, options?: FetchOptions & Record<string, unknown>): Promise<ExtractionResult> {
    const trimmedUrl = url.trim()
    const html = await this.fetchUrl(trimmedUrl, options)
    const { content, metadata } = this.parseHtml(html, trimmedUrl)

    return {
      content,
      contentType: 'url' as ContentType,
      metadata: {
        ...metadata,
        sourceUrl: trimmedUrl,
        source: 'web',
      },
      rawContent: html,
    }
  }

  /**
   * Fetch URL content
   */
  private async fetchUrl(url: string, options?: FetchOptions): Promise<string> {
    const timeout = options?.timeout ?? this.defaultTimeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': options?.userAgent ?? this.defaultUserAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: options?.followRedirects !== false ? 'follow' : 'manual',
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new ExternalServiceError('HTTP', `HTTP ${response.status}: ${response.statusText}`, response.status, {
          url,
        })
      }

      return await response.text()
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Parse HTML and extract clean text content
   */
  private parseHtml(html: string, url: string): { content: string; metadata: ExtractionResult['metadata'] } {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    const title = titleMatch?.[1] ? this.decodeHtmlEntities(titleMatch[1].trim()) : undefined

    // Extract meta description (handle both attribute orders)
    const descMatch =
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ??
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i)
    const description = descMatch?.[1] ? this.decodeHtmlEntities(descMatch[1].trim()) : undefined

    // Extract author (handle both attribute orders)
    const authorMatch =
      html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']*)["']/i) ??
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']author["']/i)
    const author = authorMatch?.[1] ? this.decodeHtmlEntities(authorMatch[1].trim()) : undefined

    // Extract og:tags for additional metadata
    const ogTags = this.extractOpenGraphTags(html)

    // Clean HTML to get text content
    const content = this.htmlToText(html)
    const words = content.split(/\s+/).filter((w) => w.length > 0)

    let domain: string | undefined
    try {
      domain = new URL(url).hostname
    } catch {
      // URL parsing failed, leave domain undefined
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

  /**
   * Extract OpenGraph meta tags
   */
  private extractOpenGraphTags(html: string): Record<string, string | undefined> {
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

  /**
   * Convert HTML to clean text
   */
  private htmlToText(html: string): string {
    let text = html

    // Remove script and style content
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')

    // Remove comments
    text = text.replace(/<!--[\s\S]*?-->/g, '')

    // Remove header, footer, nav, aside (common non-content areas)
    text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    text = text.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')

    // Convert block elements to newlines
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n')
    text = text.replace(/<(br|hr)[^>]*\/?>/gi, '\n')

    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, ' ')

    // Decode HTML entities
    text = this.decodeHtmlEntities(text)

    // Clean up whitespace
    text = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return text
  }

  /**
   * Decode common HTML entities
   */
  private decodeHtmlEntities(text: string): string {
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

    // Handle numeric entities
    result = result.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    result = result.replace(/&#x([a-fA-F0-9]+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))

    return result
  }

  /**
   * Check if URL is accessible
   */
  async isAccessible(url: string): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(url, {
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
