/**
 * Relationship Detection Helper Functions
 *
 * This file has been simplified to contain only the core helper functions.
 * The strategy pattern has been removed as it was over-engineered - all access
 * went through HybridStrategy which internally called 3 strategies.
 *
 * The detection logic has been inlined directly into EmbeddingRelationshipDetector
 * as private methods, reducing complexity by ~400 LOC.
 */

import type { RelationshipType } from '../../types/index.js';
import type { Memory, Relationship } from '../memory.types.js';
import { generateId } from '../../utils/id.js';
import type { DetectedRelationship, RelationshipCandidate, DetectionStrategyType } from './types.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a detected relationship object
 */
export function createDetectedRelationship(
  sourceMemory: Memory,
  targetMemory: Memory,
  type: RelationshipType,
  candidate: RelationshipCandidate,
  strategy: string,
  llmVerified: boolean = false,
  llmConfidence?: number
): DetectedRelationship {
  // Validate and cast strategy to DetectionStrategyType
  const validStrategy: DetectionStrategyType =
    strategy === 'similarity' ||
    strategy === 'temporal' ||
    strategy === 'entityOverlap' ||
    strategy === 'llmVerification' ||
    strategy === 'hybrid'
      ? strategy
      : 'hybrid';

  const relationship: Relationship = {
    id: generateId(),
    sourceMemoryId: sourceMemory.id,
    targetMemoryId: targetMemory.id,
    type,
    confidence: candidate.combinedScore,
    description: `${type} relationship detected via ${strategy} strategy`,
    createdAt: new Date(),
    metadata: {
      vectorSimilarity: candidate.vectorSimilarity,
      entityOverlap: candidate.entityOverlap,
      temporalScore: candidate.temporalScore,
      detectionStrategy: strategy,
    },
  };

  return {
    relationship,
    score: candidate.combinedScore,
    vectorSimilarity: candidate.vectorSimilarity,
    entityOverlap: candidate.entityOverlap,
    temporalScore: candidate.temporalScore,
    llmVerified,
    llmConfidence,
    detectionStrategy: validStrategy,
  };
}

/**
 * Check if content contains update/correction indicators
 */
export function hasUpdateIndicators(content: string): boolean {
  const patterns = [
    /\b(?:update|updated|updating|correction|corrected)\b/i,
    /\b(?:now|actually|instead)\b/i,
    /\b(?:changed|revised|modified)\b/i,
    /\b(?:no longer|used to be|previously)\b/i,
  ];
  return patterns.some((p) => p.test(content));
}

/**
 * Check if content contains extension indicators
 */
export function hasExtensionIndicators(content: string): boolean {
  const patterns = [
    /\b(?:also|additionally|furthermore|moreover)\b/i,
    /\b(?:in addition|on top of|besides)\b/i,
    /\b(?:extending|building on|adding to)\b/i,
  ];
  return patterns.some((p) => p.test(content));
}

/**
 * Check if content contains contradiction indicators
 */
export function hasContradictionIndicators(content: string): boolean {
  const patterns = [
    /\b(?:however|but|although|despite)\b/i,
    /\b(?:contrary|opposite|different)\b/i,
    /\b(?:not true|incorrect|wrong|false)\b/i,
    /\b(?:disagree|dispute|reject)\b/i,
  ];
  return patterns.some((p) => p.test(content));
}

/**
 * Check if content contains supersession indicators
 */
export function hasSupersessionIndicators(content: string): boolean {
  const patterns = [
    /\b(?:replaces|supersedes|overrides)\b/i,
    /\b(?:no longer|obsolete|deprecated)\b/i,
    /\b(?:new version|latest|current)\b/i,
  ];
  return patterns.some((p) => p.test(content));
}

/**
 * Check if content contains causal/derivation indicators
 */
export function hasCausalIndicators(content: string): boolean {
  const patterns = [
    /\b(?:therefore|thus|hence|consequently)\b/i,
    /\b(?:because|since|as a result)\b/i,
    /\b(?:based on|derived from|follows from)\b/i,
    /\b(?:leads to|results in|causes)\b/i,
  ];
  return patterns.some((p) => p.test(content));
}
