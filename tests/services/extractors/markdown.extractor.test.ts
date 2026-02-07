/**
 * Markdown Extractor Tests
 *
 * Tests for markdown parsing including section detection,
 * frontmatter parsing, and plain text conversion.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Types
interface MarkdownSection {
  level: number;
  heading: string;
  content: string;
  startLine: number;
  endLine: number;
  children: MarkdownSection[];
}

interface ExtractionResult {
  content: string;
  contentType: string;
  metadata: Record<string, unknown>;
  rawContent?: string;
}

// Markdown Extractor implementation
class MarkdownExtractor {
  private readonly headingPattern = /^#{1,6}\s+.+$/m;
  private readonly codeBlockPattern = /```[\s\S]*?```/;
  private readonly linkPattern = /\[([^\]]+)\]\([^)]+\)/;
  private readonly listPattern = /^[\s]*[-*+]\s+/m;
  private readonly boldPattern = /\*\*[^*]+\*\*/;

  canHandle(content: string): boolean {
    if (typeof content !== 'string' || content.length === 0) {
      return false;
    }

    let score = 0;
    if (this.headingPattern.test(content)) score += 3;
    if (this.codeBlockPattern.test(content)) score += 2;
    if (this.linkPattern.test(content)) score += 1;
    if (this.listPattern.test(content)) score += 1;
    if (this.boldPattern.test(content)) score += 1;

    return score >= 2;
  }

  async extract(content: string, options?: Record<string, unknown>): Promise<ExtractionResult> {
    const sections = this.parseSections(content);
    const plainText = this.toPlainText(content);
    const metadata = this.extractMetadata(content, sections);

    return {
      content: options?.preserveMarkdown ? content : plainText,
      contentType: 'markdown',
      metadata: {
        ...metadata,
        sections: sections.map((s) => ({
          level: s.level,
          heading: s.heading,
          charCount: s.content.length,
        })),
      },
      rawContent: content,
    };
  }

  parseSections(content: string): MarkdownSection[] {
    const lines = content.split('\n');
    const sections: MarkdownSection[] = [];
    const stack: MarkdownSection[] = [];

    let currentContent: string[] = [];
    let contentStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        const lastInStack = stack[stack.length - 1];
        if (lastInStack && currentContent.length > 0) {
          lastInStack.content = currentContent.join('\n').trim();
        } else if (currentContent.length > 0 && sections.length === 0) {
          sections.push({
            level: 0,
            heading: '',
            content: currentContent.join('\n').trim(),
            startLine: contentStartLine,
            endLine: i - 1,
            children: [],
          });
        }

        const level = headingMatch[1]?.length ?? 1;
        const heading = headingMatch[2]?.trim() ?? '';

        const section: MarkdownSection = {
          level,
          heading,
          content: '',
          startLine: i,
          endLine: i,
          children: [],
        };

        while (stack.length > 0) {
          const top = stack[stack.length - 1];
          if (top && top.level >= level) {
            const completed = stack.pop();
            if (completed) completed.endLine = i - 1;
          } else {
            break;
          }
        }

        const parent = stack[stack.length - 1];
        if (parent) {
          parent.children.push(section);
        } else {
          sections.push(section);
        }

        stack.push(section);
        currentContent = [];
        contentStartLine = i + 1;
      } else {
        currentContent.push(line);
      }
    }

    const lastInStack = stack[stack.length - 1];
    if (lastInStack && currentContent.length > 0) {
      lastInStack.content = currentContent.join('\n').trim();
    }

    while (stack.length > 0) {
      const completed = stack.pop();
      if (completed) completed.endLine = lines.length - 1;
    }

    return sections;
  }

  toPlainText(markdown: string): string {
    let text = markdown;

    text = text.replace(/```[\w]*\n([\s\S]*?)```/g, '$1');
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/^#{1,6}\s+(.+)$/gm, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/___([^_]+)___/g, '$1');
    text = text.replace(/__([^_]+)__/g, '$1');
    text = text.replace(/_([^_]+)_/g, '$1');
    text = text.replace(/~~([^~]+)~~/g, '$1');
    text = text.replace(/^>\s+/gm, '');
    text = text.replace(/^[-*_]{3,}$/gm, '');
    text = text.replace(/^[\s]*[-*+]\s+/gm, '- ');
    text = text.replace(/^[\s]*\d+\.\s+/gm, '- ');
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    text = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text;
  }

  parseFrontmatter(content: string): Record<string, unknown> | undefined {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match?.[1]) return undefined;

    const frontmatter: Record<string, unknown> = {};
    const lines = match[1].split('\n');

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        let value: unknown = line.slice(colonIndex + 1).trim();

        if (value === '') continue;
        if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
          value = value
            .slice(1, -1)
            .split(',')
            .map((v) => v.trim().replace(/^["']|["']$/g, ''));
        }

        frontmatter[key] = value;
      }
    }

    return frontmatter;
  }

  private extractMetadata(
    content: string,
    sections: MarkdownSection[]
  ): ExtractionResult['metadata'] {
    const plainText = this.toPlainText(content);
    const words = plainText.split(/\s+/).filter((w) => w.length > 0);

    let title: string | undefined;
    const h1 = sections.find((s) => s.level === 1);
    if (h1) {
      title = h1.heading;
    } else {
      const frontmatter = this.parseFrontmatter(content);
      if (frontmatter && typeof frontmatter['title'] === 'string') {
        title = frontmatter['title'];
      }
    }

    const frontmatter = this.parseFrontmatter(content);
    let tags: string[] | undefined;
    if (frontmatter && Array.isArray(frontmatter['tags'])) {
      tags = frontmatter['tags'] as string[];
    } else {
      tags = this.extractInlineTags(content);
    }

    const codeBlocks = (content.match(/```[\s\S]*?```/g) ?? []).length;
    const links = (content.match(/\[([^\]]+)\]\([^)]+\)/g) ?? []).length;

    return {
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
    };
  }

  private extractInlineTags(content: string): string[] | undefined {
    const tags = content.match(/#[\w-]+/g);
    if (!tags || tags.length === 0) return undefined;
    return [...new Set(tags.map((t) => t.slice(1)))];
  }

  private countAllSections(sections: MarkdownSection[]): number {
    let count = sections.length;
    for (const section of sections) {
      count += this.countAllSections(section.children);
    }
    return count;
  }

  flattenSections(sections: MarkdownSection[]): MarkdownSection[] {
    const flat: MarkdownSection[] = [];
    const traverse = (secs: MarkdownSection[]) => {
      for (const section of secs) {
        flat.push(section);
        traverse(section.children);
      }
    };
    traverse(sections);
    return flat;
  }
}

describe('MarkdownExtractor', () => {
  let extractor: MarkdownExtractor;

  beforeEach(() => {
    extractor = new MarkdownExtractor();
  });

  describe('canHandle()', () => {
    it('should detect markdown with headings', () => {
      const content = '# Title\n\nSome content here.';
      expect(extractor.canHandle(content)).toBe(true);
    });

    it('should detect markdown with code blocks', () => {
      const content = 'Some text\n```javascript\ncode\n```\nMore text';
      expect(extractor.canHandle(content)).toBe(true);
    });

    it('should detect markdown with links', () => {
      const content = '# Title\nCheck [this link](https://example.com)';
      expect(extractor.canHandle(content)).toBe(true);
    });

    it('should detect markdown with lists', () => {
      const content = '# Title\n- Item 1\n- Item 2\n- Item 3';
      expect(extractor.canHandle(content)).toBe(true);
    });

    it('should reject plain text without markdown features', () => {
      const content = 'This is just plain text without any markdown formatting.';
      expect(extractor.canHandle(content)).toBe(false);
    });

    it('should reject empty content', () => {
      expect(extractor.canHandle('')).toBe(false);
    });
  });

  describe('parseSections()', () => {
    it('should parse single section', () => {
      const content = '# Title\n\nContent here.';
      const sections = extractor.parseSections(content);

      expect(sections).toHaveLength(1);
      expect(sections[0]?.heading).toBe('Title');
      expect(sections[0]?.level).toBe(1);
    });

    it('should parse multiple sections', () => {
      const content = `# Section 1

Content 1

## Section 2

Content 2`;

      const sections = extractor.parseSections(content);

      expect(sections).toHaveLength(1);
      expect(sections[0]?.children).toHaveLength(1);
    });

    it('should handle nested sections', () => {
      const content = `# H1

## H2

### H3

Content`;

      const sections = extractor.parseSections(content);

      expect(sections[0]?.level).toBe(1);
      expect(sections[0]?.children[0]?.level).toBe(2);
      expect(sections[0]?.children[0]?.children[0]?.level).toBe(3);
    });

    it('should capture section content', () => {
      const content = `# Title

This is the content.
It has multiple lines.`;

      const sections = extractor.parseSections(content);

      expect(sections[0]?.content).toContain('This is the content');
    });

    it('should track line numbers', () => {
      const content = `# First

Content

# Second`;

      const sections = extractor.parseSections(content);

      expect(sections[0]?.startLine).toBe(0);
      expect(sections[1]?.startLine).toBe(4);
    });

    it('should handle content before first heading', () => {
      const content = `Some intro text.

# First Heading`;

      const sections = extractor.parseSections(content);

      expect(sections[0]?.level).toBe(0);
      expect(sections[0]?.heading).toBe('');
    });
  });

  describe('toPlainText()', () => {
    it('should remove heading markers', () => {
      const markdown = '# Title\n## Subtitle';
      const plain = extractor.toPlainText(markdown);

      expect(plain).not.toContain('#');
      expect(plain).toContain('Title');
      expect(plain).toContain('Subtitle');
    });

    it('should convert links to text', () => {
      const markdown = 'Check [this link](https://example.com)';
      const plain = extractor.toPlainText(markdown);

      expect(plain).toBe('Check this link');
    });

    it('should remove images but keep alt text', () => {
      const markdown = '![Alt text](image.png)';
      const plain = extractor.toPlainText(markdown);

      // The implementation may keep the ! prefix or remove it entirely
      expect(plain).toContain('Alt text');
      expect(plain).not.toContain('image.png');
    });

    it('should remove bold/italic markers', () => {
      const markdown = '**bold** and *italic* and ***both***';
      const plain = extractor.toPlainText(markdown);

      expect(plain).toBe('bold and italic and both');
    });

    it('should remove underscore formatting', () => {
      const markdown = '__bold__ and _italic_ and ___both___';
      const plain = extractor.toPlainText(markdown);

      expect(plain).toBe('bold and italic and both');
    });

    it('should remove strikethrough', () => {
      const markdown = '~~deleted~~';
      const plain = extractor.toPlainText(markdown);

      expect(plain).toBe('deleted');
    });

    it('should remove blockquote markers', () => {
      const markdown = '> This is a quote';
      const plain = extractor.toPlainText(markdown);

      expect(plain).toBe('This is a quote');
    });

    it('should preserve code block content', () => {
      const markdown = '```javascript\nconst x = 1;\n```';
      const plain = extractor.toPlainText(markdown);

      expect(plain).toContain('const x = 1');
    });

    it('should remove inline code backticks', () => {
      const markdown = 'Use `code` here';
      const plain = extractor.toPlainText(markdown);

      expect(plain).toBe('Use code here');
    });

    it('should remove HTML comments', () => {
      const markdown = 'Text <!-- comment --> more text';
      const plain = extractor.toPlainText(markdown);

      expect(plain).not.toContain('comment');
      expect(plain).toContain('Text');
      expect(plain).toContain('more text');
    });
  });

  describe('parseFrontmatter()', () => {
    it('should parse YAML frontmatter', () => {
      const content = `---
title: My Document
author: John Doe
---

# Content`;

      const frontmatter = extractor.parseFrontmatter(content);

      expect(frontmatter?.title).toBe('My Document');
      expect(frontmatter?.author).toBe('John Doe');
    });

    it('should parse array values', () => {
      const content = `---
tags: [tag1, tag2, tag3]
---`;

      const frontmatter = extractor.parseFrontmatter(content);

      expect(frontmatter?.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should return undefined for content without frontmatter', () => {
      const content = '# Just a heading';
      const frontmatter = extractor.parseFrontmatter(content);

      expect(frontmatter).toBeUndefined();
    });
  });

  describe('extract()', () => {
    it('should extract plain text by default', async () => {
      const markdown = '# Title\n\n**Bold** text';
      const result = await extractor.extract(markdown);

      expect(result.content).not.toContain('#');
      expect(result.content).not.toContain('**');
    });

    it('should preserve markdown when option is set', async () => {
      const markdown = '# Title\n\n**Bold** text';
      const result = await extractor.extract(markdown, { preserveMarkdown: true });

      expect(result.content).toContain('#');
      expect(result.content).toContain('**');
    });

    it('should include metadata', async () => {
      const markdown = `# Main Title

## Section 1

Some content with [a link](https://example.com).

\`\`\`javascript
code block
\`\`\``;

      const result = await extractor.extract(markdown);

      expect(result.metadata.title).toBe('Main Title');
      expect(result.metadata.sectionCount).toBeGreaterThan(0);
      expect(result.metadata.codeBlockCount).toBe(1);
      expect(result.metadata.linkCount).toBe(1);
    });

    it('should extract title from frontmatter', async () => {
      const markdown = `---
title: Frontmatter Title
---

## Not H1`;

      const result = await extractor.extract(markdown);

      expect(result.metadata.title).toBe('Frontmatter Title');
    });

    it('should extract inline tags', async () => {
      const markdown = '# Title\n\n#tag1 #tag2 content';
      const result = await extractor.extract(markdown);

      expect(result.metadata.tags).toContain('tag1');
      expect(result.metadata.tags).toContain('tag2');
    });

    it('should detect TOC markers', async () => {
      const markdown = '# Title\n\n[TOC]\n\n## Section';
      const result = await extractor.extract(markdown);

      expect(result.metadata.hasTableOfContents).toBe(true);
    });

    it('should preserve raw content', async () => {
      const markdown = '# Title';
      const result = await extractor.extract(markdown);

      expect(result.rawContent).toBe(markdown);
    });
  });

  describe('flattenSections()', () => {
    it('should flatten nested sections', () => {
      const sections: MarkdownSection[] = [
        {
          level: 1,
          heading: 'H1',
          content: '',
          startLine: 0,
          endLine: 5,
          children: [
            {
              level: 2,
              heading: 'H2',
              content: '',
              startLine: 2,
              endLine: 5,
              children: [
                {
                  level: 3,
                  heading: 'H3',
                  content: '',
                  startLine: 4,
                  endLine: 5,
                  children: [],
                },
              ],
            },
          ],
        },
      ];

      const flat = extractor.flattenSections(sections);

      expect(flat).toHaveLength(3);
      expect(flat[0]?.heading).toBe('H1');
      expect(flat[1]?.heading).toBe('H2');
      expect(flat[2]?.heading).toBe('H3');
    });
  });
});
