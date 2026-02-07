/**
 * Persistence Layer - Abstract storage interface with multiple backends
 *
 * Provides a consistent interface for storing and retrieving data
 * with support for in-memory, file-based, and database backends.
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Persistence store interface
 */
export interface PersistenceStore<T> {
  /** Get all items */
  getAll(): Promise<T[]>;

  /** Get item by ID */
  get(id: string): Promise<T | undefined>;

  /** Save an item (insert or update) */
  save(item: T): Promise<void>;

  /** Save multiple items in batch */
  saveBatch(items: T[]): Promise<void>;

  /** Delete an item by ID */
  delete(id: string): Promise<boolean>;

  /** Clear all items */
  clear(): Promise<void>;

  /** Persist current state (for backends that buffer writes) */
  flush(): Promise<void>;

  /** Get item count */
  count(): Promise<number>;
}

/**
 * Options for persistence stores
 */
export interface PersistenceOptions {
  /** Directory for file-based storage */
  dataDir?: string;

  /** Auto-flush interval in milliseconds (0 to disable) */
  autoFlushIntervalMs?: number;

  /** Namespace/prefix for keys */
  namespace?: string;
}

/**
 * Item with an ID (required for persistence)
 */
export interface Identifiable {
  id: string;
}

/**
 * In-memory persistence store with optional file backup
 */
export class MemoryPersistenceStore<T extends Identifiable> implements PersistenceStore<T> {
  protected items: Map<string, T> = new Map();
  protected dirty: boolean = false;
  protected options: PersistenceOptions;
  protected flushInterval: NodeJS.Timeout | null = null;
  protected filePath: string | null = null;

  constructor(
    protected name: string,
    options: PersistenceOptions = {}
  ) {
    this.options = options;

    // Set up file path if dataDir is provided
    if (options.dataDir) {
      const namespace = options.namespace ?? 'default';
      this.filePath = join(options.dataDir, namespace, `${name}.json`);
    }

    // Set up auto-flush interval
    if (options.autoFlushIntervalMs && options.autoFlushIntervalMs > 0) {
      this.flushInterval = setInterval(() => {
        if (this.dirty) {
          this.flush().catch(console.error);
        }
      }, options.autoFlushIntervalMs);
    }
  }

  async getAll(): Promise<T[]> {
    return Array.from(this.items.values());
  }

  async get(id: string): Promise<T | undefined> {
    return this.items.get(id);
  }

  async save(item: T): Promise<void> {
    this.items.set(item.id, item);
    this.dirty = true;
  }

  async saveBatch(items: T[]): Promise<void> {
    for (const item of items) {
      this.items.set(item.id, item);
    }
    this.dirty = true;
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.items.has(id);
    this.items.delete(id);
    if (existed) {
      this.dirty = true;
    }
    return existed;
  }

  async clear(): Promise<void> {
    this.items.clear();
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.filePath || !this.dirty) return;

    try {
      // Ensure directory exists
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      // Write data to file
      const data = JSON.stringify(
        {
          version: 1,
          name: this.name,
          items: Array.from(this.items.values()),
          savedAt: new Date().toISOString(),
        },
        null,
        2
      );

      await writeFile(this.filePath, data, 'utf-8');
      this.dirty = false;
    } catch (error) {
      console.error(`[Persistence] Failed to flush ${this.name}:`, error);
      throw error;
    }
  }

  async count(): Promise<number> {
    return this.items.size;
  }

  /**
   * Load data from file (call during initialization)
   */
  async load(): Promise<void> {
    if (!this.filePath) return;

    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const data = JSON.parse(content) as {
        version: number;
        name: string;
        items: T[];
        savedAt: string;
      };

      this.items.clear();
      for (const item of data.items) {
        this.items.set(item.id, item);
      }

      console.log(`[Persistence] Loaded ${this.items.size} items from ${this.name}`);
    } catch (error) {
      console.error(`[Persistence] Failed to load ${this.name}:`, error);
    }
  }

  /**
   * Export all data (for backup)
   */
  export(): T[] {
    return Array.from(this.items.values());
  }

  /**
   * Import data (for restore)
   */
  async import(items: T[]): Promise<void> {
    for (const item of items) {
      this.items.set(item.id, item);
    }
    this.dirty = true;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush
    if (this.dirty) {
      await this.flush();
    }
  }
}

/**
 * Persistence store factory
 */
export class PersistenceFactory {
  private static stores: Map<string, PersistenceStore<unknown>> = new Map();
  private static defaultOptions: PersistenceOptions = {};

  /**
   * Configure default options for all stores
   */
  static configure(options: PersistenceOptions): void {
    this.defaultOptions = { ...this.defaultOptions, ...options };
  }

  /**
   * Get or create a persistence store
   */
  static getStore<T extends Identifiable>(
    name: string,
    options?: PersistenceOptions
  ): MemoryPersistenceStore<T> {
    const key = `${options?.namespace ?? 'default'}:${name}`;

    if (!this.stores.has(key)) {
      const store = new MemoryPersistenceStore<T>(name, {
        ...this.defaultOptions,
        ...options,
      });
      this.stores.set(key, store as unknown as PersistenceStore<unknown>);
    }

    return this.stores.get(key) as MemoryPersistenceStore<T>;
  }

  /**
   * Flush all stores
   */
  static async flushAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const store of this.stores.values()) {
      promises.push(store.flush());
    }
    await Promise.all(promises);
  }

  /**
   * Destroy all stores and cleanup resources
   */
  static async destroyAll(): Promise<void> {
    for (const store of this.stores.values()) {
      if ('destroy' in store && typeof store.destroy === 'function') {
        await (store as { destroy: () => Promise<void> }).destroy();
      }
    }
    this.stores.clear();
  }
}

/**
 * Configure persistence based on environment
 */
export function configurePersistence(options?: PersistenceOptions): void {
  const defaultDataDir = process.env.SUPERMEMORY_DATA_DIR ?? './data';
  const autoFlush = process.env.SUPERMEMORY_AUTO_FLUSH !== 'false';

  PersistenceFactory.configure({
    dataDir: options?.dataDir ?? defaultDataDir,
    autoFlushIntervalMs: autoFlush ? (options?.autoFlushIntervalMs ?? 30000) : 0,
    ...options,
  });
}

// Export convenience types
export type { Identifiable as PersistableItem };
