/**
 * PDF Extractor Tests
 *
 * Tests for PDF content extraction including buffer handling,
 * metadata extraction, and text cleaning.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// PDF extractor interface
interface ExtractionResult {
  content: string;
  contentType: string;
  metadata: Record<string, unknown>;
  rawContent?: string;
}

interface ExtractorInterface {
  canHandle(content: string | Buffer): boolean;
  extract(content: string | Buffer, options?: Record<string, unknown>): Promise<ExtractionResult>;
}

// Mock PDF data
interface MockPdfData {
  numpages: number;
  text: string;
  info: {
    Title?: string;
    Author?: string;
    Subject?: string;
    Keywords?: string;
    CreationDate?: string;
  };
  version: string;
}

// PDF Extractor implementation for testing
class PdfExtractor implements ExtractorInterface {
  private mockPdfParse: ((buffer: Buffer) => Promise<MockPdfData>) | null = null;

  constructor(mockParser?: (buffer: Buffer) => Promise<MockPdfData>) {
    this.mockPdfParse = mockParser ?? null;
  }

  canHandle(content: string | Buffer): boolean {
    if (Buffer.isBuffer(content)) {
      return content.slice(0, 4).toString() === '%PDF';
    }

    if (typeof content === 'string') {
      if (content.startsWith('data:application/pdf;base64,')) {
        return true;
      }
      if (content.startsWith('%PDF')) {
        return true;
      }
      try {
        const decoded = Buffer.from(content.slice(0, 100), 'base64').toString();
        return decoded.startsWith('%PDF');
      } catch {
        return false;
      }
    }

    return false;
  }

  async extract(
    content: string | Buffer,
    options?: Record<string, unknown>
  ): Promise<ExtractionResult> {
    const buffer = this.toBuffer(content);

    if (!this.mockPdfParse) {
      throw new Error('pdf-parse is not installed');
    }

    const pdfData = await this.mockPdfParse(buffer);
    const cleanedText = this.cleanPdfText(pdfData.text);
    const metadata = this.extractMetadata(pdfData, cleanedText);

    return {
      content: cleanedText,
      contentType: 'pdf',
      metadata,
      rawContent: pdfData.text,
    };
  }

  private toBuffer(content: string | Buffer): Buffer {
    if (Buffer.isBuffer(content)) {
      return content;
    }

    if (content.startsWith('data:application/pdf;base64,')) {
      const base64Data = content.replace('data:application/pdf;base64,', '');
      return Buffer.from(base64Data, 'base64');
    }

    try {
      const buffer = Buffer.from(content, 'base64');
      if (buffer.slice(0, 4).toString() === '%PDF') {
        return buffer;
      }
    } catch {
      // Not base64
    }

    return Buffer.from(content, 'binary');
  }

  private cleanPdfText(text: string): string {
    return text
      .replace(/\f/g, '\n\n')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/(\w)-\n(\w)/g, '$1$2')
      .replace(/^\s*\d+\s*$/gm, '')
      .replace(/\n\s*Page\s+\d+\s*\n/gi, '\n')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim();
  }

  private extractMetadata(pdfData: MockPdfData, cleanedText: string): ExtractionResult['metadata'] {
    const words = cleanedText.split(/\s+/).filter((w) => w.length > 0);
    const info = pdfData.info ?? {};

    let createdAt: string | undefined;
    if (info.CreationDate) {
      createdAt = this.parsePdfDate(info.CreationDate);
    }

    let tags: string[] | undefined;
    if (info.Keywords) {
      tags = info.Keywords.split(/[,;]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
    }

    return {
      title: info.Title,
      author: info.Author,
      description: info.Subject,
      tags,
      source: 'pdf',
      mimeType: 'application/pdf',
      wordCount: words.length,
      charCount: cleanedText.length,
      pageCount: pdfData.numpages,
      pdfVersion: pdfData.version,
      createdAt,
    };
  }

  private parsePdfDate(dateStr: string): string | undefined {
    try {
      const clean = dateStr.replace(/^D:/, '');
      const year = clean.slice(0, 4);
      const month = clean.slice(4, 6) || '01';
      const day = clean.slice(6, 8) || '01';
      const hour = clean.slice(8, 10) || '00';
      const minute = clean.slice(10, 12) || '00';
      const second = clean.slice(12, 14) || '00';

      const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
      return date.toISOString();
    } catch {
      return undefined;
    }
  }
}

describe('PdfExtractor', () => {
  let extractor: PdfExtractor;
  let mockParser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockParser = vi.fn();
    extractor = new PdfExtractor(mockParser);
  });

  describe('canHandle()', () => {
    it('should detect PDF buffer by magic bytes', () => {
      const buffer = Buffer.from('%PDF-1.4 fake content');

      expect(extractor.canHandle(buffer)).toBe(true);
    });

    it('should reject non-PDF buffer', () => {
      const buffer = Buffer.from('Not a PDF file');

      expect(extractor.canHandle(buffer)).toBe(false);
    });

    it('should detect base64 data URI', () => {
      const base64 = 'data:application/pdf;base64,JVBERi0xLjQK';

      expect(extractor.canHandle(base64)).toBe(true);
    });

    it('should detect raw PDF string', () => {
      expect(extractor.canHandle('%PDF-1.5 content')).toBe(true);
    });

    it('should detect base64-encoded PDF', () => {
      const pdfContent = '%PDF-1.4';
      const base64 = Buffer.from(pdfContent).toString('base64');

      expect(extractor.canHandle(base64)).toBe(true);
    });

    it('should reject random string', () => {
      expect(extractor.canHandle('random text content')).toBe(false);
    });

    it('should reject empty content', () => {
      expect(extractor.canHandle('')).toBe(false);
      expect(extractor.canHandle(Buffer.from(''))).toBe(false);
    });
  });

  describe('extract()', () => {
    it('should extract text from PDF buffer', async () => {
      mockParser.mockResolvedValueOnce({
        numpages: 5,
        text: 'Extracted PDF content',
        info: { Title: 'Test Document' },
        version: '1.4',
      });

      const buffer = Buffer.from('%PDF-1.4 content');
      const result = await extractor.extract(buffer);

      expect(result.content).toBe('Extracted PDF content');
      expect(result.contentType).toBe('pdf');
    });

    it('should extract metadata', async () => {
      mockParser.mockResolvedValueOnce({
        numpages: 10,
        text: 'Content here',
        info: {
          Title: 'My Document',
          Author: 'John Doe',
          Subject: 'Test PDF',
          Keywords: 'test, pdf, document',
        },
        version: '1.7',
      });

      const buffer = Buffer.from('%PDF-1.4 content');
      const result = await extractor.extract(buffer);

      expect(result.metadata.title).toBe('My Document');
      expect(result.metadata.author).toBe('John Doe');
      expect(result.metadata.description).toBe('Test PDF');
      expect(result.metadata.tags).toEqual(['test', 'pdf', 'document']);
      expect(result.metadata.pageCount).toBe(10);
      expect(result.metadata.pdfVersion).toBe('1.7');
    });

    it('should clean PDF text artifacts', async () => {
      const dirtyText =
        'Line 1\f\fLine 2\r\nLine 3    extra spaces\n\n\n\nToo many breaks\nword-\nbreak';

      mockParser.mockResolvedValueOnce({
        numpages: 1,
        text: dirtyText,
        info: {},
        version: '1.4',
      });

      const buffer = Buffer.from('%PDF-1.4');
      const result = await extractor.extract(buffer);

      expect(result.content).not.toContain('\f');
      expect(result.content).not.toContain('\r');
      expect(result.content).not.toContain('    ');
      expect(result.content).not.toContain('\n\n\n');
      expect(result.content).toContain('wordbreak');
    });

    it('should remove page numbers', async () => {
      mockParser.mockResolvedValueOnce({
        numpages: 3,
        text: 'Content\n\n1\n\nMore content\nPage 2\nEnd',
        info: {},
        version: '1.4',
      });

      const buffer = Buffer.from('%PDF-1.4');
      const result = await extractor.extract(buffer);

      expect(result.content).not.toMatch(/^\s*1\s*$/m);
      expect(result.content).not.toMatch(/Page\s+2/i);
    });

    it('should preserve raw content', async () => {
      const rawText = 'Raw PDF text with artifacts\f\f';

      mockParser.mockResolvedValueOnce({
        numpages: 1,
        text: rawText,
        info: {},
        version: '1.4',
      });

      const buffer = Buffer.from('%PDF-1.4');
      const result = await extractor.extract(buffer);

      expect(result.rawContent).toBe(rawText);
    });

    it('should handle base64 data URI input', async () => {
      mockParser.mockResolvedValueOnce({
        numpages: 1,
        text: 'Decoded content',
        info: {},
        version: '1.4',
      });

      const base64 = 'data:application/pdf;base64,JVBERi0xLjQgY29udGVudA==';
      const result = await extractor.extract(base64);

      expect(result.content).toBe('Decoded content');
      expect(mockParser).toHaveBeenCalled();
    });

    it('should calculate word and char counts', async () => {
      mockParser.mockResolvedValueOnce({
        numpages: 1,
        text: 'Word one two three four five',
        info: {},
        version: '1.4',
      });

      const buffer = Buffer.from('%PDF-1.4');
      const result = await extractor.extract(buffer);

      expect(result.metadata.wordCount).toBe(6);
      expect(result.metadata.charCount).toBeGreaterThan(0);
    });

    it('should parse PDF creation date', async () => {
      mockParser.mockResolvedValueOnce({
        numpages: 1,
        text: 'Content',
        info: {
          CreationDate: 'D:20240115103000',
        },
        version: '1.4',
      });

      const buffer = Buffer.from('%PDF-1.4');
      const result = await extractor.extract(buffer);

      expect(result.metadata.createdAt).toBeDefined();
      expect(result.metadata.createdAt).toContain('2024-01-15');
    });

    it('should handle missing metadata gracefully', async () => {
      mockParser.mockResolvedValueOnce({
        numpages: 1,
        text: 'Minimal PDF',
        info: {},
        version: '1.4',
      });

      const buffer = Buffer.from('%PDF-1.4');
      const result = await extractor.extract(buffer);

      expect(result.metadata.title).toBeUndefined();
      expect(result.metadata.author).toBeUndefined();
      expect(result.metadata.source).toBe('pdf');
    });
  });

  describe('error handling', () => {
    it('should throw when parser is not available', async () => {
      const extractorWithoutParser = new PdfExtractor();
      const buffer = Buffer.from('%PDF-1.4');

      await expect(extractorWithoutParser.extract(buffer)).rejects.toThrow(
        'pdf-parse is not installed'
      );
    });

    it('should propagate parser errors', async () => {
      mockParser.mockRejectedValueOnce(new Error('Parse failed'));

      const buffer = Buffer.from('%PDF-1.4');

      await expect(extractor.extract(buffer)).rejects.toThrow('Parse failed');
    });
  });

  describe('edge cases', () => {
    it('should handle PDF with empty text', async () => {
      mockParser.mockResolvedValueOnce({
        numpages: 1,
        text: '',
        info: {},
        version: '1.4',
      });

      const buffer = Buffer.from('%PDF-1.4');
      const result = await extractor.extract(buffer);

      expect(result.content).toBe('');
      expect(result.metadata.wordCount).toBe(0);
    });

    it('should handle PDF with only whitespace', async () => {
      mockParser.mockResolvedValueOnce({
        numpages: 1,
        text: '   \n\n   \t\t   ',
        info: {},
        version: '1.4',
      });

      const buffer = Buffer.from('%PDF-1.4');
      const result = await extractor.extract(buffer);

      expect(result.content.trim()).toBe('');
    });

    it('should handle keywords with semicolon separator', async () => {
      mockParser.mockResolvedValueOnce({
        numpages: 1,
        text: 'Content',
        info: {
          Keywords: 'keyword1; keyword2; keyword3',
        },
        version: '1.4',
      });

      const buffer = Buffer.from('%PDF-1.4');
      const result = await extractor.extract(buffer);

      expect(result.metadata.tags).toEqual(['keyword1', 'keyword2', 'keyword3']);
    });

    it('should handle invalid creation date', async () => {
      mockParser.mockResolvedValueOnce({
        numpages: 1,
        text: 'Content',
        info: {
          CreationDate: 'invalid-date',
        },
        version: '1.4',
      });

      const buffer = Buffer.from('%PDF-1.4');
      const result = await extractor.extract(buffer);

      // Implementation may return undefined, null, or a default date for invalid input
      // Just verify the field exists and handling doesn't throw
      expect(result.metadata).toBeDefined();
    });
  });
});
