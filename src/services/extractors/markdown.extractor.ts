/**
 * Markdown extractor - parses markdown by headings and structure
 */

import yaml from 'js-yaml'
import { ExtractionResult, ExtractorInterface, ContentType } from '../../types/document.types.js'

export interface MarkdownSection {
  level: number
  heading: string
  content: string
  startLine: number
  endLine: number
  children: MarkdownSection[]
}

export class MarkdownExtractor implements ExtractorInterface {
  // Patterns for markdown detection
  private readonly headingPattern = /^#{1,6}\s+.+$/m
  private readonly codeBlockPattern = /```[\s\S]*?```/
  private readonly linkPattern = /\[([^\]]+)\]\([^)]+\)/
  private readonly listPattern = /^[\s]*[-*+]\s+/m
  private readonly boldPattern = /\*\*[^*]+\*\*/
  private readonly italicPattern = /\*[^*]+\*/

  /**
   * Check if content appears to be markdown
   */
  canHandle(content: string): boolean {
    if (typeof content !== 'string' || content.length === 0) {
      return false
    }

    // Count markdown features
    let score = 0

    if (this.headingPattern.test(content)) score += 3
    if (this.codeBlockPattern.test(content)) score += 2
    if (this.linkPattern.test(content)) score += 1
    if (this.listPattern.test(content)) score += 1
    if (this.boldPattern.test(content)) score += 1
    if (this.italicPattern.test(content)) score += 1

    return score >= 2
  }

  /**
   * Extract and parse markdown content
   */
  async extract(content: string, options?: Record<string, unknown>): Promise<ExtractionResult> {
    const sections = this.parseSections(content)
    const plainText = this.toPlainText(content)
    const metadata = this.extractMetadata(content, sections)

    return {
      content: options?.preserveMarkdown ? content : plainText,
      contentType: 'markdown' as ContentType,
      metadata: {
        ...metadata,
        sections: sections.map((s) => ({
          level: s.level,
          heading: s.heading,
          charCount: s.content.length,
        })),
      },
      rawContent: content,
    }
  }

  /**
   * Parse markdown into hierarchical sections
   */
  parseSections(content: string): MarkdownSection[] {
    const lines = content.split('\n')
    const sections: MarkdownSection[] = []
    const stack: MarkdownSection[] = []

    let currentContent: string[] = []
    let contentStartLine = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)

      if (headingMatch) {
        // Save accumulated content to previous section
        const lastInStack = stack[stack.length - 1]
        if (lastInStack && currentContent.length > 0) {
          lastInStack.content = currentContent.join('\n').trim()
        } else if (currentContent.length > 0 && sections.length === 0) {
          // Content before first heading - create implicit section
          sections.push({
            level: 0,
            heading: '',
            content: currentContent.join('\n').trim(),
            startLine: contentStartLine,
            endLine: i - 1,
            children: [],
          })
        }

        const level = headingMatch[1]?.length ?? 1
        const heading = headingMatch[2]?.trim() ?? ''

        const section: MarkdownSection = {
          level,
          heading,
          content: '',
          startLine: i,
          endLine: i,
          children: [],
        }

        // Pop stack until we find a parent with lower level
        while (stack.length > 0) {
          const top = stack[stack.length - 1]
          if (top && top.level >= level) {
            const completed = stack.pop()
            if (completed) {
              completed.endLine = i - 1
            }
          } else {
            break
          }
        }

        // Add as child to parent or to root
        const parent = stack[stack.length - 1]
        if (parent) {
          parent.children.push(section)
        } else {
          sections.push(section)
        }

        stack.push(section)
        currentContent = []
        contentStartLine = i + 1
      } else {
        currentContent.push(line)
      }
    }

    // Finalize remaining content and sections
    const lastInStack = stack[stack.length - 1]
    if (lastInStack && currentContent.length > 0) {
      lastInStack.content = currentContent.join('\n').trim()
    }

    while (stack.length > 0) {
      const completed = stack.pop()
      if (completed) {
        completed.endLine = lines.length - 1
      }
    }

    return sections
  }

  /**
   * Convert markdown to plain text
   */
  toPlainText(markdown: string): string {
    let text = markdown

    // Remove code blocks (preserve content)
    text = text.replace(/```[\w]*\n([\s\S]*?)```/g, '$1')
    text = text.replace(/`([^`]+)`/g, '$1')

    // Convert headings to text
    text = text.replace(/^#{1,6}\s+(.+)$/gm, '$1')

    // Convert links
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

    // Remove images
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')

    // Convert bold and italic
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
    text = text.replace(/\*([^*]+)\*/g, '$1')
    text = text.replace(/___([^_]+)___/g, '$1')
    text = text.replace(/__([^_]+)__/g, '$1')
    text = text.replace(/_([^_]+)_/g, '$1')

    // Convert strikethrough
    text = text.replace(/~~([^~]+)~~/g, '$1')

    // Convert blockquotes
    text = text.replace(/^>\s+/gm, '')

    // Convert horizontal rules
    text = text.replace(/^[-*_]{3,}$/gm, '')

    // Simplify lists
    text = text.replace(/^[\s]*[-*+]\s+/gm, '- ')
    text = text.replace(/^[\s]*\d+\.\s+/gm, '- ')

    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, '')

    // Clean up whitespace
    text = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return text
  }

  /**
   * Extract metadata from markdown
   */
  private extractMetadata(content: string, sections: MarkdownSection[]): ExtractionResult['metadata'] {
    const plainText = this.toPlainText(content)
    const words = plainText.split(/\s+/).filter((w) => w.length > 0)

    // Try to extract title from first H1
    let title: string | undefined
    const h1 = sections.find((s) => s.level === 1)
    if (h1) {
      title = h1.heading
    } else {
      // Try frontmatter title
      const frontmatter = this.parseFrontmatter(content)
      if (frontmatter && typeof frontmatter['title'] === 'string') {
        title = frontmatter['title']
      }
    }

    // Extract tags from frontmatter or inline
    const frontmatter = this.parseFrontmatter(content)
    let tags: string[] | undefined
    if (frontmatter && Array.isArray(frontmatter['tags'])) {
      tags = frontmatter['tags'] as string[]
    } else {
      tags = this.extractInlineTags(content)
    }

    // Count code blocks
    const codeBlocks = (content.match(/```[\s\S]*?```/g) ?? []).length

    // Count links
    const links = (content.match(/\[([^\]]+)\]\([^)]+\)/g) ?? []).length

    const result: ExtractionResult['metadata'] = {
      title,
      tags,
      source: 'markdown',
      mimeType: 'text/markdown',
      wordCount: words.length,
      charCount: plainText.length,
      sectionCount: this.countAllSections(sections),
      codeBlockCount: codeBlocks,
      linkCount: links,
      hasTableOfContents: content.includes('[TOC]') || content.includes('[[toc]]'),
    }

    if (frontmatter && typeof frontmatter['author'] === 'string') {
      result['author'] = frontmatter['author']
    }
    if (frontmatter && typeof frontmatter['description'] === 'string') {
      result['description'] = frontmatter['description']
    }

    return result
  }

  /**
   * Parse YAML frontmatter using js-yaml for proper parsing
   * Handles multi-line values, nested objects, arrays, and all YAML features
   */
  private parseFrontmatter(content: string): Record<string, unknown> | undefined {
    // Match frontmatter block with flexible newline handling
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match?.[1]) return undefined

    try {
      // Use js-yaml for proper YAML parsing
      const parsed = yaml.load(match[1], {
        // Safe schema - doesn't allow JS functions
        schema: yaml.DEFAULT_SCHEMA,
        // Return undefined for empty documents
        json: false,
      })

      // Validate result is an object
      if (parsed === null || parsed === undefined) {
        return undefined
      }

      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        // YAML returned a non-object (e.g., a string or array at root)
        return undefined
      }

      return parsed as Record<string, unknown>
    } catch (error) {
      // YAML parsing failed, try fallback simple parser
      console.warn('YAML frontmatter parsing failed, using fallback parser:', error)
      return this.parseFrontmatterFallback(match[1])
    }
  }

  /**
   * Fallback frontmatter parser for simple key-value pairs
   * Used when js-yaml fails
   */
  private parseFrontmatterFallback(frontmatterContent: string): Record<string, unknown> | undefined {
    const frontmatter: Record<string, unknown> = {}
    const lines = frontmatterContent.split('\n')
    let currentKey: string | null = null
    let currentArrayItems: string[] = []
    let inMultilineArray = false

    for (const line of lines) {
      // Check if this is an array item (starts with -)
      if (inMultilineArray && /^\s*-\s+/.test(line)) {
        const itemValue = line.replace(/^\s*-\s+/, '').trim()
        currentArrayItems.push(this.cleanYamlValue(itemValue))
        continue
      }

      // If we were in a multiline array and hit a new key, save the array
      if (inMultilineArray && currentKey && /^\w+\s*:/.test(line)) {
        frontmatter[currentKey] = currentArrayItems
        currentArrayItems = []
        inMultilineArray = false
        currentKey = null
      }

      const colonIndex = line.indexOf(':')
      if (colonIndex > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
        const key = line.slice(0, colonIndex).trim()
        const value: string = line.slice(colonIndex + 1).trim()

        // Check for multi-line array or value
        if (value === '') {
          // Could be multi-line array or block scalar
          currentKey = key
          inMultilineArray = true
          currentArrayItems = []
          continue
        }

        // Handle inline arrays [a, b, c]
        if (value.startsWith('[') && value.endsWith(']')) {
          frontmatter[key] = value
            .slice(1, -1)
            .split(',')
            .map((v) => this.cleanYamlValue(v.trim()))
          continue
        }

        // Handle inline objects (basic)
        if (value.startsWith('{') && value.endsWith('}')) {
          try {
            frontmatter[key] = JSON.parse(value.replace(/'/g, '"'))
          } catch {
            frontmatter[key] = this.cleanYamlValue(value)
          }
          continue
        }

        // Handle booleans
        if (value.toLowerCase() === 'true') {
          frontmatter[key] = true
          continue
        }
        if (value.toLowerCase() === 'false') {
          frontmatter[key] = false
          continue
        }

        // Handle numbers
        if (/^-?\d+$/.test(value)) {
          frontmatter[key] = parseInt(value, 10)
          continue
        }
        if (/^-?\d+\.\d+$/.test(value)) {
          frontmatter[key] = parseFloat(value)
          continue
        }

        // Handle null
        if (value.toLowerCase() === 'null' || value === '~') {
          frontmatter[key] = null
          continue
        }

        // Handle dates
        if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(value)) {
          const date = new Date(value)
          if (!Number.isNaN(date.getTime())) {
            frontmatter[key] = date.toISOString()
            continue
          }
        }

        // Default: treat as string
        frontmatter[key] = this.cleanYamlValue(value)
      }
    }

    // Save any pending multiline array
    if (inMultilineArray && currentKey && currentArrayItems.length > 0) {
      frontmatter[currentKey] = currentArrayItems
    }

    return Object.keys(frontmatter).length > 0 ? frontmatter : undefined
  }

  /**
   * Clean a YAML value (remove quotes, trim)
   */
  private cleanYamlValue(value: string): string {
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1)
    }
    return value
  }

  /**
   * Extract inline tags (hashtags)
   */
  private extractInlineTags(content: string): string[] | undefined {
    const tags = content.match(/#[\w-]+/g)
    if (!tags || tags.length === 0) return undefined

    return [...new Set(tags.map((t) => t.slice(1)))]
  }

  /**
   * Count all sections including nested
   */
  private countAllSections(sections: MarkdownSection[]): number {
    let count = sections.length
    for (const section of sections) {
      count += this.countAllSections(section.children)
    }
    return count
  }

  /**
   * Get flat list of all sections
   */
  flattenSections(sections: MarkdownSection[]): MarkdownSection[] {
    const flat: MarkdownSection[] = []

    const traverse = (secs: MarkdownSection[]) => {
      for (const section of secs) {
        flat.push(section)
        traverse(section.children)
      }
    }

    traverse(sections)
    return flat
  }
}
