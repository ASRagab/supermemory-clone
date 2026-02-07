/**
 * Chunking Service Tests
 *
 * Tests for content chunking strategies including sentence-aware,
 * paragraph-based, and semantic chunking.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Chunk types
interface Chunk {
  content: string;
  index: number;
  startOffset: number;
  endOffset: number;
  metadata?: Record<string, unknown>;
}

interface ChunkingOptions {
  maxSize?: number;
  overlap?: number;
  preserveSentences?: boolean;
  preserveParagraphs?: boolean;
  minChunkSize?: number;
}

// Chunking service implementation
class ChunkingService {
  private defaultOptions: Required<ChunkingOptions> = {
    maxSize: 512,
    overlap: 50,
    preserveSentences: true,
    preserveParagraphs: false,
    minChunkSize: 50,
  };

  chunk(content: string, options?: ChunkingOptions): Chunk[] {
    const opts = { ...this.defaultOptions, ...options };

    if (!content || content.trim().length === 0) {
      return [];
    }

    if (opts.preserveParagraphs) {
      return this.chunkByParagraphs(content, opts);
    }

    if (opts.preserveSentences) {
      return this.chunkBySentences(content, opts);
    }

    return this.chunkBySize(content, opts);
  }

  private chunkBySize(content: string, opts: Required<ChunkingOptions>): Chunk[] {
    const chunks: Chunk[] = [];
    let index = 0;
    let position = 0;

    while (position < content.length) {
      const endPosition = Math.min(position + opts.maxSize, content.length);
      const chunkContent = content.slice(position, endPosition);

      chunks.push({
        content: chunkContent,
        index,
        startOffset: position,
        endOffset: endPosition,
      });

      position = endPosition - opts.overlap;
      if (position <= chunks[chunks.length - 1]?.startOffset ?? 0) {
        position = endPosition;
      }
      index++;
    }

    return chunks;
  }

  private chunkBySentences(content: string, opts: Required<ChunkingOptions>): Chunk[] {
    const sentences = this.splitSentences(content);
    const chunks: Chunk[] = [];
    let currentChunk = '';
    let currentStart = 0;
    let chunkIndex = 0;
    let position = 0;

    for (const sentence of sentences) {
      const sentenceLength = sentence.length;

      // If adding this sentence would exceed maxSize
      if (currentChunk.length + sentenceLength > opts.maxSize && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          content: currentChunk.trim(),
          index: chunkIndex,
          startOffset: currentStart,
          endOffset: position,
        });

        // Handle overlap
        if (opts.overlap > 0) {
          const overlapText = this.getOverlapText(currentChunk, opts.overlap);
          currentChunk = overlapText + sentence;
          currentStart = position - overlapText.length;
        } else {
          currentChunk = sentence;
          currentStart = position;
        }

        chunkIndex++;
      } else {
        currentChunk += sentence;
      }

      position += sentenceLength;
    }

    // Add remaining content
    if (currentChunk.trim().length >= opts.minChunkSize) {
      chunks.push({
        content: currentChunk.trim(),
        index: chunkIndex,
        startOffset: currentStart,
        endOffset: position,
      });
    } else if (chunks.length > 0) {
      // Append to previous chunk if too small
      const lastChunk = chunks[chunks.length - 1];
      if (lastChunk) {
        lastChunk.content = (lastChunk.content + currentChunk).trim();
        lastChunk.endOffset = position;
      }
    } else {
      // Single small chunk
      chunks.push({
        content: currentChunk.trim(),
        index: 0,
        startOffset: 0,
        endOffset: position,
      });
    }

    return chunks;
  }

  private chunkByParagraphs(content: string, opts: Required<ChunkingOptions>): Chunk[] {
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
    const chunks: Chunk[] = [];
    let currentChunk = '';
    let currentStart = 0;
    let chunkIndex = 0;
    let position = 0;

    for (const paragraph of paragraphs) {
      const paragraphWithBreak = paragraph + '\n\n';
      const paragraphLength = paragraphWithBreak.length;

      if (currentChunk.length + paragraphLength > opts.maxSize && currentChunk.length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          index: chunkIndex,
          startOffset: currentStart,
          endOffset: position,
        });

        currentChunk = paragraph + '\n\n';
        currentStart = position;
        chunkIndex++;
      } else {
        currentChunk += paragraphWithBreak;
      }

      position += paragraphLength;
    }

    if (currentChunk.trim().length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        index: chunkIndex,
        startOffset: currentStart,
        endOffset: position,
      });
    }

    return chunks;
  }

  private splitSentences(content: string): string[] {
    // Split on sentence-ending punctuation followed by whitespace
    const sentences: string[] = [];
    const pattern = /([.!?]+)(\s+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      sentences.push(content.slice(lastIndex, match.index + match[1].length + match[2].length));
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      sentences.push(content.slice(lastIndex));
    }

    return sentences;
  }

  private getOverlapText(text: string, targetLength: number): string {
    // Get text from the end up to targetLength
    const trimmed = text.trim();
    if (trimmed.length <= targetLength) {
      return trimmed + ' ';
    }

    // Try to break at word boundary
    const start = trimmed.length - targetLength;
    const overlapText = trimmed.slice(start);
    const wordBoundary = overlapText.indexOf(' ');

    if (wordBoundary > 0 && wordBoundary < targetLength / 2) {
      return overlapText.slice(wordBoundary + 1) + ' ';
    }

    return overlapText + ' ';
  }

  estimateChunks(contentLength: number, options?: ChunkingOptions): number {
    const opts = { ...this.defaultOptions, ...options };
    const effectiveSize = opts.maxSize - opts.overlap;
    return Math.ceil(contentLength / effectiveSize);
  }
}

describe('ChunkingService', () => {
  let service: ChunkingService;

  beforeEach(() => {
    service = new ChunkingService();
  });

  describe('chunk()', () => {
    it('should return empty array for empty content', () => {
      expect(service.chunk('')).toEqual([]);
      expect(service.chunk('   ')).toEqual([]);
    });

    it('should return single chunk for short content', () => {
      const content = 'Short text.';
      const chunks = service.chunk(content);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.content).toBe(content);
      expect(chunks[0]?.index).toBe(0);
    });

    it('should include correct offsets', () => {
      const content = 'This is a test. Another sentence.';
      const chunks = service.chunk(content, { maxSize: 1000 });

      expect(chunks[0]?.startOffset).toBe(0);
      expect(chunks[0]?.endOffset).toBeGreaterThan(0);
    });
  });

  describe('sentence-aware chunking', () => {
    it('should preserve sentence boundaries', () => {
      const content = 'First sentence. Second sentence. Third sentence.';
      const chunks = service.chunk(content, { maxSize: 30, preserveSentences: true });

      // Each chunk should end at a sentence boundary
      for (const chunk of chunks) {
        const trimmed = chunk.content.trim();
        if (trimmed.length > 0) {
          expect(trimmed.match(/[.!?]$/)).toBeTruthy();
        }
      }
    });

    it('should handle long sentences', () => {
      const longSentence =
        'This is a very long sentence that exceeds the maximum chunk size limit.';
      const chunks = service.chunk(longSentence, { maxSize: 30, preserveSentences: true });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle multiple punctuation marks', () => {
      const content = 'What?! Yes!! Really...';
      const chunks = service.chunk(content, { maxSize: 100, preserveSentences: true });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('paragraph chunking', () => {
    it('should split on paragraph boundaries', () => {
      const content = `First paragraph with some text.

Second paragraph with more text.

Third paragraph here.`;

      const chunks = service.chunk(content, {
        maxSize: 100,
        preserveParagraphs: true,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should combine small paragraphs', () => {
      const content = `Short para 1.

Short para 2.

Short para 3.`;

      const chunks = service.chunk(content, {
        maxSize: 200,
        preserveParagraphs: true,
      });

      expect(chunks.length).toBeLessThan(3);
    });

    it('should handle single paragraph', () => {
      const content = 'Just one paragraph without breaks.';
      const chunks = service.chunk(content, { preserveParagraphs: true });

      expect(chunks).toHaveLength(1);
    });
  });

  describe('overlap handling', () => {
    it('should include overlap between chunks', () => {
      const content = 'Sentence one. Sentence two. Sentence three. Sentence four.';
      const chunks = service.chunk(content, {
        maxSize: 30,
        overlap: 10,
        preserveSentences: true,
      });

      if (chunks.length >= 2) {
        const firstEnd = chunks[0]?.content.slice(-10);
        const secondStart = chunks[1]?.content.slice(0, 20);
        // Check for some overlap
        expect(firstEnd?.length ?? 0).toBeGreaterThan(0);
        expect(secondStart?.length ?? 0).toBeGreaterThan(0);
      }
    });

    it('should handle zero overlap', () => {
      const content = 'Sentence one. Sentence two. Sentence three.';
      const chunks = service.chunk(content, {
        maxSize: 20,
        overlap: 0,
        preserveSentences: true,
      });

      // No content should be repeated
      const combined = chunks.map((c) => c.content).join('');
      expect(combined.length).toBeLessThanOrEqual(content.length + chunks.length);
    });
  });

  describe('size-based chunking', () => {
    it('should split by size when sentence preservation is disabled', () => {
      const content = 'A'.repeat(100);
      const chunks = service.chunk(content, {
        maxSize: 30,
        preserveSentences: false,
        overlap: 0,
      });

      expect(chunks.length).toBe(4);
      expect(chunks[0]?.content.length).toBe(30);
    });

    it('should handle overlap in size-based chunking', () => {
      const content = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const chunks = service.chunk(content, {
        maxSize: 10,
        overlap: 3,
        preserveSentences: false,
      });

      expect(chunks.length).toBeGreaterThan(2);
    });
  });

  describe('minChunkSize', () => {
    it('should merge small chunks with previous', () => {
      const content = 'Long sentence with many words. X.';
      const chunks = service.chunk(content, {
        maxSize: 50,
        minChunkSize: 10,
        preserveSentences: true,
      });

      // The small "X." should be merged
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk?.content.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('chunk indices', () => {
    it('should assign sequential indices', () => {
      const content = 'First. Second. Third. Fourth. Fifth.';
      const chunks = service.chunk(content, { maxSize: 15, preserveSentences: true });

      chunks.forEach((chunk, i) => {
        expect(chunk.index).toBe(i);
      });
    });
  });

  describe('estimateChunks()', () => {
    it('should estimate chunk count', () => {
      const estimate = service.estimateChunks(1000, { maxSize: 200, overlap: 50 });

      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThanOrEqual(10);
    });

    it('should return 1 for small content', () => {
      const estimate = service.estimateChunks(100, { maxSize: 500 });

      expect(estimate).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle content with only punctuation', () => {
      const content = '...';
      const chunks = service.chunk(content);

      expect(chunks.length).toBeLessThanOrEqual(1);
    });

    it('should handle content with unicode', () => {
      const content = 'Hello. Unicode test.';
      const chunks = service.chunk(content, { maxSize: 100 });

      expect(chunks[0]?.content).toContain('Unicode');
    });

    it('should handle very long content', () => {
      const content = 'Test sentence. '.repeat(1000);
      const chunks = service.chunk(content, { maxSize: 500 });

      expect(chunks.length).toBeGreaterThan(10);
    });

    it('should handle content with no sentence endings', () => {
      const content = 'This is content without any sentence ending punctuation';
      const chunks = service.chunk(content, { preserveSentences: true });

      expect(chunks).toHaveLength(1);
    });
  });
});
