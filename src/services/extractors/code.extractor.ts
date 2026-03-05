/**
 * Code extractor - AST-aware extraction and chunking for source code
 */

import { ExtractionResult, ExtractorInterface, ContentType } from '../../types/document.types.js'

export interface CodeBlock {
  type: 'function' | 'class' | 'method' | 'interface' | 'type' | 'import' | 'export' | 'comment' | 'other'
  name: string
  content: string
  startLine: number
  endLine: number
  language: string
  parent?: string
  docstring?: string
}

interface LanguagePattern {
  extensions: string[]
  functionPattern: RegExp
  classPattern: RegExp
  methodPattern?: RegExp
  interfacePattern?: RegExp
  typePattern?: RegExp
  importPattern: RegExp
  commentPattern: RegExp
  docstringPattern?: RegExp
}

export class CodeExtractor implements ExtractorInterface {
  /**
   * Core language patterns - supports TypeScript, JavaScript, Python, and Go
   * Other languages can be added as needed based on usage patterns
   */
  private readonly languages: Record<string, LanguagePattern> = {
    typescript: {
      extensions: ['.ts', '.tsx'],
      functionPattern: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m,
      classPattern: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m,
      methodPattern: /^\s+(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\S+)?\s*\{/m,
      interfacePattern: /^(?:export\s+)?interface\s+(\w+)/m,
      typePattern: /^(?:export\s+)?type\s+(\w+)/m,
      importPattern: /^import\s+.*from\s+['"](.+)['"]/m,
      commentPattern: /\/\/.*$|\/\*[\s\S]*?\*\//,
      docstringPattern: /\/\*\*[\s\S]*?\*\//,
    },
    javascript: {
      extensions: ['.js', '.jsx', '.mjs', '.cjs'],
      functionPattern: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m,
      classPattern: /^(?:export\s+)?class\s+(\w+)/m,
      methodPattern: /^\s+(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*\{/m,
      importPattern: /^(?:import\s+.*from\s+['"](.+)['"]|require\(['"](.+)['"]\))/m,
      commentPattern: /\/\/.*$|\/\*[\s\S]*?\*\//,
      docstringPattern: /\/\*\*[\s\S]*?\*\//,
    },
    python: {
      extensions: ['.py', '.pyw'],
      functionPattern: /^(?:async\s+)?def\s+(\w+)/m,
      classPattern: /^class\s+(\w+)/m,
      methodPattern: /^\s+(?:async\s+)?def\s+(\w+)/m,
      importPattern: /^(?:from\s+(\S+)\s+)?import\s+/m,
      commentPattern: /#.*$/,
      docstringPattern: /"""[\s\S]*?"""|'''[\s\S]*?'''/,
    },
    go: {
      extensions: ['.go'],
      functionPattern: /^func\s+(\w+)/m,
      classPattern: /^type\s+(\w+)\s+struct/m,
      methodPattern: /^func\s+\([^)]+\)\s+(\w+)/m,
      interfacePattern: /^type\s+(\w+)\s+interface/m,
      importPattern: /^import\s+(?:\(\s*)?["']([^"']+)["']/m,
      commentPattern: /\/\/.*$|\/\*[\s\S]*?\*\//,
    },
  }

  /**
   * Check if content appears to be source code
   */
  canHandle(content: string): boolean {
    if (typeof content !== 'string' || content.length === 0) {
      return false
    }

    // Check for common code patterns (focusing on core languages)
    const codePatterns = [
      /^import\s+/m, // JS/TS/Python/Go
      /^export\s+/m, // JS/TS
      /^(?:const|let|var)\s+\w+\s*=/m, // JS/TS
      /^function\s+\w+/m, // JS/TS
      /^class\s+\w+/m, // JS/TS/Python
      /^def\s+\w+/m, // Python
      /^func\s+\w+/m, // Go
      /^package\s+\w+/m, // Go
      /:\s*(?:string|number|boolean)/m, // TS
      /^\s+self\./m, // Python
      /:\s*=\s*/, // Go
      /^(?:async\s+)?function\s+/m, // JS/TS
      /=>\s*\{/, // JS/TS arrow functions
    ]

    let score = 0
    for (const pattern of codePatterns) {
      if (pattern.test(content)) score++
    }

    // Check bracket/brace balance (code usually has balanced braces)
    const openBraces = (content.match(/\{/g) ?? []).length
    const closeBraces = (content.match(/\}/g) ?? []).length
    if (openBraces > 0 && Math.abs(openBraces - closeBraces) < openBraces * 0.1) {
      score++
    }

    return score >= 2
  }

  /**
   * Extract code content with AST-aware parsing
   */
  async extract(content: string, options?: Record<string, unknown>): Promise<ExtractionResult> {
    const language = (options?.language as string) ?? this.detectLanguage(content)
    const blocks = this.parseCodeBlocks(content, language)
    const metadata = this.extractMetadata(content, blocks, language)

    return {
      content,
      contentType: 'code' as ContentType,
      metadata: {
        ...metadata,
        codeBlocks: blocks.map((b) => ({
          type: b.type,
          name: b.name,
          startLine: b.startLine,
          endLine: b.endLine,
        })),
      },
      rawContent: content,
    }
  }

  /**
   * Detect programming language from content - supports TypeScript, JavaScript, Python, and Go
   */
  detectLanguage(content: string): string {
    // TypeScript indicators (check first since it's a superset of JavaScript)
    if (
      /:\s*(?:string|number|boolean|void|any|unknown|never)\b/.test(content) ||
      /interface\s+\w+/.test(content) ||
      /<\w+>.*>/.test(content) ||
      /as\s+(?:string|number|boolean)/.test(content)
    ) {
      return 'typescript'
    }

    // Python indicators
    if (/^def\s+\w+.*:\s*$/m.test(content) || /^class\s+\w+.*:\s*$/m.test(content) || /^\s+self\./m.test(content)) {
      return 'python'
    }

    // Go indicators
    if (/^package\s+\w+/m.test(content) || /^func\s+\([^)]+\)/.test(content) || /:=/.test(content)) {
      return 'go'
    }

    // Default to JavaScript
    return 'javascript'
  }

  /**
   * Parse code into logical blocks
   */
  parseCodeBlocks(content: string, language: string): CodeBlock[] {
    const blocks: CodeBlock[] = []
    const lines = content.split('\n')
    const pattern = this.languages[language] ?? this.languages['javascript']
    if (!pattern) {
      return blocks
    }

    let currentClass: string | undefined
    let i = 0

    while (i < lines.length) {
      const line = lines[i] ?? ''
      const remainingContent = lines.slice(i).join('\n')

      // Check for imports
      const importMatch = line.match(pattern.importPattern)
      if (importMatch) {
        blocks.push({
          type: 'import',
          name: importMatch[1] ?? importMatch[2] ?? 'import',
          content: line,
          startLine: i + 1,
          endLine: i + 1,
          language,
        })
        i++
        continue
      }

      // Check for docstrings/comments before definitions
      let docstring: string | undefined
      if (pattern.docstringPattern) {
        const docMatch = remainingContent.match(pattern.docstringPattern)
        if (docMatch && docMatch[0] && remainingContent.indexOf(docMatch[0]) === 0) {
          docstring = docMatch[0]
        }
      }

      // Check for class definitions
      const classMatch = line.match(pattern.classPattern)
      if (classMatch && classMatch[1]) {
        const block = this.extractBlock(lines, i, language)
        blocks.push({
          type: 'class',
          name: classMatch[1],
          content: block.content,
          startLine: i + 1,
          endLine: block.endLine + 1,
          language,
          docstring,
        })
        currentClass = classMatch[1]
        i = block.endLine + 1
        continue
      }

      // Check for interface definitions (TypeScript/Java/Go)
      if (pattern.interfacePattern) {
        const interfaceMatch = line.match(pattern.interfacePattern)
        if (interfaceMatch && interfaceMatch[1]) {
          const block = this.extractBlock(lines, i, language)
          blocks.push({
            type: 'interface',
            name: interfaceMatch[1],
            content: block.content,
            startLine: i + 1,
            endLine: block.endLine + 1,
            language,
            docstring,
          })
          i = block.endLine + 1
          continue
        }
      }

      // Check for type definitions
      if (pattern.typePattern) {
        const typeMatch = line.match(pattern.typePattern)
        if (typeMatch && typeMatch[1]) {
          const block = this.extractBlock(lines, i, language)
          blocks.push({
            type: 'type',
            name: typeMatch[1],
            content: block.content,
            startLine: i + 1,
            endLine: block.endLine + 1,
            language,
            docstring,
          })
          i = block.endLine + 1
          continue
        }
      }

      // Check for method definitions (inside class)
      if (pattern.methodPattern && currentClass) {
        const methodMatch = line.match(pattern.methodPattern)
        if (methodMatch && methodMatch[1] && (line.startsWith(' ') || line.startsWith('\t'))) {
          const block = this.extractBlock(lines, i, language)
          blocks.push({
            type: 'method',
            name: methodMatch[1],
            content: block.content,
            startLine: i + 1,
            endLine: block.endLine + 1,
            language,
            parent: currentClass,
            docstring,
          })
          i = block.endLine + 1
          continue
        }
      }

      // Check for function definitions
      const functionMatch = line.match(pattern.functionPattern)
      if (functionMatch && functionMatch[1]) {
        const block = this.extractBlock(lines, i, language)
        blocks.push({
          type: 'function',
          name: functionMatch[1],
          content: block.content,
          startLine: i + 1,
          endLine: block.endLine + 1,
          language,
          docstring,
        })
        currentClass = undefined
        i = block.endLine + 1
        continue
      }

      // Check for arrow functions and const declarations
      const arrowMatch = line.match(/^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/)
      if (arrowMatch && arrowMatch[1]) {
        const block = this.extractBlock(lines, i, language)
        blocks.push({
          type: 'function',
          name: arrowMatch[1],
          content: block.content,
          startLine: i + 1,
          endLine: block.endLine + 1,
          language,
          docstring,
        })
        i = block.endLine + 1
        continue
      }

      i++
    }

    return blocks
  }

  /**
   * Extract a complete code block (handles brace matching)
   */
  private extractBlock(lines: string[], startIndex: number, language: string): { content: string; endLine: number } {
    const isPython = language === 'python'

    if (isPython) {
      return this.extractPythonBlock(lines, startIndex)
    }

    // Brace-based languages
    let braceCount = 0
    let started = false
    let endIndex = startIndex

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i] ?? ''

      for (const char of line) {
        if (char === '{') {
          braceCount++
          started = true
        } else if (char === '}') {
          braceCount--
        }
      }

      endIndex = i

      if (started && braceCount === 0) {
        break
      }
    }

    const content = lines.slice(startIndex, endIndex + 1).join('\n')
    return { content, endLine: endIndex }
  }

  /**
   * Extract Python block (indentation-based)
   */
  private extractPythonBlock(lines: string[], startIndex: number): { content: string; endLine: number } {
    const startLine = lines[startIndex] ?? ''
    const baseIndent = startLine.match(/^(\s*)/)?.[1]?.length ?? 0
    let endIndex = startIndex

    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i] ?? ''

      // Skip empty lines
      if (line.trim() === '') {
        endIndex = i
        continue
      }

      const currentIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0

      // Block ends when we return to same or less indentation
      if (currentIndent <= baseIndent && line.trim() !== '') {
        break
      }

      endIndex = i
    }

    const content = lines.slice(startIndex, endIndex + 1).join('\n')
    return { content, endLine: endIndex }
  }

  /**
   * Extract metadata from code content
   */
  private extractMetadata(content: string, blocks: CodeBlock[], language: string): ExtractionResult['metadata'] {
    const lines = content.split('\n')
    const words = content.split(/\s+/).filter((w) => w.length > 0)

    const functions = blocks.filter((b) => b.type === 'function')
    const classes = blocks.filter((b) => b.type === 'class')
    const interfaces = blocks.filter((b) => b.type === 'interface')
    const imports = blocks.filter((b) => b.type === 'import')

    // Detect test file (check for common test patterns in content)
    const isTestFile =
      /describe\s*\(|it\s*\(|test\s*\(/.test(content) ||
      /def\s+test_/.test(content) ||
      /#\[test\]/.test(content) ||
      /assert\s*\(|expect\s*\(/.test(content)

    return {
      source: 'code',
      language,
      mimeType: this.getMimeType(language),
      wordCount: words.length,
      charCount: content.length,
      lineCount: lines.length,
      functionCount: functions.length,
      classCount: classes.length,
      interfaceCount: interfaces.length,
      importCount: imports.length,
      isTestFile,
      hasDocstrings: blocks.some((b) => b.docstring),
    }
  }

  /**
   * Get MIME type for language - supports TypeScript, JavaScript, Python, and Go
   */
  private getMimeType(language: string): string {
    const mimeTypes: Record<string, string> = {
      typescript: 'text/typescript',
      javascript: 'text/javascript',
      python: 'text/x-python',
      go: 'text/x-go',
    }

    return mimeTypes[language] ?? 'text/plain'
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages(): string[] {
    return Object.keys(this.languages)
  }
}
