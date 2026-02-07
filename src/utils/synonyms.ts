/**
 * Shared Synonym and Query Expansion Utilities
 *
 * Provides centralized synonym mappings and abbreviation expansions
 * for use across search and profile services.
 */

/**
 * Common action/verb synonyms for query expansion.
 * Keys are the base term, values are arrays of synonyms.
 */
export const ACTION_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  create: ['make', 'build', 'generate', 'construct', 'establish'],
  delete: ['remove', 'destroy', 'erase', 'eliminate', 'clear'],
  update: ['modify', 'change', 'edit', 'revise', 'alter'],
  search: ['find', 'look', 'query', 'seek', 'locate'],
  get: ['retrieve', 'fetch', 'obtain', 'acquire', 'access'],
  list: ['show', 'display', 'enumerate', 'view', 'browse'],
  error: ['bug', 'issue', 'problem', 'fault', 'defect'],
  fix: ['solve', 'resolve', 'repair', 'correct', 'patch'],
  add: ['insert', 'append', 'include', 'attach', 'incorporate'],
  start: ['begin', 'launch', 'initiate', 'commence', 'activate'],
  stop: ['end', 'halt', 'terminate', 'cease', 'pause'],
  send: ['transmit', 'dispatch', 'deliver', 'forward', 'submit'],
} as const;

/**
 * Common technical abbreviations with their full forms.
 * Used for expanding abbreviated terms in queries.
 */
export const ABBREVIATION_EXPANSIONS: Readonly<Record<string, string>> = {
  api: 'application programming interface',
  db: 'database',
  auth: 'authentication',
  config: 'configuration',
  env: 'environment',
  var: 'variable',
  func: 'function',
  impl: 'implementation',
  repo: 'repository',
  deps: 'dependencies',
  pkg: 'package',
  src: 'source',
  lib: 'library',
  util: 'utility',
  req: 'request',
  res: 'response',
  msg: 'message',
  err: 'error',
  doc: 'document',
  docs: 'documentation',
  dev: 'development',
  prod: 'production',
  ui: 'user interface',
  ux: 'user experience',
} as const;

/**
 * Options for query expansion
 */
export interface QueryExpansionOptions {
  /** Include synonym expansions (default: true) */
  includeSynonyms?: boolean;
  /** Expand abbreviations (default: true) */
  expandAbbreviations?: boolean;
  /** Maximum synonyms to include per term (default: 2) */
  maxSynonymsPerTerm?: number;
  /** Custom synonym mappings to merge with defaults */
  customSynonyms?: Record<string, string[]>;
  /** Custom abbreviation expansions to merge with defaults */
  customAbbreviations?: Record<string, string>;
}

/**
 * Get synonyms for a given term.
 *
 * @param term - The term to find synonyms for (case-insensitive)
 * @param limit - Maximum number of synonyms to return (default: all)
 * @param customSynonyms - Additional synonyms to check
 * @returns Array of synonyms, empty if none found
 *
 * @example
 * ```typescript
 * getSynonyms('create'); // ['make', 'build', 'generate', ...]
 * getSynonyms('create', 2); // ['make', 'build']
 * ```
 */
export function getSynonyms(
  term: string,
  limit?: number,
  customSynonyms?: Record<string, string[]>
): string[] {
  const lowerTerm = term.toLowerCase();
  const allSynonyms = { ...ACTION_SYNONYMS, ...customSynonyms };
  const synonyms = allSynonyms[lowerTerm];

  if (!synonyms) {
    return [];
  }

  return limit !== undefined ? [...synonyms].slice(0, limit) : [...synonyms];
}

/**
 * Expand an abbreviation to its full form.
 *
 * @param abbreviation - The abbreviation to expand (case-insensitive)
 * @param customAbbreviations - Additional abbreviations to check
 * @returns The expanded form, or undefined if not found
 *
 * @example
 * ```typescript
 * expandAbbreviation('api'); // 'application programming interface'
 * expandAbbreviation('unknown'); // undefined
 * ```
 */
export function expandAbbreviation(
  abbreviation: string,
  customAbbreviations?: Record<string, string>
): string | undefined {
  const lowerAbbr = abbreviation.toLowerCase();
  const allAbbreviations = { ...ABBREVIATION_EXPANSIONS, ...customAbbreviations };
  return allAbbreviations[lowerAbbr];
}

/**
 * Expand a query by adding synonyms and expanding abbreviations.
 *
 * @param query - The original query string
 * @param options - Expansion options
 * @returns Expanded query string with additional terms
 *
 * @example
 * ```typescript
 * expandQuery('create api'); // 'create api make build application programming interface'
 * expandQuery('fix db error', { maxSynonymsPerTerm: 1 }); // 'fix db error solve database bug'
 * ```
 */
export function expandQuery(query: string, options: QueryExpansionOptions = {}): string {
  const {
    includeSynonyms = true,
    expandAbbreviations = true,
    maxSynonymsPerTerm = 2,
    customSynonyms,
    customAbbreviations,
  } = options;

  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const expanded: string[] = [...tokens];

  if (includeSynonyms) {
    for (const token of tokens) {
      const synonyms = getSynonyms(token, maxSynonymsPerTerm, customSynonyms);
      expanded.push(...synonyms);
    }
  }

  if (expandAbbreviations) {
    for (const token of tokens) {
      const expansion = expandAbbreviation(token, customAbbreviations);
      if (expansion) {
        expanded.push(expansion);
      }
    }
  }

  // Remove duplicates and return
  return [...new Set(expanded)].join(' ');
}

/**
 * Check if a term has known synonyms.
 *
 * @param term - The term to check
 * @returns True if synonyms exist for this term
 */
export function hasSynonyms(term: string): boolean {
  return term.toLowerCase() in ACTION_SYNONYMS;
}

/**
 * Check if a term is a known abbreviation.
 *
 * @param term - The term to check
 * @returns True if this is a known abbreviation
 */
export function isAbbreviation(term: string): boolean {
  return term.toLowerCase() in ABBREVIATION_EXPANSIONS;
}
