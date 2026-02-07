/**
 * Logging Infrastructure for Supermemory Clone
 *
 * Provides structured logging with levels (debug, info, warn, error)
 * and support for context and request tracing.
 */

/**
 * Log levels in order of severity
 */
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
} as const;

export type LogLevelName = keyof typeof LogLevel;
export type LogLevelValue = (typeof LogLevel)[LogLevelName];

/**
 * Log entry structure
 */
export interface LogEntry {
  /** Log level */
  level: LogLevelName;
  /** Log message */
  message: string;
  /** Timestamp */
  timestamp: Date;
  /** Optional context data */
  context?: Record<string, unknown>;
  /** Optional request/trace ID */
  traceId?: string;
  /** Error object if applicable */
  error?: Error;
  /** Service or module name */
  service?: string;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  level: LogLevelName;
  /** Service name for log entries */
  service?: string;
  /** Whether to include timestamps */
  includeTimestamp?: boolean;
  /** Whether to output as JSON */
  jsonOutput?: boolean;
  /** Custom output handler */
  output?: (entry: LogEntry) => void;
}

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: LoggerConfig = {
  level: (process.env.LOG_LEVEL as LogLevelName) || 'INFO',
  includeTimestamp: true,
  jsonOutput: process.env.NODE_ENV === 'production',
};

/**
 * Format log entry for console output
 */
function formatLogEntry(entry: LogEntry, config: LoggerConfig): string {
  if (config.jsonOutput) {
    return JSON.stringify({
      level: entry.level,
      message: entry.message,
      timestamp: entry.timestamp.toISOString(),
      service: entry.service,
      traceId: entry.traceId,
      context: entry.context,
      error: entry.error
        ? {
            name: entry.error.name,
            message: entry.error.message,
            stack: entry.error.stack,
          }
        : undefined,
    });
  }

  const parts: string[] = [];

  if (config.includeTimestamp) {
    parts.push(`[${entry.timestamp.toISOString()}]`);
  }

  parts.push(`[${entry.level}]`);

  if (entry.service) {
    parts.push(`[${entry.service}]`);
  }

  if (entry.traceId) {
    parts.push(`[${entry.traceId}]`);
  }

  parts.push(entry.message);

  if (entry.context && Object.keys(entry.context).length > 0) {
    parts.push(JSON.stringify(entry.context));
  }

  if (entry.error) {
    parts.push(`\n  Error: ${entry.error.message}`);
    if (entry.error.stack) {
      parts.push(`\n  Stack: ${entry.error.stack}`);
    }
  }

  return parts.join(' ');
}

/**
 * Default output handler
 */
function defaultOutput(entry: LogEntry, config: LoggerConfig): void {
  const formatted = formatLogEntry(entry, config);

  switch (entry.level) {
    case 'ERROR':
      console.error(formatted);
      break;
    case 'WARN':
      console.warn(formatted);
      break;
    case 'DEBUG':
      console.debug(formatted);
      break;
    default:
      console.log(formatted);
  }
}

/**
 * Logger class providing structured logging with levels and context
 */
export class Logger {
  private config: LoggerConfig;
  private traceId?: string;
  private defaultContext: Record<string, unknown> = {};

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set trace ID for request correlation
   */
  setTraceId(traceId: string): void {
    this.traceId = traceId;
  }

  /**
   * Clear trace ID
   */
  clearTraceId(): void {
    this.traceId = undefined;
  }

  /**
   * Set default context that will be included in all log entries
   */
  setDefaultContext(context: Record<string, unknown>): void {
    this.defaultContext = { ...context };
  }

  /**
   * Add to default context
   */
  addContext(context: Record<string, unknown>): void {
    this.defaultContext = { ...this.defaultContext, ...context };
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>, service?: string): Logger {
    const child = new Logger({
      ...this.config,
      service: service ?? this.config.service,
    });
    child.traceId = this.traceId;
    child.defaultContext = { ...this.defaultContext, ...context };
    return child;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevelName): boolean {
    return LogLevel[level] >= LogLevel[this.config.level];
  }

  /**
   * Create and output a log entry
   */
  private log(
    level: LogLevelName,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context: { ...this.defaultContext, ...context },
      traceId: this.traceId,
      error,
      service: this.config.service,
    };

    if (this.config.output) {
      this.config.output(entry);
    } else {
      defaultOutput(entry, this.config);
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('DEBUG', message, context);
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('INFO', message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log('WARN', message, context, error);
  }

  /**
   * Log error message
   */
  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log('ERROR', message, context, error);
  }

  /**
   * Log error with automatic error extraction
   */
  errorWithException(message: string, err: unknown, context?: Record<string, unknown>): void {
    const error = err instanceof Error ? err : new Error(String(err));
    this.log('ERROR', message, context, error);
  }

  /**
   * Create a timing helper for measuring operation duration
   */
  time(label: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.debug(`${label} completed`, { durationMs: duration });
    };
  }
}

// ============================================================================
// Factory Functions and Singletons
// ============================================================================

/**
 * Create a new logger instance
 */
export function createLogger(config?: Partial<LoggerConfig>): Logger {
  return new Logger(config);
}

/**
 * Service-specific loggers
 */
const loggers = new Map<string, Logger>();

/**
 * Get or create a logger for a specific service
 */
export function getLogger(service: string): Logger {
  let logger = loggers.get(service);
  if (!logger) {
    logger = new Logger({ service });
    loggers.set(service, logger);
  }
  return logger;
}

/**
 * Reset all loggers (useful for testing)
 */
export function resetLoggers(): void {
  loggers.clear();
}

/**
 * Default application logger
 */
export const logger = createLogger({ service: 'supermemory' });
