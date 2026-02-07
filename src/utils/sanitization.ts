/**
 * Sanitization Utilities for Supermemory Clone
 *
 * Provides XSS sanitization, HTML stripping, and content sanitization
 * for secure storage and display of user-provided content.
 *
 * Uses isomorphic-dompurify for cross-platform (Node.js/browser) XSS prevention.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
import DOMPurifyDefault from 'isomorphic-dompurify';

// Use the sanitize function directly to avoid type conflicts between dompurify versions
const sanitize = DOMPurifyDefault.sanitize.bind(DOMPurifyDefault);

// ============================================================================
// Configuration
// ============================================================================

/**
 * DOMPurify configuration type (subset of options we use)
 */
interface SanitizeConfig {
  ALLOWED_TAGS?: string[];
  ALLOWED_ATTR?: string[];
  ALLOW_DATA_ATTR?: boolean;
  FORBID_TAGS?: string[];
  FORBID_ATTR?: string[];
}

/**
 * Default DOMPurify configuration for general sanitization.
 * Allows common formatting tags but strips dangerous elements.
 */
const DEFAULT_SANITIZE_CONFIG: SanitizeConfig = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'strike',
    'sub',
    'sup',
    'blockquote',
    'code',
    'pre',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'a',
    'span',
    'div',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'id'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
};

/**
 * Strict sanitization configuration for storage.
 * Only allows basic text formatting, removes all potentially dangerous content.
 */
const STORAGE_SANITIZE_CONFIG: SanitizeConfig = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre', 'ul', 'ol', 'li'],
  ALLOWED_ATTR: [],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'a',
    'img',
  ],
  FORBID_ATTR: ['href', 'src', 'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
};

// ============================================================================
// Core Sanitization Functions
// ============================================================================

/**
 * Sanitizes HTML content by removing XSS vectors while preserving safe formatting.
 *
 * This function is suitable for content that will be displayed in HTML context.
 * It removes dangerous elements (script, iframe, etc.) and event handlers while
 * allowing common formatting tags.
 *
 * @param content - The HTML content to sanitize
 * @param config - Optional custom DOMPurify configuration
 * @returns Sanitized HTML string safe for rendering
 *
 * @example
 * ```typescript
 * const unsafe = '<script>alert("xss")</script><p>Hello <b>World</b></p>';
 * const safe = sanitizeHtml(unsafe);
 * // Returns: '<p>Hello <b>World</b></p>'
 * ```
 */
export function sanitizeHtml(content: string, config?: SanitizeConfig): string {
  if (!content || typeof content !== 'string') {
    return '';
  }

  return sanitize(content, config ?? DEFAULT_SANITIZE_CONFIG);
}

/**
 * Sanitizes content for safe storage in the database.
 *
 * Uses stricter sanitization rules suitable for long-term storage.
 * Removes all links, images, and potentially dangerous attributes while
 * preserving basic text formatting.
 *
 * @param content - The content to sanitize for storage
 * @returns Sanitized content safe for database storage
 *
 * @example
 * ```typescript
 * const input = '<a href="javascript:alert(1)">Click</a><p>Text</p>';
 * const safe = sanitizeForStorage(input);
 * // Returns: 'Click<p>Text</p>'
 * ```
 */
export function sanitizeForStorage(content: string): string {
  if (!content || typeof content !== 'string') {
    return '';
  }

  return sanitize(content, STORAGE_SANITIZE_CONFIG);
}

/**
 * Strips all HTML tags from content, returning plain text.
 *
 * Useful for creating search indexes, summaries, or text-only displays.
 * Preserves whitespace and line breaks where appropriate.
 *
 * @param content - The HTML content to strip
 * @returns Plain text with all HTML tags removed
 *
 * @example
 * ```typescript
 * const html = '<p>Hello <strong>World</strong>!</p>';
 * const text = stripHtml(html);
 * // Returns: 'Hello World!'
 * ```
 */
export function stripHtml(content: string): string {
  if (!content || typeof content !== 'string') {
    return '';
  }

  // First sanitize to remove any malicious content, then strip tags
  const sanitized = sanitize(content, { ALLOWED_TAGS: [] });

  // Decode any HTML entities that remain
  return decodeHtmlEntities(sanitized);
}

/**
 * Decodes common HTML entities to their text equivalents.
 *
 * @param text - Text with HTML entities
 * @returns Decoded text
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#039;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };

  let decoded = text;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }

  // Handle numeric entities
  decoded = decoded.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );

  return decoded;
}

// ============================================================================
// URL Sanitization
// ============================================================================

/**
 * Allowed URL protocols for links and resources.
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:'];

/**
 * Sanitizes a URL by validating the protocol and structure.
 *
 * Prevents javascript: URLs, data: URLs with executable content,
 * and other potentially dangerous URI schemes.
 *
 * @param url - The URL to sanitize
 * @returns Sanitized URL or empty string if invalid/dangerous
 *
 * @example
 * ```typescript
 * sanitizeUrl('https://example.com'); // Returns: 'https://example.com'
 * sanitizeUrl('javascript:alert(1)'); // Returns: ''
 * sanitizeUrl('data:text/html,...');  // Returns: ''
 * ```
 */
export function sanitizeUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    return '';
  }

  const trimmed = url.trim();

  // Check for empty URL
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);

    // Validate protocol
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      return '';
    }

    // Reconstruct the URL to normalize it
    return parsed.toString();
  } catch {
    // If URL parsing fails, it might be a relative URL - return as-is if safe
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
      // Relative URL starting with / - generally safe
      return trimmed;
    }

    return '';
  }
}

/**
 * Checks if a URL is safe for use (valid protocol, no XSS vectors).
 *
 * @param url - The URL to validate
 * @returns True if the URL is considered safe
 */
export function isUrlSafe(url: string): boolean {
  return sanitizeUrl(url) !== '' || url === '';
}

// ============================================================================
// Path Sanitization
// ============================================================================

/**
 * Dangerous path patterns that could enable path traversal attacks.
 */
const DANGEROUS_PATH_PATTERNS = [
  /\.\./g, // Parent directory traversal
  /^\//, // Absolute paths
  /^[a-zA-Z]:[\\/]/, // Windows absolute paths
  /\0/, // Null bytes
  /%2e%2e/gi, // URL-encoded ..
  /%252e%252e/gi, // Double URL-encoded ..
  /%c0%ae/gi, // UTF-8 encoded .
  /%c1%9c/gi, // UTF-8 encoded /
];

/**
 * Sanitizes a file path to prevent path traversal attacks.
 *
 * Removes parent directory references (..), absolute path prefixes,
 * and other potentially dangerous path components.
 *
 * @param path - The path to sanitize
 * @returns Sanitized relative path or null if path is deemed unsafe
 *
 * @example
 * ```typescript
 * sanitizePath('documents/file.txt');      // Returns: 'documents/file.txt'
 * sanitizePath('../etc/passwd');           // Returns: null
 * sanitizePath('/absolute/path');          // Returns: null
 * sanitizePath('docs/../secret');          // Returns: null
 * ```
 */
export function sanitizePath(path: string): string | null {
  if (!path || typeof path !== 'string') {
    return null;
  }

  const trimmed = path.trim();

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return null;
    }
  }

  // Additional validation: no control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return null;
  }

  // Normalize path separators
  const normalized = trimmed.replace(/\\/g, '/');

  // Split and filter path components
  const components = normalized.split('/').filter((component) => {
    // Remove empty components and single dots
    return component && component !== '.';
  });

  // Rejoin and return
  return components.join('/');
}

/**
 * Checks if a path is safe (no traversal attacks possible).
 *
 * @param path - The path to validate
 * @returns True if the path is considered safe
 */
export function isPathSafe(path: string): boolean {
  return sanitizePath(path) !== null;
}

// ============================================================================
// Content Type Detection
// ============================================================================

/**
 * Detects if content contains HTML that needs sanitization.
 *
 * @param content - The content to check
 * @returns True if content contains HTML tags
 */
export function containsHtml(content: string): boolean {
  if (!content || typeof content !== 'string') {
    return false;
  }

  // Check for HTML tags
  return /<[a-z][\s\S]*>/i.test(content);
}

/**
 * Detects if content contains potentially dangerous script content.
 *
 * @param content - The content to check
 * @returns True if content contains script-like patterns
 */
export function containsScript(content: string): boolean {
  if (!content || typeof content !== 'string') {
    return false;
  }

  const scriptPatterns = [
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi, // Event handlers like onclick=, onerror=
    /data:text\/html/gi,
    /vbscript:/gi,
  ];

  return scriptPatterns.some((pattern) => pattern.test(content));
}

// ============================================================================
// Markdown Sanitization
// ============================================================================

/**
 * Sanitizes Markdown content by escaping potentially dangerous patterns.
 *
 * Allows standard Markdown syntax while preventing injection attacks
 * through links or embedded HTML.
 *
 * @param markdown - The Markdown content to sanitize
 * @returns Sanitized Markdown content
 */
export function sanitizeMarkdown(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') {
    return '';
  }

  let sanitized = markdown;

  // Escape HTML tags that aren't part of standard Markdown
  sanitized = sanitized.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  sanitized = sanitized.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  sanitized = sanitized.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '');

  // Sanitize link URLs in Markdown [text](url) format
  sanitized = sanitized.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_, text, url) => {
    const safeUrl = sanitizeUrl(url);
    return safeUrl ? `[${text}](${safeUrl})` : text;
  });

  // Sanitize image URLs in Markdown ![alt](url) format
  sanitized = sanitized.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_, alt, url) => {
    const safeUrl = sanitizeUrl(url);
    return safeUrl ? `![${alt}](${safeUrl})` : alt;
  });

  return sanitized;
}

// ============================================================================
// JSON Sanitization
// ============================================================================

/**
 * Maximum depth for JSON object traversal to prevent DoS.
 */
const MAX_JSON_DEPTH = 10;

/**
 * Sanitizes a JSON object by removing potentially dangerous properties
 * and sanitizing string values.
 *
 * @param obj - The object to sanitize
 * @param depth - Current recursion depth (internal use)
 * @returns Sanitized object
 */
export function sanitizeJsonObject<T extends Record<string, unknown>>(obj: T, depth = 0): T {
  if (depth > MAX_JSON_DEPTH) {
    return {} as T;
  }

  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) =>
      typeof item === 'object' && item !== null
        ? sanitizeJsonObject(item as Record<string, unknown>, depth + 1)
        : typeof item === 'string'
          ? stripHtml(item)
          : item
    ) as unknown as T;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip prototype pollution vectors
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }

    if (typeof value === 'string') {
      // Sanitize string values
      result[key] = stripHtml(value);
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      result[key] = sanitizeJsonObject(value as Record<string, unknown>, depth + 1);
    } else {
      // Preserve other primitive values
      result[key] = value;
    }
  }

  return result as T;
}

// ============================================================================
// Export All Functions
// ============================================================================

export default {
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
};
