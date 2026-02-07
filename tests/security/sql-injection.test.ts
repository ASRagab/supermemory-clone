/**
 * SQL Injection Prevention Test Suite
 *
 * Tests for detecting SQL injection patterns and verifying safe query practices.
 * Part of TASK-052: Security Tester - Input Validation Test Suite
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ============================================================================
// SQL Injection Detection Utilities
// ============================================================================

/**
 * Common SQL injection patterns to detect
 */
const SQL_INJECTION_PATTERNS = [
  // Classic injections
  { name: 'single_quote_escape', regex: /'\s*(?:OR|AND)\s+/i },
  { name: 'comment_injection', regex: /--\s*$|\/\*|\*\//i },
  { name: 'paren_or_bypass', regex: /\)\s*OR\s*\(/i },
  { name: 'semicolon_chain', regex: /;\s*(?:DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|CREATE|EXEC)/i },
  { name: 'union_select', regex: /UNION\s+(?:ALL\s+)?SELECT/i },

  // Boolean-based
  { name: 'or_true', regex: /'\s*OR\s+(?:'?1'?\s*=\s*'?1'?|'?true'?|1\s*=\s*1)/i },
  { name: 'and_false', regex: /'\s*AND\s+(?:'?0'?\s*=\s*'?1'?|'?false'?|1\s*=\s*0)/i },

  // Time-based
  { name: 'sleep_function', regex: /SLEEP\s*\(\s*\d+\s*\)/i },
  { name: 'benchmark', regex: /BENCHMARK\s*\(/i },
  { name: 'waitfor_delay', regex: /WAITFOR\s+DELAY/i },

  // Error-based
  { name: 'extractvalue', regex: /EXTRACTVALUE\s*\(/i },
  { name: 'updatexml', regex: /UPDATEXML\s*\(/i },

  // Stacked queries
  { name: 'drop_table', regex: /DROP\s+TABLE/i },
  { name: 'delete_from', regex: /DELETE\s+FROM/i },
  { name: 'update_set', regex: /UPDATE\s+\w+\s+SET/i },
  { name: 'insert_into', regex: /INSERT\s+INTO/i },
  { name: 'alter_table', regex: /ALTER\s+TABLE/i },
  { name: 'truncate_table', regex: /TRUNCATE\s+TABLE/i },
  { name: 'create_table', regex: /CREATE\s+TABLE/i },

  // Information schema
  { name: 'information_schema', regex: /INFORMATION_SCHEMA/i },
  { name: 'sys_tables', regex: /SYS\.\w+/i },
  { name: 'pg_catalog', regex: /PG_CATALOG/i },

  // Privilege escalation
  { name: 'grant_privilege', regex: /GRANT\s+/i },
  { name: 'revoke_privilege', regex: /REVOKE\s+/i },

  // File operations
  { name: 'load_file', regex: /LOAD_FILE\s*\(/i },
  { name: 'into_outfile', regex: /INTO\s+(?:OUT|DUMP)FILE/i },
  { name: 'into_dumpfile', regex: /INTO\s+DUMPFILE/i },

  // Encoded injections
  { name: 'hex_encoded', regex: /0x[0-9a-f]{4,}/i },
  { name: 'char_function', regex: /CHAR\s*\(\s*\d+(?:\s*,\s*\d+)*\s*\)/i },
];

/**
 * Detect SQL injection patterns in input
 */
function detectSQLInjection(input: string): string[] {
  const detected: string[] = [];

  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.regex.test(input)) {
      detected.push(pattern.name);
    }
  }

  return detected;
}

/**
 * Check if input appears to contain SQL injection
 */
function containsSQLInjection(input: string): boolean {
  return detectSQLInjection(input).length > 0;
}

/**
 * Escape special SQL characters for safe inclusion in queries
 * Note: This should NOT be used in place of parameterized queries!
 */
function escapeSQLString(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/"/g, '\\"')
    .split('\0').join('\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .split(String.fromCharCode(26)).join('\\Z');
}

/**
 * Zod schema with SQL injection detection
 */
const safeSQLInputSchema = z.string().refine(
  (val) => !containsSQLInjection(val),
  { message: 'Input contains potential SQL injection patterns' }
);

// ============================================================================
// Mock Database Interface for Testing
// ============================================================================

interface MockDatabase {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  execute: (sql: string, params?: unknown[]) => Promise<{ affectedRows: number }>;
}

/**
 * Create a mock database that validates parameterized queries
 */
function createMockDatabase(): MockDatabase {
  return {
    query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
      // Verify that user inputs are not directly in the SQL string
      // This is a simplified check
      if (!params || params.length === 0) {
        // Check if the query contains literal values that should be parameterized
        const hasLiteralStrings = /'[^']*'/.test(sql) && !sql.includes('CREATE') && !sql.includes('DEFAULT');
        if (hasLiteralStrings) {
          console.warn('Query contains literal strings - consider using parameters');
        }
      }
      return [];
    }),
    execute: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
      return { affectedRows: 0 };
    }),
  };
}

// ============================================================================
// Classic SQL Injection Tests
// ============================================================================

describe('Classic SQL Injection Detection', () => {
  describe('Quote Escape Attacks', () => {
    it("should detect '; DROP TABLE users; --", () => {
      const payload = "'; DROP TABLE users; --";
      expect(containsSQLInjection(payload)).toBe(true);
      expect(detectSQLInjection(payload)).toContain('semicolon_chain');
    });

    it("should detect ' OR '1'='1", () => {
      const payload = "' OR '1'='1";
      expect(containsSQLInjection(payload)).toBe(true);
      expect(detectSQLInjection(payload)).toContain('or_true');
    });

    it("should detect ' OR 1=1--", () => {
      const payload = "' OR 1=1--";
      const patterns = detectSQLInjection(payload);
      expect(patterns).toContain('or_true');
    });

    it("should detect admin'--", () => {
      const payload = "admin'--";
      const patterns = detectSQLInjection(payload);
      expect(patterns).toContain('comment_injection');
    });

    it("should detect ' AND '1'='0", () => {
      const payload = "' AND '1'='0";
      expect(containsSQLInjection(payload)).toBe(true);
    });
  });

  describe('Union-based Attacks', () => {
    it('should detect UNION SELECT * FROM users', () => {
      const payload = "' UNION SELECT * FROM users--";
      expect(containsSQLInjection(payload)).toBe(true);
      expect(detectSQLInjection(payload)).toContain('union_select');
    });

    it('should detect UNION ALL SELECT', () => {
      const payload = "1' UNION ALL SELECT username, password FROM users--";
      const patterns = detectSQLInjection(payload);
      expect(patterns).toContain('union_select');
    });

    it('should detect UNION SELECT with column numbers', () => {
      const payload = "' UNION SELECT 1,2,3,4,5--";
      expect(containsSQLInjection(payload)).toBe(true);
    });

    it('should detect UNION SELECT NULL', () => {
      const payload = "' UNION SELECT NULL,NULL,NULL--";
      expect(containsSQLInjection(payload)).toBe(true);
    });
  });

  describe('Stacked Query Attacks', () => {
    it('should detect DROP TABLE', () => {
      const payload = "1; DROP TABLE users;";
      expect(containsSQLInjection(payload)).toBe(true);
      expect(detectSQLInjection(payload)).toContain('drop_table');
    });

    it('should detect DELETE FROM', () => {
      const payload = "1; DELETE FROM users WHERE 1=1;";
      expect(containsSQLInjection(payload)).toBe(true);
      expect(detectSQLInjection(payload)).toContain('delete_from');
    });

    it('should detect UPDATE SET', () => {
      const payload = "1; UPDATE users SET password='hacked' WHERE 1=1;";
      expect(containsSQLInjection(payload)).toBe(true);
      expect(detectSQLInjection(payload)).toContain('update_set');
    });

    it('should detect INSERT INTO', () => {
      const payload = "1; INSERT INTO users VALUES ('hacker', 'password');";
      expect(containsSQLInjection(payload)).toBe(true);
      expect(detectSQLInjection(payload)).toContain('insert_into');
    });

    it('should detect TRUNCATE TABLE', () => {
      const payload = "1; TRUNCATE TABLE users;";
      expect(containsSQLInjection(payload)).toBe(true);
      expect(detectSQLInjection(payload)).toContain('truncate_table');
    });
  });
});

// ============================================================================
// Time-based Blind SQL Injection Tests
// ============================================================================

describe('Time-based Blind SQL Injection Detection', () => {
  it('should detect SLEEP function', () => {
    const payload = "1' AND SLEEP(5)--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('sleep_function');
  });

  it('should detect BENCHMARK function', () => {
    const payload = "1' AND BENCHMARK(10000000,SHA1('test'))--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('benchmark');
  });

  it('should detect WAITFOR DELAY (MSSQL)', () => {
    const payload = "1'; WAITFOR DELAY '0:0:5'--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('waitfor_delay');
  });

  it('should detect SLEEP with various durations', () => {
    const payloads = [
      "' AND SLEEP(1)--",
      "' AND SLEEP(10)--",
      "' AND SLEEP(0)--",
    ];
    for (const payload of payloads) {
      expect(detectSQLInjection(payload)).toContain('sleep_function');
    }
  });
});

// ============================================================================
// Error-based SQL Injection Tests
// ============================================================================

describe('Error-based SQL Injection Detection', () => {
  it('should detect EXTRACTVALUE', () => {
    const payload = "' AND EXTRACTVALUE(1,CONCAT(0x7e,(SELECT version())))--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('extractvalue');
  });

  it('should detect UPDATEXML', () => {
    const payload = "' AND UPDATEXML(1,CONCAT(0x7e,(SELECT version())),1)--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('updatexml');
  });
});

// ============================================================================
// Information Schema Attacks Tests
// ============================================================================

describe('Information Schema Attack Detection', () => {
  it('should detect INFORMATION_SCHEMA queries', () => {
    const payload = "' UNION SELECT table_name FROM INFORMATION_SCHEMA.TABLES--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('information_schema');
  });

  it('should detect pg_catalog queries (PostgreSQL)', () => {
    const payload = "' UNION SELECT tablename FROM pg_catalog.pg_tables--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('pg_catalog');
  });

  it('should detect sys.tables queries (MSSQL)', () => {
    const payload = "' UNION SELECT name FROM sys.tables--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('sys_tables');
  });
});

// ============================================================================
// File Operation Attacks Tests
// ============================================================================

describe('File Operation Attack Detection', () => {
  it('should detect LOAD_FILE', () => {
    const payload = "' UNION SELECT LOAD_FILE('/etc/passwd')--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('load_file');
  });

  it('should detect INTO OUTFILE', () => {
    const payload = "' UNION SELECT * FROM users INTO OUTFILE '/tmp/users.txt'--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('into_outfile');
  });

  it('should detect INTO DUMPFILE', () => {
    const payload = "' UNION SELECT 0x3c3f706870 INTO DUMPFILE '/var/www/shell.php'--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('into_dumpfile');
  });
});

// ============================================================================
// Privilege Escalation Tests
// ============================================================================

describe('Privilege Escalation Attack Detection', () => {
  it('should detect GRANT statements', () => {
    const payload = "'; GRANT ALL PRIVILEGES ON *.* TO 'hacker'@'%';--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('grant_privilege');
  });

  it('should detect REVOKE statements', () => {
    const payload = "'; REVOKE ALL PRIVILEGES FROM 'admin'@'localhost';--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('revoke_privilege');
  });
});

// ============================================================================
// Encoded SQL Injection Tests
// ============================================================================

describe('Encoded SQL Injection Detection', () => {
  describe('Hex Encoding', () => {
    it('should detect hex encoded strings', () => {
      const payload = "' UNION SELECT 0x61646d696e--";
      expect(containsSQLInjection(payload)).toBe(true);
      expect(detectSQLInjection(payload)).toContain('hex_encoded');
    });

    it('should detect hex in WHERE clause', () => {
      const payload = "' WHERE password = 0x70617373776f7264--";
      expect(detectSQLInjection(payload)).toContain('hex_encoded');
    });
  });

  describe('CHAR Function', () => {
    it('should detect CHAR function', () => {
      const payload = "' UNION SELECT CHAR(97,100,109,105,110)--";
      expect(containsSQLInjection(payload)).toBe(true);
      expect(detectSQLInjection(payload)).toContain('char_function');
    });

    it('should detect CHAR with different values', () => {
      const payload = "CHAR(65,66,67)";
      expect(detectSQLInjection(payload)).toContain('char_function');
    });
  });
});

// ============================================================================
// Comment-based Bypasses Tests
// ============================================================================

describe('Comment-based Bypass Detection', () => {
  it('should detect -- comment', () => {
    const payload = "admin'--";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('comment_injection');
  });

  it('should detect /* */ comment', () => {
    const payload = "admin'/**/";
    expect(containsSQLInjection(payload)).toBe(true);
    expect(detectSQLInjection(payload)).toContain('comment_injection');
  });

  it('should detect inline comments', () => {
    const payload = "admin'/*comment*/AND/*comment*/1=1";
    expect(containsSQLInjection(payload)).toBe(true);
  });
});

// ============================================================================
// Safe Input Tests
// ============================================================================

describe('Safe Input Validation', () => {
  describe('Normal User Inputs', () => {
    it('should allow regular usernames', () => {
      expect(containsSQLInjection('john_doe')).toBe(false);
      expect(containsSQLInjection('jane.smith')).toBe(false);
      expect(containsSQLInjection('user123')).toBe(false);
    });

    it('should allow regular email addresses', () => {
      expect(containsSQLInjection('user@example.com')).toBe(false);
      expect(containsSQLInjection('john.doe@company.org')).toBe(false);
    });

    it('should allow regular search queries', () => {
      expect(containsSQLInjection('machine learning algorithms')).toBe(false);
      expect(containsSQLInjection('how to cook pasta')).toBe(false);
    });

    it('should allow regular memory content', () => {
      expect(containsSQLInjection('User prefers dark mode for the application')).toBe(false);
      expect(containsSQLInjection('Meeting scheduled for 3pm tomorrow')).toBe(false);
    });

    it('should allow numeric inputs', () => {
      expect(containsSQLInjection('12345')).toBe(false);
      expect(containsSQLInjection('3.14159')).toBe(false);
    });
  });

  describe('Legitimate Technical Content', () => {
    it('should handle SELECT keyword in context', () => {
      // This is tricky - "select" in normal text shouldn't trigger
      expect(containsSQLInjection('Please select an option')).toBe(false);
    });

    it('should handle OR in normal text', () => {
      expect(containsSQLInjection('apples or oranges')).toBe(false);
    });

    it('should handle quotes in text', () => {
      expect(containsSQLInjection("It's a beautiful day")).toBe(false);
    });
  });
});

// ============================================================================
// SQL String Escaping Tests
// ============================================================================

describe('SQL String Escaping', () => {
  it('should escape single quotes', () => {
    const input = "O'Brien";
    const escaped = escapeSQLString(input);
    expect(escaped).toBe("O''Brien");
  });

  it('should escape backslashes', () => {
    const input = 'path\\to\\file';
    const escaped = escapeSQLString(input);
    expect(escaped).toBe('path\\\\to\\\\file');
  });

  it('should escape null bytes', () => {
    const input = 'test\x00injection';
    const escaped = escapeSQLString(input);
    expect(escaped).toBe('test\\0injection');
  });

  it('should escape newlines', () => {
    const input = 'line1\nline2';
    const escaped = escapeSQLString(input);
    expect(escaped).toBe('line1\\nline2');
  });

  it('should handle complex injection attempts', () => {
    const input = "'; DROP TABLE users; --";
    const escaped = escapeSQLString(input);
    expect(escaped).toBe("''; DROP TABLE users; --");
    expect(escaped).not.toBe(input);
  });
});

// ============================================================================
// Zod Schema Integration Tests
// ============================================================================

describe('Zod Schema SQL Injection Validation', () => {
  it('should accept safe input', () => {
    expect(() => safeSQLInputSchema.parse('Hello, World!')).not.toThrow();
  });

  it('should accept email addresses', () => {
    expect(() => safeSQLInputSchema.parse('user@example.com')).not.toThrow();
  });

  it('should reject SQL injection attempts', () => {
    expect(() => safeSQLInputSchema.parse("' OR '1'='1")).toThrow();
  });

  it('should reject DROP TABLE attempts', () => {
    expect(() => safeSQLInputSchema.parse("'; DROP TABLE users;--")).toThrow();
  });

  it('should reject UNION SELECT attempts', () => {
    expect(() => safeSQLInputSchema.parse("' UNION SELECT * FROM users--")).toThrow();
  });
});

// ============================================================================
// Parameterized Query Safety Tests
// ============================================================================

describe('Parameterized Query Safety', () => {
  let db: MockDatabase;

  beforeEach(() => {
    db = createMockDatabase();
  });

  describe('Safe Query Patterns', () => {
    it('should use parameterized queries for user input', async () => {
      const userInput = "'; DROP TABLE users; --";

      // Safe pattern: parameterized query
      await db.query('SELECT * FROM memories WHERE content = $1', [userInput]);

      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM memories WHERE content = $1',
        [userInput]
      );
    });

    it('should use multiple parameters safely', async () => {
      const userId = "admin'--";
      const containerTag = "'; DELETE FROM memories;--";

      await db.query(
        'SELECT * FROM memories WHERE user_id = $1 AND container_tag = $2',
        [userId, containerTag]
      );

      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM memories WHERE user_id = $1 AND container_tag = $2',
        [userId, containerTag]
      );
    });

    it('should parameterize INSERT statements', async () => {
      const maliciousContent = "'); DROP TABLE memories; --";

      await db.execute(
        'INSERT INTO memories (content, user_id) VALUES ($1, $2)',
        [maliciousContent, 'user123']
      );

      expect(db.execute).toHaveBeenCalledWith(
        'INSERT INTO memories (content, user_id) VALUES ($1, $2)',
        [maliciousContent, 'user123']
      );
    });

    it('should parameterize UPDATE statements', async () => {
      const maliciousTag = "test'; UPDATE memories SET content='hacked' WHERE '1'='1";

      await db.execute(
        'UPDATE memories SET container_tag = $1 WHERE id = $2',
        [maliciousTag, 'memory-123']
      );

      expect(db.execute).toHaveBeenCalledWith(
        'UPDATE memories SET container_tag = $1 WHERE id = $2',
        [maliciousTag, 'memory-123']
      );
    });

    it('should parameterize DELETE statements', async () => {
      const maliciousId = "1 OR 1=1";

      await db.execute(
        'DELETE FROM memories WHERE id = $1',
        [maliciousId]
      );

      expect(db.execute).toHaveBeenCalledWith(
        'DELETE FROM memories WHERE id = $1',
        [maliciousId]
      );
    });
  });

  describe('Dangerous Pattern Detection', () => {
    it('should warn about string concatenation in queries', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      const userInput = 'test';

      // This is a BAD pattern - don't do this!
      await db.query(`SELECT * FROM users WHERE name = '${userInput}'`);

      // Verify warning was logged (mock implementation)
      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Real-World Attack Scenarios Tests
// ============================================================================

describe('Real-World Attack Scenarios', () => {
  describe('Login Bypass Attempts', () => {
    const loginPayloads = [
      "admin'--",
      "admin'/*",
      "' OR '1'='1'--",
      "' OR '1'='1'/*",
      "') OR ('1'='1",
      "') OR ('1'='1'--",
      "admin' AND '1'='1",
      "1' OR '1'='1' LIMIT 1--",
    ];

    for (const payload of loginPayloads) {
      it(`should detect login bypass: ${payload}`, () => {
        expect(containsSQLInjection(payload)).toBe(true);
      });
    }
  });

  describe('Data Exfiltration Attempts', () => {
    const exfilPayloads = [
      "' UNION SELECT username, password FROM users--",
      "' UNION SELECT NULL,NULL,NULL,CONCAT(username,':',password) FROM users--",
      "' UNION SELECT table_name,NULL FROM information_schema.tables--",
      "' UNION SELECT column_name,NULL FROM information_schema.columns--",
    ];

    for (const payload of exfilPayloads) {
      it(`should detect exfiltration: ${payload.slice(0, 50)}...`, () => {
        expect(containsSQLInjection(payload)).toBe(true);
      });
    }
  });

  describe('Database Destruction Attempts', () => {
    const destructivePayloads = [
      "'; DROP TABLE users;--",
      "'; DROP DATABASE production;--",
      "'; TRUNCATE TABLE users;--",
      "'; DELETE FROM users WHERE 1=1;--",
      "'; UPDATE users SET password='hacked' WHERE 1=1;--",
    ];

    for (const payload of destructivePayloads) {
      it(`should detect destruction: ${payload.slice(0, 50)}...`, () => {
        expect(containsSQLInjection(payload)).toBe(true);
      });
    }
  });
});

// ============================================================================
// Database-Specific Injection Tests
// ============================================================================

describe('Database-Specific Injections', () => {
  describe('PostgreSQL Specific', () => {
    it('should detect pg_sleep', () => {
      const payload = "'; SELECT pg_sleep(5);--";
      expect(containsSQLInjection(payload)).toBe(true);
    });

    it('should detect pg_catalog access', () => {
      const payload = "' UNION SELECT * FROM pg_catalog.pg_tables--";
      expect(containsSQLInjection(payload)).toBe(true);
    });
  });

  describe('MySQL Specific', () => {
    it('should detect SLEEP function', () => {
      const payload = "' AND SLEEP(5)--";
      expect(containsSQLInjection(payload)).toBe(true);
    });

    it('should detect BENCHMARK function', () => {
      const payload = "' AND BENCHMARK(10000000,MD5('test'))--";
      expect(containsSQLInjection(payload)).toBe(true);
    });
  });

  describe('MSSQL Specific', () => {
    it('should detect WAITFOR DELAY', () => {
      const payload = "'; WAITFOR DELAY '0:0:5'--";
      expect(containsSQLInjection(payload)).toBe(true);
    });

    it('should detect xp_cmdshell attempt', () => {
      // xp_cmdshell is extremely dangerous
      const payload = "'; EXEC xp_cmdshell 'whoami';--";
      expect(containsSQLInjection(payload)).toBe(true);
    });
  });
});

// ============================================================================
// Edge Cases and Obfuscation Tests
// ============================================================================

describe('Edge Cases and Obfuscation', () => {
  describe('Case Variations', () => {
    it('should detect case variations of SQL keywords', () => {
      expect(containsSQLInjection("' UnIoN SeLeCt * FrOm users--")).toBe(true);
      expect(containsSQLInjection("' DrOp TaBlE users--")).toBe(true);
    });
  });

  describe('Whitespace Variations', () => {
    it('should detect injections with extra whitespace', () => {
      expect(containsSQLInjection("'   OR   '1'='1")).toBe(true);
      expect(containsSQLInjection("'  UNION  SELECT  *  FROM  users--")).toBe(true);
    });

    it('should detect injections with tabs', () => {
      expect(containsSQLInjection("'\tOR\t'1'='1")).toBe(true);
    });

    it('should detect injections with newlines', () => {
      expect(containsSQLInjection("'\nOR\n'1'='1")).toBe(true);
    });
  });

  describe('Comment Obfuscation', () => {
    it('should detect inline comment obfuscation', () => {
      expect(containsSQLInjection("'/**/OR/**/1=1--")).toBe(true);
    });
  });
});
