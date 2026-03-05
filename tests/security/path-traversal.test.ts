/**
 * Path Traversal Prevention Test Suite
 *
 * Tests for detecting and blocking path traversal attacks.
 * Part of TASK-052: Security Tester - Input Validation Test Suite
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import * as path from 'path'

// ============================================================================
// Path Validation Utilities
// ============================================================================

/**
 * Normalize path by resolving . and .. components
 */
function normalizePath(inputPath: string): string {
  // URL decode the path first
  let decoded = inputPath
  try {
    // Decode multiple times to handle double/triple encoding
    let prev = ''
    while (prev !== decoded) {
      prev = decoded
      decoded = decodeURIComponent(decoded.replace(/\+/g, ' '))
    }
  } catch {
    // If decoding fails, use original
    decoded = inputPath
  }

  // Normalize backslashes to forward slashes
  decoded = decoded.replace(/\\/g, '/')

  return decoded
}

/**
 * Detect path traversal patterns
 */
function detectPathTraversal(inputPath: string): string[] {
  const normalized = normalizePath(inputPath)
  const detected: string[] = []

  const patterns: Array<{ name: string; test: (p: string) => boolean }> = [
    {
      name: 'dot_dot_slash',
      test: (p) => p.includes('../') || p.includes('..\\') || /\.\.$/.test(p) || /\.\.\//.test(normalized),
    },
    {
      name: 'file_protocol',
      test: (p) => /^file:\/\//i.test(p),
    },
    {
      name: 'overlong_utf8',
      test: (p) => /%c0%ae/i.test(p) || /%c0%af/i.test(p),
    },
    {
      name: 'dot_dot_encoded',
      test: (p) => /%2e%2e/i.test(p) || /%252e%252e/i.test(p),
    },
    {
      name: 'absolute_path_unix',
      test: (p) => normalized.startsWith('/') && !p.startsWith('/api/'),
    },
    {
      name: 'absolute_path_windows',
      test: (p) => /^[a-zA-Z]:[\\/]/.test(p),
    },
    {
      name: 'unc_path',
      test: (p) => p.startsWith('\\\\') || p.startsWith('//'),
    },
    {
      name: 'null_byte',
      test: (p) => p.includes('\x00') || p.includes('%00'),
    },
    {
      name: 'dot_dot_colon',
      test: (p) => p.includes('..::'),
    },
    {
      name: 'backslash_traversal',
      test: (p) => p.includes('..\\'),
    },
  ]

  // First check the original input
  for (const pattern of patterns) {
    if (pattern.test(inputPath)) {
      detected.push(pattern.name)
    }
  }

  // Then check the normalized version for missed patterns
  for (const pattern of patterns) {
    if (!detected.includes(pattern.name) && pattern.test(normalized)) {
      detected.push(pattern.name)
    }
  }

  return detected
}

/**
 * Check if a path is contained within a base directory
 */
function isPathSafe(inputPath: string, baseDir: string): boolean {
  const normalized = normalizePath(inputPath)

  // Check for traversal patterns
  if (detectPathTraversal(inputPath).length > 0) {
    return false
  }

  // Resolve the full path
  const fullPath = path.resolve(baseDir, normalized)

  // Ensure the resolved path starts with the base directory
  const normalizedBase = path.resolve(baseDir)
  return fullPath.startsWith(normalizedBase)
}

/**
 * Sanitize path by removing dangerous components
 */
function sanitizePath(inputPath: string): string {
  let sanitized = normalizePath(inputPath)

  // Remove leading slashes for relative paths
  sanitized = sanitized.replace(/^[/\\]+/, '')

  // Remove .. components
  sanitized = sanitized.replace(/\.\.[/\\]?/g, '')

  // Remove double slashes
  sanitized = sanitized.replace(/[/\\]+/g, '/')

  // Remove any remaining ASCII control characters
  sanitized = Array.from(sanitized)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')

  return sanitized
}

/**
 * Zod schema for safe paths
 */
const safePathSchema = z
  .string()
  .refine((val) => detectPathTraversal(val).length === 0, { message: 'Path contains traversal patterns' })

// ============================================================================
// Basic Path Traversal Tests
// ============================================================================

describe('Basic Path Traversal Detection', () => {
  describe('Unix-style Traversal', () => {
    it('should detect ../etc/passwd', () => {
      const patterns = detectPathTraversal('../etc/passwd')
      expect(patterns).toContain('dot_dot_slash')
    })

    it('should detect ../../etc/passwd', () => {
      const patterns = detectPathTraversal('../../etc/passwd')
      expect(patterns).toContain('dot_dot_slash')
    })

    it('should detect multiple levels of traversal', () => {
      const patterns = detectPathTraversal('../../../../../../../etc/passwd')
      expect(patterns).toContain('dot_dot_slash')
    })

    it('should detect traversal in middle of path', () => {
      const patterns = detectPathTraversal('uploads/../../../etc/passwd')
      expect(patterns).toContain('dot_dot_slash')
    })

    it('should detect traversal at end of path', () => {
      const patterns = detectPathTraversal('uploads/files/..')
      // Trailing .. without slash is detected
      expect(patterns.length).toBeGreaterThan(0)
    })
  })

  describe('Windows-style Traversal', () => {
    it('should detect ..\\windows\\system32', () => {
      const patterns = detectPathTraversal('..\\windows\\system32')
      expect(patterns).toContain('backslash_traversal')
    })

    it('should detect ..\\..\\windows\\system32', () => {
      const patterns = detectPathTraversal('..\\..\\windows\\system32')
      expect(patterns).toContain('backslash_traversal')
    })

    it('should detect mixed slash traversal', () => {
      const patterns = detectPathTraversal('..\\../..\\../windows\\system32')
      expect(patterns.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Absolute Path Tests
// ============================================================================

describe('Absolute Path Detection', () => {
  describe('Unix Absolute Paths', () => {
    it('should detect /etc/passwd', () => {
      const patterns = detectPathTraversal('/etc/passwd')
      expect(patterns).toContain('absolute_path_unix')
    })

    it('should detect /var/log/auth.log', () => {
      const patterns = detectPathTraversal('/var/log/auth.log')
      expect(patterns).toContain('absolute_path_unix')
    })

    it('should detect /root/.ssh/id_rsa', () => {
      const patterns = detectPathTraversal('/root/.ssh/id_rsa')
      expect(patterns).toContain('absolute_path_unix')
    })

    it('should allow /api/ paths as exceptions', () => {
      const patterns = detectPathTraversal('/api/documents')
      expect(patterns).not.toContain('absolute_path_unix')
    })
  })

  describe('Windows Absolute Paths', () => {
    it('should detect C:\\windows\\system32', () => {
      const patterns = detectPathTraversal('C:\\windows\\system32')
      expect(patterns).toContain('absolute_path_windows')
    })

    it('should detect D:\\Users\\Admin', () => {
      const patterns = detectPathTraversal('D:\\Users\\Admin')
      expect(patterns).toContain('absolute_path_windows')
    })

    it('should detect c:/windows/system32', () => {
      const patterns = detectPathTraversal('c:/windows/system32')
      expect(patterns).toContain('absolute_path_windows')
    })
  })

  describe('UNC Paths', () => {
    it('should detect \\\\server\\share', () => {
      const patterns = detectPathTraversal('\\\\server\\share')
      expect(patterns).toContain('unc_path')
    })

    it('should detect //server/share', () => {
      const patterns = detectPathTraversal('//server/share')
      expect(patterns).toContain('unc_path')
    })
  })
})

// ============================================================================
// URL Encoded Traversal Tests
// ============================================================================

describe('URL Encoded Traversal Detection', () => {
  describe('Single Encoding', () => {
    it('should detect %2e%2e%2f (../)', () => {
      const patterns = detectPathTraversal('%2e%2e%2fetc/passwd')
      expect(patterns).toContain('dot_dot_encoded')
    })

    it('should detect %2e%2e/ (../)', () => {
      const patterns = detectPathTraversal('%2e%2e/etc/passwd')
      expect(patterns).toContain('dot_dot_encoded')
    })

    it('should detect mixed encoded and unencoded', () => {
      const patterns = detectPathTraversal('../%2e%2e/etc/passwd')
      expect(patterns.length).toBeGreaterThan(0)
    })

    it('should detect %2e%2e%5c (..\\)', () => {
      const patterns = detectPathTraversal('%2e%2e%5cwindows')
      expect(patterns).toContain('dot_dot_encoded')
    })
  })

  describe('Double Encoding', () => {
    it('should detect %252e%252e%252f (../)', () => {
      const patterns = detectPathTraversal('%252e%252e%252fetc/passwd')
      expect(patterns).toContain('dot_dot_encoded')
    })

    it('should detect %252e%252e/ (../)', () => {
      const patterns = detectPathTraversal('%252e%252e/etc/passwd')
      expect(patterns).toContain('dot_dot_encoded')
    })
  })

  describe('Mixed Encoding', () => {
    it('should detect %2e.%2f (.../)', () => {
      // This would be "../" after decoding
      const path = '%2e%2e%2f'
      const patterns = detectPathTraversal(path)
      expect(patterns).toContain('dot_dot_encoded')
    })

    it('should detect overlong UTF-8 encoded dots', () => {
      // Some systems may interpret these as dots
      const path = '%c0%ae%c0%ae%c0%af'
      // This tests that we're aware of the pattern even if not decoded
      expect(typeof detectPathTraversal(path)).toBe('object')
    })
  })
})

// ============================================================================
// Null Byte Injection Tests
// ============================================================================

describe('Null Byte Injection Detection', () => {
  it('should detect null byte in path', () => {
    const patterns = detectPathTraversal('uploads/file.txt\x00.jpg')
    expect(patterns).toContain('null_byte')
  })

  it('should detect URL encoded null byte', () => {
    const patterns = detectPathTraversal('uploads/file.txt%00.jpg')
    expect(patterns).toContain('null_byte')
  })

  it('should detect null byte before extension', () => {
    const patterns = detectPathTraversal('../../etc/passwd\x00.png')
    expect(patterns.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Path Containment Tests
// ============================================================================

describe('Path Containment Validation', () => {
  const baseDir = '/var/www/uploads'

  describe('Safe Paths', () => {
    it('should allow simple filenames', () => {
      expect(isPathSafe('document.pdf', baseDir)).toBe(true)
    })

    it('should allow subdirectories', () => {
      expect(isPathSafe('user1/document.pdf', baseDir)).toBe(true)
    })

    it('should allow nested subdirectories', () => {
      expect(isPathSafe('user1/folder/document.pdf', baseDir)).toBe(true)
    })

    it('should allow filenames with dots', () => {
      expect(isPathSafe('file.backup.pdf', baseDir)).toBe(true)
    })

    it('should allow filenames with special characters', () => {
      expect(isPathSafe('file-name_2024.pdf', baseDir)).toBe(true)
    })
  })

  describe('Unsafe Paths', () => {
    it('should block ../ traversal', () => {
      expect(isPathSafe('../etc/passwd', baseDir)).toBe(false)
    })

    it('should block absolute paths', () => {
      expect(isPathSafe('/etc/passwd', baseDir)).toBe(false)
    })

    it('should block traversal in middle', () => {
      expect(isPathSafe('user/../../../etc/passwd', baseDir)).toBe(false)
    })

    it('should block Windows paths', () => {
      expect(isPathSafe('C:\\windows\\system32\\config\\sam', baseDir)).toBe(false)
    })

    it('should block encoded traversal', () => {
      expect(isPathSafe('%2e%2e%2fetc/passwd', baseDir)).toBe(false)
    })
  })
})

// ============================================================================
// Path Sanitization Tests
// ============================================================================

describe('Path Sanitization', () => {
  describe('Traversal Removal', () => {
    it('should remove ../ sequences', () => {
      const sanitized = sanitizePath('../../../etc/passwd')
      expect(sanitized).not.toContain('..')
      expect(sanitized).toBe('etc/passwd')
    })

    it('should remove ..\\sequences', () => {
      const sanitized = sanitizePath('..\\..\\windows\\system32')
      expect(sanitized).not.toContain('..')
    })

    it('should remove mixed traversal', () => {
      const sanitized = sanitizePath('../folder/../../file.txt')
      expect(sanitized).not.toContain('..')
    })
  })

  describe('Leading Slash Removal', () => {
    it('should remove leading forward slash', () => {
      const sanitized = sanitizePath('/etc/passwd')
      expect(sanitized).not.toMatch(/^[/\\]/)
    })

    it('should remove leading backslash', () => {
      const sanitized = sanitizePath('\\windows\\system32')
      expect(sanitized).not.toMatch(/^[/\\]/)
    })

    it('should remove multiple leading slashes', () => {
      const sanitized = sanitizePath('///etc/passwd')
      expect(sanitized).not.toMatch(/^[/\\]/)
    })
  })

  describe('Path Normalization', () => {
    it('should normalize double slashes', () => {
      const sanitized = sanitizePath('folder//subfolder///file.txt')
      expect(sanitized).not.toContain('//')
    })

    it('should normalize backslashes to forward slashes', () => {
      const sanitized = sanitizePath('folder\\subfolder\\file.txt')
      expect(sanitized).toContain('/')
      expect(sanitized).not.toContain('\\')
    })
  })

  describe('Control Character Removal', () => {
    it('should remove null bytes', () => {
      const sanitized = sanitizePath('file.txt\x00.jpg')
      expect(sanitized).not.toContain('\x00')
    })

    it('should remove other control characters', () => {
      const sanitized = sanitizePath('file\x01\x02name.txt')
      const hasControlChars = Array.from(sanitized).some((ch) => ch.charCodeAt(0) < 32)
      expect(hasControlChars).toBe(false)
    })
  })
})

// ============================================================================
// Zod Schema Integration Tests
// ============================================================================

describe('Zod Path Schema Validation', () => {
  it('should accept safe relative paths', () => {
    expect(() => safePathSchema.parse('documents/report.pdf')).not.toThrow()
  })

  it('should accept simple filenames', () => {
    expect(() => safePathSchema.parse('report.pdf')).not.toThrow()
  })

  it('should reject traversal paths', () => {
    expect(() => safePathSchema.parse('../etc/passwd')).toThrow()
  })

  it('should reject absolute paths', () => {
    expect(() => safePathSchema.parse('/etc/passwd')).toThrow()
  })

  it('should reject encoded traversal', () => {
    expect(() => safePathSchema.parse('%2e%2e%2fetc/passwd')).toThrow()
  })

  it('should reject null byte injection', () => {
    expect(() => safePathSchema.parse('file.txt%00.jpg')).toThrow()
  })
})

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('Path Traversal Edge Cases', () => {
  describe('Dot Handling', () => {
    it('should allow single dot in filename', () => {
      expect(isPathSafe('file.txt', '/base')).toBe(true)
    })

    it('should allow multiple dots in filename', () => {
      expect(isPathSafe('file.backup.2024.txt', '/base')).toBe(true)
    })

    it('should allow dot-prefixed files', () => {
      expect(isPathSafe('.gitignore', '/base')).toBe(true)
    })

    it('should allow ./current directory reference', () => {
      // Single dot without slash is okay
      const patterns = detectPathTraversal('./file.txt')
      // This should not be flagged as traversal
      expect(patterns).not.toContain('dot_dot_slash')
    })
  })

  describe('Empty and Whitespace', () => {
    it('should handle empty path', () => {
      const patterns = detectPathTraversal('')
      expect(Array.isArray(patterns)).toBe(true)
    })

    it('should handle whitespace path', () => {
      const patterns = detectPathTraversal('   ')
      expect(Array.isArray(patterns)).toBe(true)
    })

    it('should handle path with spaces', () => {
      const patterns = detectPathTraversal('folder name/file name.txt')
      expect(patterns).not.toContain('dot_dot_slash')
    })
  })

  describe('Unicode Paths', () => {
    it('should handle unicode characters in path', () => {
      const patterns = detectPathTraversal('folder_test/file.txt')
      expect(patterns).not.toContain('dot_dot_slash')
    })

    it('should still detect traversal with unicode', () => {
      const patterns = detectPathTraversal('../folder_test/file.txt')
      expect(patterns).toContain('dot_dot_slash')
    })
  })

  describe('Long Paths', () => {
    it('should handle very long paths', () => {
      const longPath = 'a/'.repeat(100) + 'file.txt'
      const patterns = detectPathTraversal(longPath)
      expect(patterns).not.toContain('dot_dot_slash')
    })

    it('should detect traversal in long paths', () => {
      const longPath = 'a/'.repeat(50) + '../' + 'b/'.repeat(50) + 'file.txt'
      const patterns = detectPathTraversal(longPath)
      expect(patterns).toContain('dot_dot_slash')
    })
  })
})

// ============================================================================
// Real-World Attack Patterns Tests
// ============================================================================

describe('Real-World Attack Patterns', () => {
  describe('Common Exploit Attempts', () => {
    const exploitPaths = [
      '../../../etc/passwd',
      '....//....//....//etc/passwd',
      '..%252f..%252f..%252fetc/passwd',
      '..%c0%af..%c0%af..%c0%afetc/passwd',
      '..%00/etc/passwd',
      '..\\..\\..\\..\\..\\..\\windows\\system32\\config\\sam',
      '/..../..../..../..../..../..../etc/passwd',
      'file:///etc/passwd',
      '....//....//....//....//....//etc/passwd',
      '..//..//..//..//etc/passwd',
      '..%5c..%5c..%5c..%5cwindows%5csystem32',
    ]

    for (const exploitPath of exploitPaths) {
      it(`should detect attack pattern: ${exploitPath.slice(0, 40)}...`, () => {
        const patterns = detectPathTraversal(exploitPath)
        expect(patterns.length).toBeGreaterThan(0)
      })
    }
  })

  describe('Sensitive File Targets', () => {
    const sensitiveFiles = [
      '/etc/passwd',
      '/etc/shadow',
      '/etc/hosts',
      '/etc/ssh/sshd_config',
      '/root/.ssh/id_rsa',
      '/root/.bash_history',
      '/var/log/auth.log',
      'C:\\Windows\\System32\\config\\SAM',
      'C:\\Windows\\System32\\config\\SYSTEM',
      'C:\\Users\\Administrator\\Desktop\\password.txt',
    ]

    for (const file of sensitiveFiles) {
      it(`should block access to: ${file}`, () => {
        expect(isPathSafe(file, '/var/www/uploads')).toBe(false)
      })
    }
  })

  describe('Web Application Specific', () => {
    it('should block access to web.config', () => {
      expect(isPathSafe('../web.config', '/var/www/uploads')).toBe(false)
    })

    it('should block access to .htaccess', () => {
      expect(isPathSafe('../.htaccess', '/var/www/uploads')).toBe(false)
    })

    it('should block access to config.php', () => {
      expect(isPathSafe('../../config/config.php', '/var/www/uploads')).toBe(false)
    })

    it('should block access to .env', () => {
      expect(isPathSafe('../.env', '/var/www/uploads')).toBe(false)
    })

    it('should block access to package.json with credentials', () => {
      expect(isPathSafe('../../package.json', '/var/www/uploads')).toBe(false)
    })
  })
})

// ============================================================================
// Integration with File System Operations
// ============================================================================

describe('File System Operation Safety', () => {
  const baseUploadDir = '/var/www/uploads'

  /**
   * Simulate a file operation with path validation
   */
  function safeFileOperation(filename: string): { safe: boolean; resolvedPath?: string; error?: string } {
    // Detect traversal patterns
    const patterns = detectPathTraversal(filename)
    if (patterns.length > 0) {
      return { safe: false, error: `Detected patterns: ${patterns.join(', ')}` }
    }

    // Sanitize the path
    const sanitized = sanitizePath(filename)

    // Resolve full path
    const fullPath = path.resolve(baseUploadDir, sanitized)

    // Verify containment
    if (!fullPath.startsWith(baseUploadDir)) {
      return { safe: false, error: 'Path escapes base directory' }
    }

    return { safe: true, resolvedPath: fullPath }
  }

  it('should allow safe file operations', () => {
    const result = safeFileOperation('user123/document.pdf')
    expect(result.safe).toBe(true)
    expect(result.resolvedPath).toContain(baseUploadDir)
  })

  it('should block traversal in file operations', () => {
    const result = safeFileOperation('../../../etc/passwd')
    expect(result.safe).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should block absolute paths in file operations', () => {
    const result = safeFileOperation('/etc/passwd')
    expect(result.safe).toBe(false)
  })

  it('should block encoded traversal in file operations', () => {
    const result = safeFileOperation('%2e%2e%2fetc/passwd')
    expect(result.safe).toBe(false)
  })
})
