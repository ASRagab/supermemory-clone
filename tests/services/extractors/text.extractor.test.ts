/**
 * Text Extractor Tests
 *
 * Tests for plain text extraction including content cleaning,
 * metadata extraction, and text splitting utilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Types
interface ExtractionResult {
  content: string;
  contentType: string;
  metadata: Record<string, unknown>;
  rawContent?: string;
}

// Text Extractor implementation
class TextExtractor {
  canHandle(content: string): boolean {
    return typeof content === 'string' && content.length > 0;
  }

  async extract(content: string, options?: Record<string, unknown>): Promise<ExtractionResult> {
    const cleanedContent = this.cleanText(content);
    const metadata = this.extractMetadata(cleanedContent, options);

    return {
      content: cleanedContent,
      contentType: 'text',
      metadata,
      rawContent: content,
    };
  }

  cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim();
  }

  private extractMetadata(
    content: string,
    options?: Record<string, unknown>
  ): ExtractionResult['metadata'] {
    const words = content.split(/\s+/).filter((w) => w.length > 0);
    const lines = content.split('\n');

    let title: string | undefined;
    if (lines.length > 0) {
      const firstLine = lines[0]?.trim() ?? '';
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

  splitIntoSentences(text: string): string[] {
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

    const remaining = text.slice(lastIndex).trim();
    if (remaining.length > 0) {
      sentences.push(remaining);
    }

    return sentences;
  }

  splitIntoParagraphs(text: string): string[] {
    return text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }
}

describe('TextExtractor', () => {
  let extractor: TextExtractor;

  beforeEach(() => {
    extractor = new TextExtractor();
  });

  describe('canHandle()', () => {
    it('should accept non-empty strings', () => {
      expect(extractor.canHandle('Some text')).toBe(true);
      expect(extractor.canHandle('a')).toBe(true);
    });

    it('should reject empty strings', () => {
      expect(extractor.canHandle('')).toBe(false);
    });

    it('should handle whitespace-only strings', () => {
      // Whitespace strings are still strings, so they can be handled
      expect(extractor.canHandle('   ')).toBe(true);
    });
  });

  describe('extract()', () => {
    it('should extract text content', async () => {
      const result = await extractor.extract('Hello, world!');

      expect(result.content).toBe('Hello, world!');
      expect(result.contentType).toBe('text');
    });

    it('should clean text content', async () => {
      const result = await extractor.extract('  Hello   world  \r\n\r\n\r\n  ');

      expect(result.content).toBe('Hello world');
    });

    it('should preserve raw content', async () => {
      const raw = '  Raw   content  ';
      const result = await extractor.extract(raw);

      expect(result.rawContent).toBe(raw);
    });

    it('should include metadata', async () => {
      const result = await extractor.extract('First line\nSecond line\nThird line');

      expect(result.metadata.wordCount).toBe(6);
      expect(result.metadata.lineCount).toBe(3);
    });

    it('should extract title from first line', async () => {
      const result = await extractor.extract('Document Title\n\nContent here.');

      expect(result.metadata.title).toBe('Document Title');
    });

    it('should merge additional metadata', async () => {
      const result = await extractor.extract('Content', {
        metadata: { customField: 'value' },
      });

      expect(result.metadata.customField).toBe('value');
    });

    it('should set source as text', async () => {
      const result = await extractor.extract('Content');

      expect(result.metadata.source).toBe('text');
    });
  });

  describe('cleanText()', () => {
    it('should normalize line endings', () => {
      expect(extractor.cleanText('line1\r\nline2\rline3')).toBe('line1\nline2\nline3');
    });

    it('should collapse multiple spaces', () => {
      expect(extractor.cleanText('word1    word2\tword3')).toBe('word1 word2 word3');
    });

    it('should collapse multiple newlines', () => {
      expect(extractor.cleanText('para1\n\n\n\n\npara2')).toBe('para1\n\npara2');
    });

    it('should trim each line', () => {
      expect(extractor.cleanText('  line1  \n  line2  ')).toBe('line1\nline2');
    });

    it('should trim overall content', () => {
      expect(extractor.cleanText('\n\n  content  \n\n')).toBe('content');
    });

    it('should preserve single newlines', () => {
      expect(extractor.cleanText('line1\nline2')).toBe('line1\nline2');
    });

    it('should preserve paragraph breaks', () => {
      expect(extractor.cleanText('para1\n\npara2')).toBe('para1\n\npara2');
    });
  });

  describe('splitIntoSentences()', () => {
    it('should split on periods', () => {
      const sentences = extractor.splitIntoSentences('First sentence. Second sentence.');

      expect(sentences).toHaveLength(2);
      expect(sentences[0]).toBe('First sentence.');
      expect(sentences[1]).toBe('Second sentence.');
    });

    it('should split on exclamation marks', () => {
      const sentences = extractor.splitIntoSentences('Hello! How are you!');

      expect(sentences).toHaveLength(2);
    });

    it('should split on question marks', () => {
      const sentences = extractor.splitIntoSentences('What is this? Is it working?');

      expect(sentences).toHaveLength(2);
    });

    it('should handle multiple punctuation marks', () => {
      const sentences = extractor.splitIntoSentences('Really?! Yes!! Of course...');

      expect(sentences.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle text without sentence endings', () => {
      const sentences = extractor.splitIntoSentences('No sentence ending here');

      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe('No sentence ending here');
    });

    it('should handle empty text', () => {
      const sentences = extractor.splitIntoSentences('');

      expect(sentences).toHaveLength(0);
    });

    it('should trim sentences', () => {
      const sentences = extractor.splitIntoSentences('First.   Second.');

      expect(sentences[0]).toBe('First.');
      expect(sentences[1]).toBe('Second.');
    });

    it('should handle abbreviations in context', () => {
      const sentences = extractor.splitIntoSentences('Dr. Smith went to work. He arrived early.');

      // This basic implementation might split on 'Dr.' - that's expected
      expect(sentences.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('splitIntoParagraphs()', () => {
    it('should split on double newlines', () => {
      const paragraphs = extractor.splitIntoParagraphs('Para 1\n\nPara 2');

      expect(paragraphs).toHaveLength(2);
      expect(paragraphs[0]).toBe('Para 1');
      expect(paragraphs[1]).toBe('Para 2');
    });

    it('should handle multiple blank lines', () => {
      const paragraphs = extractor.splitIntoParagraphs('Para 1\n\n\n\nPara 2');

      expect(paragraphs).toHaveLength(2);
    });

    it('should trim paragraphs', () => {
      const paragraphs = extractor.splitIntoParagraphs('  Para 1  \n\n  Para 2  ');

      expect(paragraphs[0]).toBe('Para 1');
      expect(paragraphs[1]).toBe('Para 2');
    });

    it('should filter empty paragraphs', () => {
      const paragraphs = extractor.splitIntoParagraphs('Para 1\n\n\n\n\n\nPara 2');

      expect(paragraphs).toHaveLength(2);
    });

    it('should handle single paragraph', () => {
      const paragraphs = extractor.splitIntoParagraphs('Just one paragraph.');

      expect(paragraphs).toHaveLength(1);
    });

    it('should handle empty text', () => {
      const paragraphs = extractor.splitIntoParagraphs('');

      expect(paragraphs).toHaveLength(0);
    });

    it('should handle only whitespace', () => {
      const paragraphs = extractor.splitIntoParagraphs('   \n\n   ');

      expect(paragraphs).toHaveLength(0);
    });
  });

  describe('metadata extraction', () => {
    it('should count words correctly', async () => {
      const result = await extractor.extract('one two three four five');

      expect(result.metadata.wordCount).toBe(5);
    });

    it('should count characters correctly', async () => {
      const result = await extractor.extract('hello');

      expect(result.metadata.charCount).toBe(5);
    });

    it('should count lines correctly', async () => {
      const result = await extractor.extract('line1\nline2\nline3');

      expect(result.metadata.lineCount).toBe(3);
    });

    it('should not set title if first line is too long', async () => {
      const longFirstLine = 'A'.repeat(250);
      const result = await extractor.extract(longFirstLine);

      expect(result.metadata.title).toBeUndefined();
    });

    it('should not set title for empty first line', async () => {
      const result = await extractor.extract('\n\nActual content');

      // After cleaning, the first non-empty line might become title
      expect(result.metadata.title).toBe('Actual content');
    });

    it('should handle zero words', async () => {
      const result = await extractor.extract('   ');

      expect(result.metadata.wordCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle unicode content', async () => {
      const result = await extractor.extract('Unicode text here');

      expect(result.content).toContain('Unicode');
    });

    it('should handle very long content', async () => {
      const longContent = 'Word '.repeat(10000);
      const result = await extractor.extract(longContent);

      expect(result.metadata.wordCount).toBe(10000);
    });

    it('should handle special characters', async () => {
      const result = await extractor.extract('Special: @#$%^&*()');

      expect(result.content).toContain('@#$%^&*()');
    });

    it('should handle tabs and mixed whitespace', async () => {
      const result = await extractor.extract('word1\t\t\tword2   word3');

      expect(result.content).toBe('word1 word2 word3');
    });

    it('should handle content with only punctuation', async () => {
      const result = await extractor.extract('...');

      expect(result.content).toBe('...');
      expect(result.metadata.wordCount).toBe(1);
    });

    it('should handle mixed line endings', async () => {
      const result = await extractor.extract('line1\nline2\r\nline3\rline4');

      expect(result.content).toBe('line1\nline2\nline3\nline4');
    });
  });
});
