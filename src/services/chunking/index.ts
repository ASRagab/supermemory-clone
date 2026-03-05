/**
 * Chunking Service
 *
 * Splits content into manageable chunks for embedding and indexing.
 * Supports multiple content types with specialized chunking strategies.
 */

export interface ChunkMetadata {
  position: number
  parentDocumentId: string
  contentType: 'markdown' | 'code' | 'text'
  language?: string // For code chunks
  heading?: string // For markdown chunks
  startOffset: number
  endOffset: number
}

export interface Chunk {
  content: string
  metadata: ChunkMetadata
  tokenCount: number
}

export interface ChunkingOptions {
  chunkSize?: number // Default: 512 tokens (~2048 characters)
  overlap?: number // Default: 50 tokens
  contentType?: 'markdown' | 'code' | 'text'
}

/**
 * Content type detection based on content analysis
 */
export function detectContentType(content: string): 'markdown' | 'code' | 'text' {
  // Markdown indicators
  const markdownPatterns = [
    /^#{1,6}\s+/m, // Headers
    /\[.*?\]\(.*?\)/, // Links
    /```[\s\S]*?```/, // Code blocks
    /^\*\s+/m, // Unordered lists
    /^\d+\.\s+/m, // Ordered lists
  ]

  const markdownScore = markdownPatterns.filter((pattern) => pattern.test(content)).length

  // Code indicators
  const codePatterns = [
    /^(import|export|from|require)\s+/m,
    /^(function|const|let|var|class|interface|type)\s+/m,
    /[{};()]/g,
    /^(public|private|protected|async|await)\s+/m,
  ]

  const codeScore = codePatterns.filter((pattern) => pattern.test(content)).length

  // Determine content type
  if (markdownScore >= 2) return 'markdown'
  if (codeScore >= 2) return 'code'
  return 'text'
}

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Semantic chunking: split by paragraphs and sections
 */
function chunkSemantic(content: string, parentDocumentId: string, chunkSize: number, overlap: number): Chunk[] {
  const chunks: Chunk[] = []
  const paragraphs = content.split(/\n\n+/)

  // If no paragraph breaks exist and content is large, use fixed chunking directly
  if (paragraphs.length === 1 && estimateTokens(content) > chunkSize) {
    return chunkFixed(content, parentDocumentId, chunkSize, overlap)
  }

  let currentChunk = ''
  let currentOffset = 0
  let position = 0

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]
    if (!paragraph) continue

    // If a single paragraph is too large, split it by words
    if (estimateTokens(paragraph) > chunkSize) {
      // First, save current chunk if exists
      if (currentChunk) {
        chunks.push({
          content: currentChunk,
          metadata: {
            position,
            parentDocumentId,
            contentType: 'text',
            startOffset: currentOffset,
            endOffset: currentOffset + currentChunk.length,
          },
          tokenCount: estimateTokens(currentChunk),
        })
        position++
        currentOffset += currentChunk.length
        currentChunk = ''
      }

      // Split large paragraph by words
      const words = paragraph.split(/\s+/)
      let wordChunk = ''
      let wordOffset = currentOffset

      for (const word of words) {
        const testChunk = wordChunk ? `${wordChunk} ${word}` : word
        if (estimateTokens(testChunk) <= chunkSize) {
          wordChunk = testChunk
        } else {
          if (wordChunk) {
            chunks.push({
              content: wordChunk,
              metadata: {
                position,
                parentDocumentId,
                contentType: 'text',
                startOffset: wordOffset,
                endOffset: wordOffset + wordChunk.length,
              },
              tokenCount: estimateTokens(wordChunk),
            })
            position++
            wordOffset += wordChunk.length + 1 // +1 for space
          }
          wordChunk = word
        }
      }

      if (wordChunk) {
        chunks.push({
          content: wordChunk,
          metadata: {
            position,
            parentDocumentId,
            contentType: 'text',
            startOffset: wordOffset,
            endOffset: wordOffset + wordChunk.length,
          },
          tokenCount: estimateTokens(wordChunk),
        })
        position++
      }

      currentOffset += paragraph.length
      continue
    }

    const combined = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph

    if (estimateTokens(combined) <= chunkSize) {
      currentChunk = combined
    } else {
      // Save current chunk
      const tokenCount = estimateTokens(currentChunk)
      chunks.push({
        content: currentChunk,
        metadata: {
          position,
          parentDocumentId,
          contentType: 'text',
          startOffset: currentOffset,
          endOffset: currentOffset + currentChunk.length,
        },
        tokenCount,
      })

      position++
      currentOffset += currentChunk.length

      // Start new chunk with overlap
      const overlapText = currentChunk.split(/\s+/).slice(-overlap).join(' ')
      currentChunk = overlapText ? `${overlapText}\n\n${paragraph}` : paragraph
    }
  }

  // Add final chunk
  if (currentChunk) {
    chunks.push({
      content: currentChunk,
      metadata: {
        position,
        parentDocumentId,
        contentType: 'text',
        startOffset: currentOffset,
        endOffset: currentOffset + currentChunk.length,
      },
      tokenCount: estimateTokens(currentChunk),
    })
  }

  return chunks
}

/**
 * Markdown chunking: split by heading hierarchy
 */
function chunkMarkdown(content: string, parentDocumentId: string, chunkSize: number, overlap: number): Chunk[] {
  const chunks: Chunk[] = []
  const sections: Array<{ heading: string; content: string; level: number }> = []

  // Split by headers
  const lines = content.split('\n')
  let currentSection = { heading: '', content: '', level: 0 }

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)

    if (headerMatch && headerMatch[1] && headerMatch[2]) {
      if (currentSection.content) {
        sections.push({ ...currentSection })
      }
      currentSection = {
        heading: headerMatch[2],
        content: line + '\n',
        level: headerMatch[1].length,
      }
    } else {
      currentSection.content += line + '\n'
    }
  }

  if (currentSection.content) {
    sections.push(currentSection)
  }

  // Convert sections to chunks
  let position = 0
  let currentOffset = 0

  for (const section of sections) {
    const tokenCount = estimateTokens(section.content)

    if (tokenCount <= chunkSize) {
      chunks.push({
        content: section.content.trim(),
        metadata: {
          position,
          parentDocumentId,
          contentType: 'markdown',
          heading: section.heading,
          startOffset: currentOffset,
          endOffset: currentOffset + section.content.length,
        },
        tokenCount,
      })
      position++
    } else {
      // Section too large, split further with semantic chunking
      const subChunks = chunkSemantic(section.content, parentDocumentId, chunkSize, overlap)
      for (const chunk of subChunks) {
        chunks.push({
          ...chunk,
          metadata: {
            ...chunk.metadata,
            contentType: 'markdown',
            heading: section.heading,
            position,
          },
        })
        position++
      }
    }

    currentOffset += section.content.length
  }

  return chunks
}

/**
 * Code chunking: AST-aware with scope preservation
 */
function chunkCode(content: string, parentDocumentId: string, chunkSize: number, overlap: number): Chunk[] {
  const chunks: Chunk[] = []

  // Detect language
  let language = 'unknown'
  if (content.includes('function') || content.includes('const')) language = 'javascript'
  if (content.includes('def ') || content.includes('import ')) language = 'python'
  if (content.includes('func ') || content.includes('package ')) language = 'go'

  // Split by function/class boundaries
  const codeBlocks: string[] = []
  const functionPattern = /^(function|const|let|var|class|def|func|export|public|private)\s+/gm
  const matches = [...content.matchAll(functionPattern)]

  if (matches.length === 0) {
    // No clear function boundaries, use semantic chunking
    return chunkSemantic(content, parentDocumentId, chunkSize, overlap)
  }

  let lastIndex = 0
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    if (!match) continue
    const startIndex = match.index || 0

    if (i > 0) {
      codeBlocks.push(content.substring(lastIndex, startIndex))
    }

    lastIndex = startIndex
  }
  codeBlocks.push(content.substring(lastIndex))

  // Convert blocks to chunks
  let position = 0
  let currentOffset = 0

  for (const block of codeBlocks) {
    if (!block.trim()) continue

    const tokenCount = estimateTokens(block)

    if (tokenCount <= chunkSize) {
      chunks.push({
        content: block.trim(),
        metadata: {
          position,
          parentDocumentId,
          contentType: 'code',
          language,
          startOffset: currentOffset,
          endOffset: currentOffset + block.length,
        },
        tokenCount,
      })
      position++
    } else {
      // Block too large, split by lines
      const lines = block.split('\n')
      let currentChunk = ''
      let chunkStart = currentOffset

      for (const line of lines) {
        const combined = currentChunk ? `${currentChunk}\n${line}` : line

        if (estimateTokens(combined) <= chunkSize) {
          currentChunk = combined
        } else {
          if (currentChunk) {
            chunks.push({
              content: currentChunk,
              metadata: {
                position,
                parentDocumentId,
                contentType: 'code',
                language,
                startOffset: chunkStart,
                endOffset: chunkStart + currentChunk.length,
              },
              tokenCount: estimateTokens(currentChunk),
            })
            position++
            chunkStart += currentChunk.length
          }
          currentChunk = line
        }
      }

      if (currentChunk) {
        chunks.push({
          content: currentChunk,
          metadata: {
            position,
            parentDocumentId,
            contentType: 'code',
            language,
            startOffset: chunkStart,
            endOffset: chunkStart + currentChunk.length,
          },
          tokenCount: estimateTokens(currentChunk),
        })
        position++
      }
    }

    currentOffset += block.length
  }

  return chunks
}

/**
 * Fixed-size chunking with overlap (fallback)
 */
function chunkFixed(content: string, parentDocumentId: string, chunkSize: number, overlap: number): Chunk[] {
  const chunks: Chunk[] = []
  const charSize = chunkSize * 4 // ~4 chars per token
  const overlapSize = overlap * 4

  let position = 0
  let offset = 0

  while (offset < content.length) {
    const end = Math.min(offset + charSize, content.length)
    const chunkText = content.substring(offset, end)

    chunks.push({
      content: chunkText,
      metadata: {
        position,
        parentDocumentId,
        contentType: 'text',
        startOffset: offset,
        endOffset: end,
      },
      tokenCount: estimateTokens(chunkText),
    })

    position++

    // Break if we've reached the end to avoid infinite loop
    if (end >= content.length) {
      break
    }

    // Move forward with overlap, ensuring we always advance
    const nextOffset = end - overlapSize
    offset = Math.max(nextOffset, offset + 1)
  }

  return chunks
}

/**
 * Main chunking function with strategy selection
 */
export function chunkContent(content: string, parentDocumentId: string, options: ChunkingOptions = {}): Chunk[] {
  const { chunkSize = 512, overlap = 50, contentType = detectContentType(content) } = options

  // Select strategy based on content type
  switch (contentType) {
    case 'markdown':
      return chunkMarkdown(content, parentDocumentId, chunkSize, overlap)
    case 'code':
      return chunkCode(content, parentDocumentId, chunkSize, overlap)
    case 'text':
      return chunkSemantic(content, parentDocumentId, chunkSize, overlap)
    default:
      return chunkFixed(content, parentDocumentId, chunkSize, overlap)
  }
}
