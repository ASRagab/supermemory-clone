/**
 * Plain text extractor - handles raw text content
 */

import { ExtractionResult, ExtractorInterface, ContentType } from '../../types/document.types.js';

export class TextExtractor implements ExtractorInterface {
  /**
   * Check if this extractor can handle the content
   */
  canHandle(content: string): boolean {
    // Text extractor is the fallback - it can handle anything
    return typeof content === 'string' && content.length > 0;
  }

  /**
   * Extract text content with basic cleaning and metadata
   */
  async extract(content: string, options?: Record<string, unknown>): Promise<ExtractionResult> {
    const cleanedContent = this.cleanText(content);
    const metadata = this.extractMetadata(cleanedContent, options);

    return {
      content: cleanedContent,
      contentType: 'text' as ContentType,
      metadata,
      rawContent: content,
    };
  }

  /**
   * Clean and normalize text content
   */
  private cleanText(text: string): string {
    return (
      text
        // Normalize line endings
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Remove excessive whitespace while preserving paragraph breaks
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        // Trim each line
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        // Final trim
        .trim()
    );
  }

  /**
   * Extract metadata from text content
   */
  private extractMetadata(
    content: string,
    options?: Record<string, unknown>
  ): ExtractionResult['metadata'] {
    const words = content.split(/\s+/).filter((w) => w.length > 0);
    const lines = content.split('\n');

    // Try to extract title from first line if it looks like a title
    let title: string | undefined;
    if (lines.length > 0) {
      const firstLine = lines[0]?.trim() ?? '';
      // Use first line as title if it's non-empty and reasonably short
      if (firstLine.length > 0 && firstLine.length < 200) {
        title = firstLine;
      }
    }

    const metadataExtra = (options?.metadata as Record<string, unknown>) ?? {};

    return {
      title,
      wordCount: words.length,
      charCount: content.length,
      lineCount: lines.length,
      source: 'text',
      ...metadataExtra,
    };
  }

  /**
   * Split text into sentences for more granular processing
   */
  splitIntoSentences(text: string): string[] {
    // Simple sentence splitting - handles common cases
    const sentenceEnders = /([.!?]+)\s+/g;
    const sentences: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = sentenceEnders.exec(text)) !== null) {
      const matchGroup = match[1] ?? '';
      const sentence = text.slice(lastIndex, match.index + matchGroup.length).trim();
      if (sentence.length > 0) {
        sentences.push(sentence);
      }
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text as last sentence
    const remaining = text.slice(lastIndex).trim();
    if (remaining.length > 0) {
      sentences.push(remaining);
    }

    return sentences;
  }

  /**
   * Split text into paragraphs
   */
  splitIntoParagraphs(text: string): string[] {
    return text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }
}
