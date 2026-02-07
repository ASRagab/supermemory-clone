/**
 * PDF extractor - extracts text content from PDF files
 * Uses pdf-parse library for extraction
 */

import { ExtractionResult, ExtractorInterface, ContentType } from '../../types/document.types.js';
import { DependencyError } from '../../utils/errors.js';

// pdf-parse types (library doesn't have proper types)
interface PdfData {
  numpages: number;
  numrender: number;
  info: {
    Title?: string;
    Author?: string;
    Subject?: string;
    Keywords?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
  };
  metadata: unknown;
  text: string;
  version: string;
}

// Type for text content item from pdf.js
interface TextItem {
  str: string;
  dir?: string;
  width?: number;
  height?: number;
  transform?: number[];
  fontName?: string;
}

// Type for text content from getTextContent()
interface TextContent {
  items: TextItem[];
  styles?: Record<string, unknown>;
}

// Type for page data from pdf-parse pagerender callback
interface PageData {
  getTextContent(): Promise<TextContent>;
  pageNumber?: number;
}

interface PdfParseOptions {
  pagerender?: (pageData: unknown) => string;
  max?: number;
  version?: string;
}

type PdfParseFunction = (buffer: Buffer, options?: PdfParseOptions) => Promise<PdfData>;

// Dynamic import for pdf-parse
let pdfParse: PdfParseFunction | null = null;

async function loadPdfParse(): Promise<PdfParseFunction> {
  if (!pdfParse) {
    try {
      const module = await import('pdf-parse');
      pdfParse = module.default as PdfParseFunction;
    } catch {
      throw new DependencyError('pdf-parse', 'npm install pdf-parse');
    }
  }
  return pdfParse;
}

export class PdfExtractor implements ExtractorInterface {
  /**
   * Check if content is a PDF buffer or base64 encoded PDF
   */
  canHandle(content: string | Buffer): boolean {
    if (Buffer.isBuffer(content)) {
      // Check PDF magic bytes: %PDF
      return content.slice(0, 4).toString() === '%PDF';
    }

    if (typeof content === 'string') {
      // Check if it's base64 encoded PDF
      if (content.startsWith('data:application/pdf;base64,')) {
        return true;
      }

      // Check if it starts with PDF magic bytes
      if (content.startsWith('%PDF')) {
        return true;
      }

      // Try to detect base64 PDF without data URI prefix
      try {
        const decoded = Buffer.from(content.slice(0, 100), 'base64').toString();
        return decoded.startsWith('%PDF');
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Extract text content from PDF
   */
  async extract(
    content: string | Buffer,
    options?: Record<string, unknown>
  ): Promise<ExtractionResult> {
    const parse = await loadPdfParse();

    const buffer = this.toBuffer(content);
    const pdfData = await parse(buffer, {
      max: options?.maxPages as number | undefined,
    });

    const cleanedText = this.cleanPdfText(pdfData.text);
    const metadata = this.extractMetadata(pdfData, cleanedText);

    return {
      content: cleanedText,
      contentType: 'pdf' as ContentType,
      metadata,
      rawContent: pdfData.text,
    };
  }

  /**
   * Convert input to Buffer
   */
  private toBuffer(content: string | Buffer): Buffer {
    if (Buffer.isBuffer(content)) {
      return content;
    }

    // Handle data URI
    if (content.startsWith('data:application/pdf;base64,')) {
      const base64Data = content.replace('data:application/pdf;base64,', '');
      return Buffer.from(base64Data, 'base64');
    }

    // Try base64 decode
    try {
      const buffer = Buffer.from(content, 'base64');
      if (buffer.slice(0, 4).toString() === '%PDF') {
        return buffer;
      }
    } catch {
      // Not base64
    }

    // Assume raw PDF string
    return Buffer.from(content, 'binary');
  }

  /**
   * Clean extracted PDF text
   */
  private cleanPdfText(text: string): string {
    return (
      text
        // Fix common PDF extraction artifacts
        .replace(/\f/g, '\n\n') // Form feeds to paragraph breaks
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Remove excessive whitespace
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        // Fix hyphenation at line breaks
        .replace(/(\w)-\n(\w)/g, '$1$2')
        // Remove page numbers (common patterns)
        .replace(/^\s*\d+\s*$/gm, '')
        .replace(/\n\s*Page\s+\d+\s*\n/gi, '\n')
        // Trim lines
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim()
    );
  }

  /**
   * Extract metadata from PDF data
   */
  private extractMetadata(pdfData: PdfData, cleanedText: string): ExtractionResult['metadata'] {
    const words = cleanedText.split(/\s+/).filter((w) => w.length > 0);
    const info = pdfData.info ?? {};

    // Parse creation date if available
    let createdAt: string | undefined;
    if (info.CreationDate) {
      createdAt = this.parsePdfDate(info.CreationDate);
    }

    // Parse keywords into tags
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
      creator: info.Creator,
      producer: info.Producer,
      createdAt,
    };
  }

  /**
   * Parse PDF date format (D:YYYYMMDDHHmmSS)
   */
  private parsePdfDate(dateStr: string): string | undefined {
    try {
      // Remove D: prefix if present
      const clean = dateStr.replace(/^D:/, '');

      // Extract date components
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

  /**
   * Extract text from specific pages using pageData.getTextContent()
   */
  async extractPages(
    content: string | Buffer,
    startPage: number,
    endPage?: number
  ): Promise<string[]> {
    const parse = await loadPdfParse();

    const buffer = this.toBuffer(content);
    const pages: string[] = [];
    let currentPage = 0;

    // Custom page render function that extracts actual text content
    const pageRender = async (pageData: PageData): Promise<string> => {
      currentPage++;

      // Skip pages outside the requested range
      if (currentPage < startPage || (endPage && currentPage > endPage)) {
        return '';
      }

      try {
        // Use getTextContent to extract actual text from the page
        const textContent = await pageData.getTextContent();

        if (!textContent || !textContent.items) {
          pages.push('');
          return '';
        }

        // Combine all text items into a single string
        const pageText = textContent.items
          .map((item: TextItem) => {
            // Handle text items - they have a 'str' property
            if ('str' in item && typeof item.str === 'string') {
              return item.str;
            }
            return '';
          })
          .join('')
          .trim();

        pages.push(this.cleanPdfText(pageText));
        return pageText;
      } catch (error) {
        // If getTextContent fails, add empty string for this page
        console.warn(`Failed to extract text from page ${currentPage}:`, error);
        pages.push('');
        return '';
      }
    };

    await parse(buffer, {
      pagerender: pageRender as unknown as (pageData: unknown) => string,
    });

    return pages;
  }

  /**
   * Extract text from all pages with page boundaries preserved
   */
  async extractAllPages(content: string | Buffer): Promise<string[]> {
    const parse = await loadPdfParse();
    const buffer = this.toBuffer(content);

    // First pass to get page count
    const pdfData = await parse(buffer);
    const totalPages = pdfData.numpages;

    // Extract each page
    return this.extractPages(content, 1, totalPages);
  }
}
