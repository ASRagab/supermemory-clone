/**
 * Smart chunking service - splits content into meaningful chunks
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Chunk,
  ChunkType,
  ChunkPosition,
  ChunkMetadata,
  ChunkingOptions,
  ContentType,
} from '../types/document.types.js';
import { MarkdownExtractor, MarkdownSection } from './extractors/markdown.extractor.js';
import { CodeExtractor, CodeBlock } from './extractors/code.extractor.js';

const DEFAULT_OPTIONS: Required<ChunkingOptions> = {
  maxChunkSize: 1500,
  minChunkSize: 100,
  overlap: 100,
  preserveStructure: true,
};

export class ChunkingService {
  private readonly markdownExtractor: MarkdownExtractor;
  private readonly codeExtractor: CodeExtractor;

  constructor() {
    this.markdownExtractor = new MarkdownExtractor();
    this.codeExtractor = new CodeExtractor();
  }

  /**
   * Chunk content based on type
   */
  chunk(
    documentId: string,
    content: string,
    contentType: ContentType,
    options?: ChunkingOptions
  ): Chunk[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    switch (contentType) {
      case 'markdown':
        return this.chunkByHeadings(documentId, content, opts);
      case 'code':
        return this.chunkByAST(documentId, content, opts);
      default:
        return this.chunkBySemanticSections(documentId, content, opts);
    }
  }

  /**
   * Chunk by semantic sections (paragraphs, logical breaks)
   */
  chunkBySemanticSections(documentId: string, text: string, options?: ChunkingOptions): Chunk[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const chunks: Chunk[] = [];

    // Split into paragraphs first
    const paragraphs = text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    let currentContent = '';
    let currentStart = 0;
    let chunkIndex = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i] ?? '';
      const testContent = currentContent ? `${currentContent}\n\n${paragraph}` : paragraph;

      if (testContent.length > opts.maxChunkSize && currentContent.length > 0) {
        // Current chunk is full, save it
        chunks.push(
          this.createChunk(
            documentId,
            currentContent,
            'paragraph',
            {
              index: chunkIndex,
              start: currentStart,
              end: currentStart + currentContent.length,
            },
            {}
          )
        );

        chunkIndex++;

        // Handle overlap by including end of previous chunk
        if (opts.overlap > 0 && currentContent.length > opts.overlap) {
          const overlapText = currentContent.slice(-opts.overlap);
          const previousContentLength = currentContent.length;
          currentContent = `${overlapText}\n\n${paragraph}`;
          currentStart = currentStart + previousContentLength - opts.overlap;
        } else {
          currentContent = paragraph;
          currentStart = this.findPosition(text, paragraph, currentStart);
        }
      } else {
        currentContent = testContent;
        if (i === 0) {
          currentStart = 0;
        }
      }
    }

    // Save remaining content
    if (currentContent.length >= opts.minChunkSize) {
      chunks.push(
        this.createChunk(
          documentId,
          currentContent,
          'paragraph',
          {
            index: chunkIndex,
            start: currentStart,
            end: currentStart + currentContent.length,
          },
          {}
        )
      );
    } else if (chunks.length > 0 && currentContent.length > 0) {
      // Merge with previous chunk if too small
      const lastChunk = chunks[chunks.length - 1];
      if (lastChunk) {
        lastChunk.content += `\n\n${currentContent}`;
        lastChunk.position.end += currentContent.length + 2;
        lastChunk.metadata.charCount = lastChunk.content.length;
        lastChunk.metadata.wordCount = lastChunk.content.split(/\s+/).length;
      }
    }

    return chunks;
  }

  /**
   * Chunk markdown by headings
   */
  chunkByHeadings(documentId: string, markdown: string, options?: ChunkingOptions): Chunk[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const sections = this.markdownExtractor.parseSections(markdown);
    const flatSections = this.markdownExtractor.flattenSections(sections);
    const chunks: Chunk[] = [];

    for (const section of flatSections) {
      const fullContent = section.heading
        ? `${'#'.repeat(section.level)} ${section.heading}\n\n${section.content}`
        : section.content;

      if (fullContent.length <= opts.maxChunkSize) {
        chunks.push(
          this.createChunk(
            documentId,
            fullContent,
            section.level > 0 ? 'heading' : 'section',
            {
              index: chunks.length,
              start: section.startLine,
              end: section.endLine,
              lineStart: section.startLine,
              lineEnd: section.endLine,
            },
            {
              headingLevel: section.level,
              headingText: section.heading,
            }
          )
        );
      } else {
        // Section too large, split by paragraphs with heading context
        const sectionChunks = this.splitLargeSection(documentId, section, opts, chunks.length);
        chunks.push(...sectionChunks);
      }
    }

    return chunks;
  }

  /**
   * Split a large section into smaller chunks
   */
  private splitLargeSection(
    documentId: string,
    section: MarkdownSection,
    options: Required<ChunkingOptions>,
    startIndex: number
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const headingPrefix = section.heading
      ? `${'#'.repeat(section.level)} ${section.heading}\n\n`
      : '';

    const paragraphs = section.content
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    let currentContent = headingPrefix;
    let chunkIndex = startIndex;

    for (const paragraph of paragraphs) {
      const testContent = currentContent + paragraph + '\n\n';

      if (testContent.length > options.maxChunkSize) {
        if (currentContent.length > headingPrefix.length) {
          chunks.push(
            this.createChunk(
              documentId,
              currentContent.trim(),
              'section',
              {
                index: chunkIndex,
                start: section.startLine,
                end: section.endLine,
                lineStart: section.startLine,
                lineEnd: section.endLine,
              },
              {
                headingLevel: section.level,
                headingText: section.heading,
              }
            )
          );
          chunkIndex++;
          currentContent = headingPrefix;
        }

        // If single paragraph is too large, split it
        if (paragraph.length > options.maxChunkSize) {
          const subChunks = this.splitLargeParagraph(
            documentId,
            paragraph,
            options,
            chunkIndex,
            section
          );
          chunks.push(...subChunks);
          chunkIndex += subChunks.length;
          continue;
        }
      }

      currentContent += paragraph + '\n\n';
    }

    // Save remaining content
    if (currentContent.length > headingPrefix.length) {
      chunks.push(
        this.createChunk(
          documentId,
          currentContent.trim(),
          'section',
          {
            index: chunkIndex,
            start: section.startLine,
            end: section.endLine,
          },
          {
            headingLevel: section.level,
            headingText: section.heading,
          }
        )
      );
    }

    return chunks;
  }

  /**
   * Split a large paragraph into sentence-based chunks
   */
  private splitLargeParagraph(
    documentId: string,
    paragraph: string,
    options: Required<ChunkingOptions>,
    startIndex: number,
    section?: MarkdownSection
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const sentences = this.splitIntoSentences(paragraph);

    let currentContent = '';
    let chunkIndex = startIndex;

    for (const sentence of sentences) {
      const testContent = currentContent + sentence + ' ';

      if (testContent.length > options.maxChunkSize && currentContent.length > 0) {
        chunks.push(
          this.createChunk(
            documentId,
            currentContent.trim(),
            'paragraph',
            {
              index: chunkIndex,
              start: 0,
              end: currentContent.length,
            },
            section
              ? {
                  headingLevel: section.level,
                  headingText: section.heading,
                }
              : {}
          )
        );
        chunkIndex++;

        // Add overlap
        if (options.overlap > 0) {
          const words = currentContent.split(' ');
          const overlapWords = Math.floor(options.overlap / 6); // Approx 6 chars per word
          currentContent = words.slice(-overlapWords).join(' ') + ' ' + sentence + ' ';
        } else {
          currentContent = sentence + ' ';
        }
      } else {
        currentContent = testContent;
      }
    }

    if (currentContent.trim().length > 0) {
      chunks.push(
        this.createChunk(
          documentId,
          currentContent.trim(),
          'paragraph',
          {
            index: chunkIndex,
            start: 0,
            end: currentContent.length,
          },
          {}
        )
      );
    }

    return chunks;
  }

  /**
   * Chunk code by AST structure
   */
  chunkByAST(
    documentId: string,
    code: string,
    options?: ChunkingOptions,
    language?: string
  ): Chunk[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const detectedLanguage = language ?? this.codeExtractor.detectLanguage(code);
    const codeBlocks = this.codeExtractor.parseCodeBlocks(code, detectedLanguage);
    const chunks: Chunk[] = [];

    // If no blocks detected, fall back to line-based chunking
    if (codeBlocks.length === 0) {
      return this.chunkByLines(documentId, code, opts, detectedLanguage);
    }

    // Group related blocks (imports, then definitions)
    const imports = codeBlocks.filter((b) => b.type === 'import');
    const definitions = codeBlocks.filter((b) => b.type !== 'import');

    // Create import chunk if there are imports
    if (imports.length > 0) {
      const firstImport = imports[0];
      const lastImport = imports[imports.length - 1];
      const importContent = imports.map((i) => i.content).join('\n');
      if (importContent.length <= opts.maxChunkSize && firstImport && lastImport) {
        chunks.push(
          this.createChunk(
            documentId,
            importContent,
            'code_block',
            {
              index: 0,
              start: firstImport.startLine,
              end: lastImport.endLine,
              lineStart: firstImport.startLine,
              lineEnd: lastImport.endLine,
            },
            {
              language: detectedLanguage,
            }
          )
        );
      }
    }

    // Create chunks for each code block
    for (const block of definitions) {
      const blockContent = block.docstring ? `${block.docstring}\n${block.content}` : block.content;

      if (blockContent.length <= opts.maxChunkSize) {
        chunks.push(this.createCodeBlockChunk(documentId, block, chunks.length));
      } else {
        // Large function/class - split by methods or logical sections
        const subChunks = this.splitLargeCodeBlock(documentId, block, opts, chunks.length);
        chunks.push(...subChunks);
      }
    }

    return chunks;
  }

  /**
   * Create a chunk from a code block
   */
  private createCodeBlockChunk(documentId: string, block: CodeBlock, index: number): Chunk {
    const content = block.docstring ? `${block.docstring}\n${block.content}` : block.content;

    const chunkType: ChunkType =
      block.type === 'class'
        ? 'class'
        : block.type === 'function' || block.type === 'method'
          ? 'function'
          : 'code_block';

    return this.createChunk(
      documentId,
      content,
      chunkType,
      {
        index,
        start: block.startLine,
        end: block.endLine,
        lineStart: block.startLine,
        lineEnd: block.endLine,
      },
      {
        language: block.language,
        functionName: block.type === 'function' || block.type === 'method' ? block.name : undefined,
        className: block.type === 'class' ? block.name : block.parent,
      }
    );
  }

  /**
   * Split large code block into smaller chunks
   */
  private splitLargeCodeBlock(
    documentId: string,
    block: CodeBlock,
    options: Required<ChunkingOptions>,
    startIndex: number
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const lines = block.content.split('\n');
    let currentContent = '';
    let currentStartLine = block.startLine;
    let chunkIndex = startIndex;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const testContent = currentContent + line + '\n';

      if (testContent.length > options.maxChunkSize && currentContent.length > 0) {
        chunks.push(
          this.createChunk(
            documentId,
            currentContent.trim(),
            'code_block',
            {
              index: chunkIndex,
              start: currentStartLine,
              end: block.startLine + i - 1,
              lineStart: currentStartLine,
              lineEnd: block.startLine + i - 1,
            },
            {
              language: block.language,
              className: block.type === 'class' ? block.name : block.parent,
              functionName:
                block.type === 'function' || block.type === 'method' ? block.name : undefined,
            }
          )
        );
        chunkIndex++;
        currentContent = line + '\n';
        currentStartLine = block.startLine + i;
      } else {
        currentContent = testContent;
      }
    }

    if (currentContent.trim().length > 0) {
      chunks.push(
        this.createChunk(
          documentId,
          currentContent.trim(),
          'code_block',
          {
            index: chunkIndex,
            start: currentStartLine,
            end: block.endLine,
            lineStart: currentStartLine,
            lineEnd: block.endLine,
          },
          {
            language: block.language,
            className: block.type === 'class' ? block.name : block.parent,
          }
        )
      );
    }

    return chunks;
  }

  /**
   * Fallback: chunk by lines
   */
  private chunkByLines(
    documentId: string,
    code: string,
    options: Required<ChunkingOptions>,
    language: string
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const lines = code.split('\n');
    let currentContent = '';
    let currentStartLine = 1;
    let chunkIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const testContent = currentContent + line + '\n';

      if (testContent.length > options.maxChunkSize && currentContent.length > 0) {
        chunks.push(
          this.createChunk(
            documentId,
            currentContent.trim(),
            'code_block',
            {
              index: chunkIndex,
              start: currentStartLine,
              end: i,
              lineStart: currentStartLine,
              lineEnd: i,
            },
            { language }
          )
        );
        chunkIndex++;
        currentContent = line + '\n';
        currentStartLine = i + 1;
      } else {
        currentContent = testContent;
      }
    }

    if (currentContent.trim().length > 0) {
      chunks.push(
        this.createChunk(
          documentId,
          currentContent.trim(),
          'code_block',
          {
            index: chunkIndex,
            start: currentStartLine,
            end: lines.length,
            lineStart: currentStartLine,
            lineEnd: lines.length,
          },
          { language }
        )
      );
    }

    return chunks;
  }

  /**
   * Create a chunk object
   */
  private createChunk(
    documentId: string,
    content: string,
    type: ChunkType,
    position: ChunkPosition,
    metadata: Partial<ChunkMetadata>
  ): Chunk {
    const words = content.split(/\s+/).filter((w) => w.length > 0);

    return {
      id: uuidv4(),
      documentId,
      content,
      type,
      position,
      metadata: {
        ...metadata,
        wordCount: words.length,
        charCount: content.length,
      },
    };
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    const sentenceEnders = /([.!?]+)\s+/g;
    const sentences: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = sentenceEnders.exec(text)) !== null) {
      const matchGroup = match[1] ?? '';
      const sentence = text.slice(lastIndex, match.index + matchGroup.length);
      if (sentence.trim().length > 0) {
        sentences.push(sentence.trim());
      }
      lastIndex = match.index + match[0].length;
    }

    const remaining = text.slice(lastIndex).trim();
    if (remaining.length > 0) {
      sentences.push(remaining);
    }

    return sentences;
  }

  /**
   * Find position of text in content
   */
  private findPosition(fullText: string, searchText: string, startFrom: number): number {
    const pos = fullText.indexOf(searchText, startFrom);
    return pos >= 0 ? pos : startFrom;
  }

  /**
   * Merge small chunks together
   */
  mergeSmallChunks(chunks: Chunk[], minSize: number = 100): Chunk[] {
    const merged: Chunk[] = [];

    for (const chunk of chunks) {
      if (merged.length === 0) {
        merged.push(chunk);
        continue;
      }

      const lastChunk = merged[merged.length - 1];
      if (!lastChunk) {
        merged.push(chunk);
        continue;
      }

      if (lastChunk.content.length < minSize || chunk.content.length < minSize) {
        // Merge with previous
        lastChunk.content += '\n\n' + chunk.content;
        lastChunk.position.end = chunk.position.end;
        lastChunk.metadata.charCount = lastChunk.content.length;
        lastChunk.metadata.wordCount = lastChunk.content.split(/\s+/).length;
      } else {
        merged.push(chunk);
      }
    }

    return merged;
  }
}
