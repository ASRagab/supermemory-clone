/**
 * Shared Heuristic Classification Utilities
 *
 * Provides a single source of truth for memory type pattern matching.
 */

import type { MemoryType } from '../../types/index.js';

// ============================================================================
// Memory Type Classification Patterns
// ============================================================================

const FACT_PATTERNS: readonly RegExp[] = [
  /\b(?:is|are|was|were|has|have|had)\b/i,
  /\b(?:born|died|founded|created|invented)\b/i,
  /\b(?:located|situated|found)\s+(?:in|at|on)\b/i,
  /\b(?:equals|means|represents)\b/i,
];

const EVENT_PATTERNS: readonly RegExp[] = [
  /\b(?:happened|occurred|took place)\b/i,
  /\b(?:yesterday|today|tomorrow|last|next)\s+(?:week|month|year|day)\b/i,
  /\b(?:on|at)\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/i,
  /\b(?:meeting|conference|event|party|celebration)\b/i,
];

const PREFERENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:prefer|like|love|enjoy|hate|dislike)\b/i,
  /\b(?:favorite|favourite|best|worst)\b/i,
  /\b(?:want|wish|hope|desire)\b/i,
  /\b(?:always|never|usually|often)\s+(?:use|choose|pick|select)\b/i,
];

const SKILL_PATTERNS: readonly RegExp[] = [
  /\b(?:know|learn|understand|master)\s+(?:how to|to)\b/i,
  /\b(?:can|able to|capable of)\b/i,
  /\b(?:expert|proficient|skilled|experienced)\s+(?:in|at|with)\b/i,
  /\b(?:programming|coding|developing|designing)\b/i,
];

const RELATIONSHIP_PATTERNS: readonly RegExp[] = [
  /\b(?:married|engaged|dating|friends with)\b/i,
  /\b(?:works|worked)\s+(?:for|with|at)\b/i,
  /\b(?:brother|sister|mother|father|parent|child|spouse)\b/i,
  /\b(?:colleague|teammate|partner|boss|manager)\b/i,
];

const CONTEXT_PATTERNS: readonly RegExp[] = [
  /\b(?:currently|right now|at the moment)\b/i,
  /\b(?:working on|thinking about|planning)\b/i,
  /\b(?:in the context of|regarding|about)\b/i,
  /\b(?:situation|scenario|case)\b/i,
];

const NOTE_PATTERNS: readonly RegExp[] = [
  /^(?:note|reminder|todo|remember)\s*:/i,
  /\b(?:don't forget|keep in mind|note that)\b/i,
  /^#|^\*|^-\s/m,
  /\b(?:important|key|critical)\s+(?:point|note|fact)\b/i,
];

export const MEMORY_TYPE_PATTERNS: Record<MemoryType, readonly RegExp[]> = {
  fact: FACT_PATTERNS,
  event: EVENT_PATTERNS,
  preference: PREFERENCE_PATTERNS,
  skill: SKILL_PATTERNS,
  relationship: RELATIONSHIP_PATTERNS,
  context: CONTEXT_PATTERNS,
  note: NOTE_PATTERNS,
};

// ============================================================================
// Heuristic Helpers
// ============================================================================

export function getMemoryTypeScores(content: string): Record<MemoryType, number> {
  const scores: Record<MemoryType, number> = {
    fact: 0,
    event: 0,
    preference: 0,
    skill: 0,
    relationship: 0,
    context: 0,
    note: 0,
  };

  for (const [type, patterns] of Object.entries(MEMORY_TYPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        scores[type as MemoryType] += 1;
      }
    }
  }

  return scores;
}

export function classifyMemoryTypeHeuristically(content: string): {
  type: MemoryType;
  matchCount: number;
  scores: Record<MemoryType, number>;
} {
  const scores = getMemoryTypeScores(content);
  const maxScore = Math.max(...Object.values(scores));

  if (maxScore === 0) {
    return { type: 'note', matchCount: 0, scores };
  }

  const matchedType = Object.entries(scores).find(([_, score]) => score === maxScore);
  return {
    type: (matchedType?.[0] as MemoryType) || 'note',
    matchCount: maxScore,
    scores,
  };
}

export function countMemoryTypeMatches(content: string, type: MemoryType): number {
  const patterns = MEMORY_TYPE_PATTERNS[type] || [];
  let matchCount = 0;
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      matchCount += 1;
    }
  }
  return matchCount;
}

export function calculateHeuristicConfidence(
  matchCount: number,
  options: {
    base?: number;
    perMatch?: number;
    max?: number;
    defaultConfidence?: number;
  } = {}
): number {
  const base = options.base ?? 0.5;
  const perMatch = options.perMatch ?? 0.1;
  const max = options.max ?? 0.9;
  const defaultConfidence = options.defaultConfidence ?? 0.3;

  if (matchCount <= 0) {
    return defaultConfidence;
  }

  return Math.min(base + matchCount * perMatch, max);
}
