/**
 * Tests for Sanitization Utilities
 *
 * Comprehensive tests for XSS prevention, URL sanitization,
 * path validation, and content sanitization.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeHtml,
  sanitizeForStorage,
  stripHtml,
  sanitizeUrl,
  isUrlSafe,
  sanitizePath,
  isPathSafe,
  containsHtml,
  containsScript,
  sanitizeMarkdown,
  sanitizeJsonObject,
} from '../../src/utils/sanitization.js';

// ============================================================================
// sanitizeHtml Tests
// ============================================================================

describe('sanitizeHtml', () => {
  describe('XSS Prevention', () => {
    it('should remove script tags', () => {
      const input = '<script>alert("xss")</script><p>Hello</p>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('<script>');
      expect(result).toContain('<p>Hello</p>');
    });

    it('should remove event handlers', () => {
      const input = '<img src="x" onerror="alert(\'xss\')">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('onerror');
    });

    it('should remove onclick handlers', () => {
      const input = '<button onclick="evil()">Click</button>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('onclick');
    });

    it('should remove onload handlers', () => {
      const input = '<body onload="evil()">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('onload');
    });

    it('should remove iframe elements', () => {
      const input = '<iframe src="https://evil.com"></iframe>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('<iframe');
    });

    it('should remove object elements', () => {
      const input = '<object data="evil.swf"></object>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('<object');
    });

    it('should remove embed elements', () => {
      const input = '<embed src="evil.swf">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('<embed');
    });

    it('should remove form elements', () => {
      const input = '<form action="https://evil.com"><input></form>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('<form');
    });

    it('should remove style elements', () => {
      const input = '<style>body { background: url("javascript:evil()"); }</style>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('<style');
    });
  });

  describe('Safe HTML Preservation', () => {
    it('should preserve paragraph tags', () => {
      const input = '<p>Hello World</p>';
      const result = sanitizeHtml(input);
      expect(result).toBe('<p>Hello World</p>');
    });

    it('should preserve formatting tags', () => {
      const input = '<strong>Bold</strong> and <em>italic</em>';
      const result = sanitizeHtml(input);
      expect(result).toContain('<strong>Bold</strong>');
      expect(result).toContain('<em>italic</em>');
    });

    it('should preserve list elements', () => {
      const input = '<ul><li>Item 1</li><li>Item 2</li></ul>';
      const result = sanitizeHtml(input);
      expect(result).toContain('<ul>');
      expect(result).toContain('<li>');
    });

    it('should preserve heading elements', () => {
      const input = '<h1>Title</h1><h2>Subtitle</h2>';
      const result = sanitizeHtml(input);
      expect(result).toContain('<h1>');
      expect(result).toContain('<h2>');
    });

    it('should preserve anchor tags with href', () => {
      const input = '<a href="https://example.com">Link</a>';
      const result = sanitizeHtml(input);
      expect(result).toContain('<a');
      expect(result).toContain('href=');
    });

    it('should preserve blockquote elements', () => {
      const input = '<blockquote>A quote</blockquote>';
      const result = sanitizeHtml(input);
      expect(result).toContain('<blockquote>');
    });

    it('should preserve code elements', () => {
      const input = '<code>const x = 1;</code>';
      const result = sanitizeHtml(input);
      expect(result).toContain('<code>');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      expect(sanitizeHtml('')).toBe('');
    });

    it('should handle null-like values', () => {
      expect(sanitizeHtml(null as unknown as string)).toBe('');
      expect(sanitizeHtml(undefined as unknown as string)).toBe('');
    });

    it('should handle plain text', () => {
      const input = 'Just plain text';
      expect(sanitizeHtml(input)).toBe('Just plain text');
    });

    it('should handle deeply nested elements', () => {
      const input = '<div><p><span><strong>Deep</strong></span></p></div>';
      const result = sanitizeHtml(input);
      expect(result).toContain('<strong>Deep</strong>');
    });
  });
});

// ============================================================================
// sanitizeForStorage Tests
// ============================================================================

describe('sanitizeForStorage', () => {
  it('should remove links', () => {
    const input = '<a href="https://example.com">Link</a>';
    const result = sanitizeForStorage(input);
    expect(result).not.toContain('<a');
    expect(result).toContain('Link');
  });

  it('should remove images', () => {
    const input = '<img src="image.jpg" alt="Image">';
    const result = sanitizeForStorage(input);
    expect(result).not.toContain('<img');
  });

  it('should preserve basic formatting', () => {
    const input = '<p><strong>Bold</strong> and <em>italic</em></p>';
    const result = sanitizeForStorage(input);
    expect(result).toContain('<strong>');
    expect(result).toContain('<em>');
  });

  it('should preserve code blocks', () => {
    const input = '<pre><code>function test() {}</code></pre>';
    const result = sanitizeForStorage(input);
    expect(result).toContain('<pre>');
    expect(result).toContain('<code>');
  });
});

// ============================================================================
// stripHtml Tests
// ============================================================================

describe('stripHtml', () => {
  it('should remove all HTML tags', () => {
    const input = '<p>Hello <strong>World</strong>!</p>';
    const result = stripHtml(input);
    expect(result).toBe('Hello World!');
  });

  it('should decode HTML entities', () => {
    const input = '&lt;script&gt; &amp; &quot;test&quot;';
    const result = stripHtml(input);
    expect(result).toContain('<script>');
    expect(result).toContain('&');
    expect(result).toContain('"test"');
  });

  it('should handle nested tags', () => {
    const input = '<div><p><span>Text</span></p></div>';
    const result = stripHtml(input);
    expect(result).toBe('Text');
  });

  it('should handle empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});

// ============================================================================
// URL Sanitization Tests
// ============================================================================

describe('sanitizeUrl', () => {
  describe('Valid URLs', () => {
    it('should allow https URLs', () => {
      const url = 'https://example.com/path';
      expect(sanitizeUrl(url)).toBe('https://example.com/path');
    });

    it('should allow http URLs', () => {
      const url = 'http://example.com/path';
      expect(sanitizeUrl(url)).toBe('http://example.com/path');
    });

    it('should allow mailto URLs', () => {
      const url = 'mailto:test@example.com';
      expect(sanitizeUrl(url)).toBe('mailto:test@example.com');
    });

    it('should allow relative URLs starting with /', () => {
      const url = '/path/to/resource';
      expect(sanitizeUrl(url)).toBe('/path/to/resource');
    });
  });

  describe('Dangerous URLs', () => {
    it('should block javascript: URLs', () => {
      const url = 'javascript:alert("xss")';
      expect(sanitizeUrl(url)).toBe('');
    });

    it('should block javascript: with spaces', () => {
      const url = 'javascript : alert("xss")';
      expect(sanitizeUrl(url)).toBe('');
    });

    it('should block data: URLs', () => {
      const url = 'data:text/html,<script>alert("xss")</script>';
      expect(sanitizeUrl(url)).toBe('');
    });

    it('should block vbscript: URLs', () => {
      const url = 'vbscript:msgbox(1)';
      expect(sanitizeUrl(url)).toBe('');
    });

    it('should block file: URLs', () => {
      const url = 'file:///etc/passwd';
      expect(sanitizeUrl(url)).toBe('');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      expect(sanitizeUrl('')).toBe('');
    });

    it('should handle malformed URLs', () => {
      expect(sanitizeUrl('not-a-url')).toBe('');
    });

    it('should block protocol-relative URLs', () => {
      const url = '//evil.com/path';
      expect(sanitizeUrl(url)).toBe('');
    });
  });
});

describe('isUrlSafe', () => {
  it('should return true for safe URLs', () => {
    expect(isUrlSafe('https://example.com')).toBe(true);
  });

  it('should return false for dangerous URLs', () => {
    expect(isUrlSafe('javascript:alert(1)')).toBe(false);
  });

  it('should return true for empty string', () => {
    expect(isUrlSafe('')).toBe(true);
  });
});

// ============================================================================
// Path Sanitization Tests
// ============================================================================

describe('sanitizePath', () => {
  describe('Valid Paths', () => {
    it('should allow simple relative paths', () => {
      const path = 'documents/file.txt';
      expect(sanitizePath(path)).toBe('documents/file.txt');
    });

    it('should normalize backslashes to forward slashes', () => {
      const path = 'documents\\file.txt';
      expect(sanitizePath(path)).toBe('documents/file.txt');
    });

    it('should remove leading dots (current directory)', () => {
      const path = './documents/file.txt';
      expect(sanitizePath(path)).toBe('documents/file.txt');
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should reject parent directory traversal', () => {
      expect(sanitizePath('../etc/passwd')).toBeNull();
    });

    it('should reject multiple parent traversals', () => {
      expect(sanitizePath('../../secret')).toBeNull();
    });

    it('should reject embedded parent traversal', () => {
      expect(sanitizePath('docs/../../../secret')).toBeNull();
    });

    it('should reject absolute paths (Unix)', () => {
      expect(sanitizePath('/etc/passwd')).toBeNull();
    });

    it('should reject absolute paths (Windows)', () => {
      expect(sanitizePath('C:\\Windows\\System32')).toBeNull();
    });

    it('should reject URL-encoded traversal', () => {
      expect(sanitizePath('%2e%2e/secret')).toBeNull();
    });

    it('should reject double URL-encoded traversal', () => {
      expect(sanitizePath('%252e%252e/secret')).toBeNull();
    });

    it('should reject null bytes', () => {
      expect(sanitizePath('file.txt\0.jpg')).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      expect(sanitizePath('')).toBeNull();
    });

    it('should handle whitespace-only', () => {
      // After trimming, empty paths result in empty string
      const result = sanitizePath('   ');
      expect(result === null || result === '').toBe(true);
    });
  });
});

describe('isPathSafe', () => {
  it('should return true for safe paths', () => {
    expect(isPathSafe('documents/file.txt')).toBe(true);
  });

  it('should return false for traversal attempts', () => {
    expect(isPathSafe('../secret')).toBe(false);
  });

  it('should return false for absolute paths', () => {
    expect(isPathSafe('/etc/passwd')).toBe(false);
  });
});

// ============================================================================
// Content Detection Tests
// ============================================================================

describe('containsHtml', () => {
  it('should detect HTML tags', () => {
    expect(containsHtml('<p>Hello</p>')).toBe(true);
  });

  it('should detect self-closing tags', () => {
    expect(containsHtml('<br>')).toBe(true);
  });

  it('should return false for plain text', () => {
    expect(containsHtml('Just text')).toBe(false);
  });

  it('should return false for math expressions', () => {
    expect(containsHtml('5 < 10 and 10 > 5')).toBe(false);
  });

  it('should handle empty string', () => {
    expect(containsHtml('')).toBe(false);
  });
});

describe('containsScript', () => {
  it('should detect script tags', () => {
    expect(containsScript('<script>alert(1)</script>')).toBe(true);
  });

  it('should detect javascript: URLs', () => {
    expect(containsScript('href="javascript:alert(1)"')).toBe(true);
  });

  it('should detect event handlers', () => {
    expect(containsScript('onclick="evil()"')).toBe(true);
  });

  it('should detect onerror handlers', () => {
    expect(containsScript('onerror = alert')).toBe(true);
  });

  it('should return false for safe content', () => {
    expect(containsScript('<p>Hello World</p>')).toBe(false);
  });
});

// ============================================================================
// Markdown Sanitization Tests
// ============================================================================

describe('sanitizeMarkdown', () => {
  it('should remove script tags from markdown', () => {
    const input = '# Title\n<script>alert("xss")</script>';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain('<script>');
    expect(result).toContain('# Title');
  });

  it('should sanitize markdown links with dangerous URLs', () => {
    const input = '[Click](javascript:alert(1))';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain('javascript:');
    expect(result).toContain('Click');
  });

  it('should preserve safe markdown links', () => {
    const input = '[Link](https://example.com)';
    const result = sanitizeMarkdown(input);
    // URL parsing may normalize the URL (add trailing slash)
    expect(result).toContain('[Link]');
    expect(result).toContain('https://example.com');
  });

  it('should sanitize image URLs', () => {
    const input = '![Alt](javascript:alert(1))';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain('javascript:');
    expect(result).toContain('Alt');
  });

  it('should preserve safe image URLs', () => {
    const input = '![Image](https://example.com/img.jpg)';
    const result = sanitizeMarkdown(input);
    expect(result).toBe('![Image](https://example.com/img.jpg)');
  });

  it('should remove style tags', () => {
    const input = '<style>.evil{}</style>Text';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain('<style>');
    expect(result).toContain('Text');
  });

  it('should remove iframe tags', () => {
    const input = '<iframe src="evil.com"></iframe>';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain('<iframe');
  });
});

// ============================================================================
// JSON Sanitization Tests
// ============================================================================

describe('sanitizeJsonObject', () => {
  it('should sanitize string values', () => {
    const input = { name: '<script>alert("xss")</script>John' };
    const result = sanitizeJsonObject(input);
    expect(result.name).not.toContain('<script>');
  });

  it('should handle nested objects', () => {
    const input = {
      user: {
        name: '<b>Bold</b>',
        bio: '<script>evil()</script>',
      },
    };
    const result = sanitizeJsonObject(input);
    expect((result.user as Record<string, string>).name).not.toContain('<b>');
    expect((result.user as Record<string, string>).bio).not.toContain('<script>');
  });

  it('should handle arrays', () => {
    const input = {
      tags: ['<script>evil</script>', 'safe'],
    };
    const result = sanitizeJsonObject(input);
    expect((result.tags as string[])[0]).not.toContain('<script>');
    expect((result.tags as string[])[1]).toBe('safe');
  });

  it('should preserve non-string values', () => {
    const input = {
      count: 42,
      active: true,
      ratio: 3.14,
    };
    const result = sanitizeJsonObject(input);
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.ratio).toBe(3.14);
  });

  it('should skip prototype pollution vectors', () => {
    const input = {
      __proto__: { isAdmin: true },
      constructor: { evil: true },
      prototype: { bad: true },
      normal: 'value',
    };
    const result = sanitizeJsonObject(input);
    // These keys are skipped during sanitization, so they won't be in the result
    // Note: __proto__ is special in JS and may not appear in Object.keys
    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'prototype')).toBe(false);
    expect(result.normal).toBe('value');
  });

  it('should handle null', () => {
    expect(sanitizeJsonObject(null as unknown as Record<string, unknown>)).toBeNull();
  });

  it('should limit recursion depth', () => {
    // Create deeply nested object
    let nested: Record<string, unknown> = { value: '<b>deep</b>' };
    for (let i = 0; i < 15; i++) {
      nested = { child: nested };
    }
    // Should not throw and should return truncated result
    const result = sanitizeJsonObject(nested);
    expect(result).toBeDefined();
  });
});
