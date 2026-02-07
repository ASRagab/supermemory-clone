/**
 * Shared in-memory stores for the API layer.
 * In production, these would be replaced with a database connection.
 */

import { ApiDocument, ApiProfile } from '../../types/api.types.js';

// Shared document store - single source of truth for all routes
export const documentsStore = new Map<string, ApiDocument>();

// Shared profile store - single source of truth for all routes
export const profilesStore = new Map<string, ApiProfile>();

/**
 * Clear all stores - useful for testing
 */
export function clearAllStores(): void {
  documentsStore.clear();
  profilesStore.clear();
}

/**
 * Get document count for a container tag
 */
export function getDocumentCountByTag(containerTag: string): number {
  let count = 0;
  for (const doc of documentsStore.values()) {
    if (doc.containerTag === containerTag) {
      count++;
    }
  }
  return count;
}

/**
 * Get all documents as array
 */
export function getAllDocuments(): ApiDocument[] {
  return Array.from(documentsStore.values());
}

/**
 * Find document by ID or customId
 */
export function findDocument(idOrCustomId: string): ApiDocument | undefined {
  // First try by ID
  const doc = documentsStore.get(idOrCustomId);
  if (doc) return doc;

  // Then try by customId
  for (const d of documentsStore.values()) {
    if (d.customId === idOrCustomId) {
      return d;
    }
  }

  return undefined;
}
