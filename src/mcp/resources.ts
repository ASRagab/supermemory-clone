/**
 * MCP Resource Definitions for Supermemory
 *
 * Exposes supermemory data as MCP resources that can be read by clients.
 * Resources use URI patterns to identify different data types.
 */

import { ValidationError } from '../utils/errors.js';

// ============================================================================
// Resource URI Patterns
// ============================================================================

/**
 * Resource URI patterns:
 * - memory://profiles/{containerTag} - User profile for a container
 * - memory://documents/{id} - Specific document by ID
 * - memory://search?q={query}&container={containerTag} - Search results
 * - memory://facts/{containerTag} - Facts for a container
 * - memory://stats - Overall statistics
 */

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'memory://profiles/{containerTag}',
    name: 'User Profile',
    description: 'Get the user profile containing extracted facts for a specific container',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'memory://documents/{id}',
    name: 'Document',
    description: 'Get a specific document by its ID',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'memory://search',
    name: 'Search Results',
    description:
      'Search for memories. Query params: q (query), container (containerTag), limit, mode',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'memory://facts/{containerTag}',
    name: 'Container Facts',
    description: 'Get all facts for a specific container',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'memory://stats',
    name: 'Statistics',
    description: 'Get overall supermemory statistics',
    mimeType: 'application/json',
  },
];

// ============================================================================
// Resource Parser
// ============================================================================

export interface ParsedResourceUri {
  type: 'profile' | 'document' | 'search' | 'facts' | 'stats' | 'unknown';
  params: Record<string, string>;
}

/**
 * Parse a resource URI into its components
 */
export function parseResourceUri(uri: string): ParsedResourceUri {
  // Handle memory:// protocol
  if (!uri.startsWith('memory://')) {
    return { type: 'unknown', params: {} };
  }

  const path = uri.substring('memory://'.length);
  const [pathPart, queryPart] = path.split('?');

  // Parse query parameters
  const params: Record<string, string> = {};
  if (queryPart) {
    const searchParams = new URLSearchParams(queryPart);
    for (const [key, value] of searchParams.entries()) {
      params[key] = value;
    }
  }

  // Parse path
  if (!pathPart) {
    return { type: 'unknown', params };
  }

  const segments = pathPart.split('/').filter(Boolean);

  if (segments[0] === 'profiles' && segments[1]) {
    return { type: 'profile', params: { containerTag: segments[1], ...params } };
  }

  if (segments[0] === 'documents' && segments[1]) {
    return { type: 'document', params: { id: segments[1], ...params } };
  }

  if (segments[0] === 'search') {
    return { type: 'search', params };
  }

  if (segments[0] === 'facts' && segments[1]) {
    return { type: 'facts', params: { containerTag: segments[1], ...params } };
  }

  if (segments[0] === 'stats') {
    return { type: 'stats', params };
  }

  return { type: 'unknown', params };
}

/**
 * Build a resource URI from components
 */
export function buildResourceUri(
  type: 'profile' | 'document' | 'search' | 'facts' | 'stats',
  params?: Record<string, string>
): string {
  switch (type) {
    case 'profile':
      if (!params?.containerTag) {
        throw new ValidationError('containerTag required for profile URI', {
          containerTag: ['containerTag parameter is required for profile URIs'],
        });
      }
      return `memory://profiles/${encodeURIComponent(params.containerTag)}`;

    case 'document':
      if (!params?.id) {
        throw new ValidationError('id required for document URI', {
          id: ['id parameter is required for document URIs'],
        });
      }
      return `memory://documents/${encodeURIComponent(params.id)}`;

    case 'search': {
      const searchParams = new URLSearchParams();
      if (params?.q) searchParams.set('q', params.q);
      if (params?.container) searchParams.set('container', params.container);
      if (params?.limit) searchParams.set('limit', params.limit);
      if (params?.mode) searchParams.set('mode', params.mode);
      const queryString = searchParams.toString();
      return queryString ? `memory://search?${queryString}` : 'memory://search';
    }

    case 'facts':
      if (!params?.containerTag) {
        throw new ValidationError('containerTag required for facts URI', {
          containerTag: ['containerTag parameter is required for facts URIs'],
        });
      }
      return `memory://facts/${encodeURIComponent(params.containerTag)}`;

    case 'stats':
      return 'memory://stats';

    default:
      throw new ValidationError(`Unknown resource type: ${type}`, {
        type: [`Invalid resource type '${type}'. Valid types: profiles, documents, search, facts, stats`],
      });
  }
}

// ============================================================================
// Resource Response Types
// ============================================================================

export interface ProfileResource {
  uri: string;
  containerTag: string;
  staticFacts: Array<{
    id: string;
    content: string;
    category?: string;
    confidence: number;
    extractedAt: string;
  }>;
  dynamicFacts: Array<{
    id: string;
    content: string;
    category?: string;
    expiresAt?: string;
    extractedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface DocumentResource {
  uri: string;
  id: string;
  title?: string;
  content: string;
  contentType: string;
  containerTag?: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResource {
  uri: string;
  query: string;
  results: Array<{
    id: string;
    content: string;
    similarity: number;
    containerTag?: string;
    metadata?: Record<string, unknown>;
  }>;
  totalCount: number;
  searchTimeMs: number;
}

export interface FactsResource {
  uri: string;
  containerTag: string;
  facts: Array<{
    id: string;
    content: string;
    type: 'static' | 'dynamic';
    category?: string;
    confidence: number;
    createdAt: string;
    expiresAt?: string;
  }>;
  totalCount: number;
}

export interface StatsResource {
  uri: string;
  totalDocuments: number;
  totalMemories: number;
  totalFacts: number;
  containerTags: string[];
  indexedVectors: number;
  lastUpdated: string;
}

// ============================================================================
// Resource List Response
// ============================================================================

export interface ResourceListItem {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * Generate a list of available resources for a given state
 */
export function generateResourceList(
  containerTags: string[],
  documentIds: string[]
): ResourceListItem[] {
  const resources: ResourceListItem[] = [];

  // Add stats resource
  resources.push({
    uri: 'memory://stats',
    name: 'Supermemory Statistics',
    description: 'Overall statistics and health of the memory system',
    mimeType: 'application/json',
  });

  // Add search resource
  resources.push({
    uri: 'memory://search',
    name: 'Search Memories',
    description: 'Search through stored memories (add ?q=query to search)',
    mimeType: 'application/json',
  });

  // Add profile resources for each container
  for (const tag of containerTags) {
    resources.push({
      uri: buildResourceUri('profile', { containerTag: tag }),
      name: `Profile: ${tag}`,
      description: `User profile and facts for container "${tag}"`,
      mimeType: 'application/json',
    });

    resources.push({
      uri: buildResourceUri('facts', { containerTag: tag }),
      name: `Facts: ${tag}`,
      description: `All facts for container "${tag}"`,
      mimeType: 'application/json',
    });
  }

  // Add document resources (limit to first 50 to avoid overwhelming response)
  for (const id of documentIds.slice(0, 50)) {
    resources.push({
      uri: buildResourceUri('document', { id }),
      name: `Document: ${id}`,
      mimeType: 'application/json',
    });
  }

  return resources;
}
