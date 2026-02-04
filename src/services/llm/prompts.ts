/**
 * LLM Prompts for Memory Extraction and Relationship Detection
 *
 * Contains carefully crafted prompts with few-shot examples for accurate
 * memory extraction and classification.
 */

import type { MemoryType } from '../../types/index.js';

// ============================================================================
// Memory Extraction Prompts
// ============================================================================

/**
 * System prompt for memory extraction
 */
export const MEMORY_EXTRACTION_SYSTEM_PROMPT = `You are an expert memory extraction system. Your task is to extract discrete, standalone facts, preferences, skills, and episodic memories from text content.

For each extracted memory, you must:
1. Create a clear, standalone statement that makes sense without context
2. Classify it into the correct type
3. Assign a confidence score (0.0-1.0) based on clarity and reliability
4. Extract relevant entities (people, places, organizations, dates)
5. Identify key keywords

Memory Types:
- fact: Objective information, statements of truth, definitions
- event: Time-bound occurrences, meetings, experiences
- preference: Personal likes, dislikes, preferences, opinions
- skill: Abilities, capabilities, expertise, knowledge areas
- relationship: Interpersonal connections, social bonds
- context: Current situations, states, or ongoing activities
- note: General notes, reminders, todos

Guidelines:
- Each memory should be self-contained and understandable alone
- Be precise and avoid vague statements
- Include relevant context in the memory itself
- Higher confidence for explicit statements, lower for inferences
- Extract multiple memories from complex sentences`;

/**
 * Few-shot examples for memory extraction
 */
export const MEMORY_EXTRACTION_EXAMPLES = `
Example 1:
Input: "I've been using TypeScript for 3 years now and really prefer it over plain JavaScript. Currently working on a React project for my company Acme Inc."

Output:
{
  "memories": [
    {
      "content": "Has been using TypeScript for 3 years",
      "type": "skill",
      "confidence": 0.95,
      "entities": [{"name": "TypeScript", "type": "concept"}],
      "keywords": ["typescript", "programming", "experience"]
    },
    {
      "content": "Prefers TypeScript over plain JavaScript for development",
      "type": "preference",
      "confidence": 0.90,
      "entities": [{"name": "TypeScript", "type": "concept"}, {"name": "JavaScript", "type": "concept"}],
      "keywords": ["typescript", "javascript", "preference"]
    },
    {
      "content": "Currently working on a React project",
      "type": "context",
      "confidence": 0.85,
      "entities": [{"name": "React", "type": "concept"}],
      "keywords": ["react", "project", "current"]
    },
    {
      "content": "Works for Acme Inc.",
      "type": "relationship",
      "confidence": 0.90,
      "entities": [{"name": "Acme Inc.", "type": "organization"}],
      "keywords": ["employment", "company", "work"]
    }
  ]
}

Example 2:
Input: "Note: Remember to update the API docs before the Friday release. The authentication endpoint was changed last week."

Output:
{
  "memories": [
    {
      "content": "Need to update API docs before Friday release",
      "type": "note",
      "confidence": 0.85,
      "entities": [],
      "keywords": ["api", "documentation", "release", "friday"]
    },
    {
      "content": "Authentication endpoint was modified recently",
      "type": "event",
      "confidence": 0.90,
      "entities": [],
      "keywords": ["authentication", "endpoint", "change", "api"]
    }
  ]
}

Example 3:
Input: "Dr. Sarah Chen, my mentor at Stanford, taught me that clean code is more important than clever code."

Output:
{
  "memories": [
    {
      "content": "Dr. Sarah Chen is a mentor",
      "type": "relationship",
      "confidence": 0.95,
      "entities": [{"name": "Dr. Sarah Chen", "type": "person"}, {"name": "Stanford", "type": "organization"}],
      "keywords": ["mentor", "relationship"]
    },
    {
      "content": "Believes clean code is more important than clever code",
      "type": "preference",
      "confidence": 0.85,
      "entities": [],
      "keywords": ["clean code", "programming", "philosophy"]
    },
    {
      "content": "Has connection to Stanford",
      "type": "relationship",
      "confidence": 0.80,
      "entities": [{"name": "Stanford", "type": "organization"}],
      "keywords": ["stanford", "education"]
    }
  ]
}`;

/**
 * Generate the user prompt for memory extraction
 */
export function generateExtractionPrompt(
  text: string,
  options?: {
    containerTag?: string;
    context?: string;
    maxMemories?: number;
    minConfidence?: number;
  }
): string {
  let prompt = `Extract memories from the following text. Return a JSON object with a "memories" array.\n\n`;

  if (options?.containerTag) {
    prompt += `Container/Category: ${options.containerTag}\n`;
  }

  if (options?.context) {
    prompt += `Additional Context: ${options.context}\n`;
  }

  if (options?.maxMemories) {
    prompt += `Maximum memories to extract: ${options.maxMemories}\n`;
  }

  if (options?.minConfidence) {
    prompt += `Minimum confidence threshold: ${options.minConfidence}\n`;
  }

  prompt += `\nText to analyze:\n"""\n${text}\n"""\n\n`;
  prompt += `Respond with ONLY a valid JSON object in this exact format:
{
  "memories": [
    {
      "content": "string - standalone statement",
      "type": "fact|event|preference|skill|relationship|context|note",
      "confidence": 0.0-1.0,
      "entities": [{"name": "string", "type": "person|place|organization|date|concept|other"}],
      "keywords": ["string"]
    }
  ]
}`;

  return prompt;
}

// ============================================================================
// Relationship Detection Prompts
// ============================================================================

/**
 * System prompt for relationship detection
 */
export const RELATIONSHIP_DETECTION_SYSTEM_PROMPT = `You are an expert at detecting semantic relationships between pieces of information.

Given a NEW memory and a list of EXISTING memories, determine what relationships exist.

Relationship Types:
- updates: NEW contradicts or corrects OLD, making OLD outdated
- extends: NEW adds detail or elaboration to OLD without contradicting
- derives: NEW is a logical consequence or inference from OLD
- contradicts: NEW directly conflicts with OLD (both may be valid from different times)
- related: NEW is semantically similar or topically connected to OLD
- supersedes: NEW completely replaces OLD (OLD should be archived)

Guidelines:
- Only identify relationships with confidence >= 0.6
- "updates" and "supersedes" should mark the old memory for supersession
- "contradicts" does NOT mean the old memory should be removed (both may be valid)
- Consider temporal context when detecting updates
- Be conservative - prefer no relationship over a weak one`;

/**
 * Few-shot examples for relationship detection
 */
export const RELATIONSHIP_DETECTION_EXAMPLES = `
Example 1:
NEW Memory: { "id": "new1", "content": "Uses Python 3.11 for all projects", "type": "preference" }
EXISTING Memories: [
  { "id": "old1", "content": "Prefers Python 3.9", "type": "preference" },
  { "id": "old2", "content": "Expert in Python programming", "type": "skill" }
]

Output:
{
  "relationships": [
    {
      "sourceMemoryId": "new1",
      "targetMemoryId": "old1",
      "type": "updates",
      "confidence": 0.90,
      "reason": "New version preference supersedes old version preference"
    },
    {
      "sourceMemoryId": "new1",
      "targetMemoryId": "old2",
      "type": "related",
      "confidence": 0.75,
      "reason": "Both relate to Python programming"
    }
  ],
  "supersededMemoryIds": ["old1"]
}

Example 2:
NEW Memory: { "id": "new2", "content": "The API now supports batch operations", "type": "fact" }
EXISTING Memories: [
  { "id": "old3", "content": "The API only supports single-item operations", "type": "fact" },
  { "id": "old4", "content": "Working on adding batch support to the API", "type": "context" }
]

Output:
{
  "relationships": [
    {
      "sourceMemoryId": "new2",
      "targetMemoryId": "old3",
      "type": "supersedes",
      "confidence": 0.95,
      "reason": "New capability statement makes old limitation statement obsolete"
    },
    {
      "sourceMemoryId": "new2",
      "targetMemoryId": "old4",
      "type": "derives",
      "confidence": 0.85,
      "reason": "Batch support being complete is a result of the work mentioned"
    }
  ],
  "supersededMemoryIds": ["old3", "old4"]
}`;

/**
 * Generate the user prompt for relationship detection
 */
export function generateRelationshipPrompt(
  newMemory: { id: string; content: string; type: MemoryType },
  existingMemories: Array<{ id: string; content: string; type: MemoryType }>,
  options?: {
    maxRelationships?: number;
    minConfidence?: number;
  }
): string {
  let prompt = `Analyze the relationship between the NEW memory and EXISTING memories.\n\n`;

  prompt += `NEW Memory:\n${JSON.stringify(newMemory, null, 2)}\n\n`;
  prompt += `EXISTING Memories:\n${JSON.stringify(existingMemories, null, 2)}\n\n`;

  if (options?.minConfidence) {
    prompt += `Only include relationships with confidence >= ${options.minConfidence}\n`;
  }

  if (options?.maxRelationships) {
    prompt += `Return at most ${options.maxRelationships} relationships\n`;
  }

  prompt += `\nRespond with ONLY a valid JSON object in this exact format:
{
  "relationships": [
    {
      "sourceMemoryId": "string - always the NEW memory id",
      "targetMemoryId": "string - an EXISTING memory id",
      "type": "updates|extends|derives|contradicts|related|supersedes",
      "confidence": 0.0-1.0,
      "reason": "string - brief explanation"
    }
  ],
  "supersededMemoryIds": ["string - ids of memories that should be marked as outdated"]
}`;

  return prompt;
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse and validate extraction response from LLM
 */
export function parseExtractionResponse(response: string): {
  memories: Array<{
    content: string;
    type: MemoryType;
    confidence: number;
    entities: Array<{ name: string; type: string }>;
    keywords: string[];
  }>;
} {
  // Clean up response - remove markdown code blocks if present
  let cleaned = response.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);

    if (!parsed.memories || !Array.isArray(parsed.memories)) {
      throw new Error('Response missing memories array');
    }

    // Validate and clean each memory
    const validTypes: MemoryType[] = [
      'fact',
      'event',
      'preference',
      'skill',
      'relationship',
      'context',
      'note',
    ];

    const memories = parsed.memories
      .filter((m: unknown) => {
        if (!m || typeof m !== 'object') return false;
        const mem = m as Record<string, unknown>;
        return (
          typeof mem.content === 'string' &&
          mem.content.length > 0 &&
          typeof mem.type === 'string' &&
          validTypes.includes(mem.type as MemoryType)
        );
      })
      .map((m: Record<string, unknown>) => ({
        content: String(m.content).trim(),
        type: m.type as MemoryType,
        confidence: typeof m.confidence === 'number' ? Math.max(0, Math.min(1, m.confidence)) : 0.5,
        entities: Array.isArray(m.entities)
          ? m.entities.filter(
              (e: unknown) =>
                e && typeof e === 'object' && 'name' in (e as object) && 'type' in (e as object)
            )
          : [],
        keywords: Array.isArray(m.keywords)
          ? m.keywords.filter((k: unknown) => typeof k === 'string')
          : [],
      }));

    return { memories };
  } catch (error) {
    throw new Error(
      `Failed to parse extraction response: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Parse and validate relationship response from LLM
 */
export function parseRelationshipResponse(response: string): {
  relationships: Array<{
    sourceMemoryId: string;
    targetMemoryId: string;
    type: string;
    confidence: number;
    reason: string;
  }>;
  supersededMemoryIds: string[];
} {
  // Clean up response
  let cleaned = response.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);

    const validTypes = ['updates', 'extends', 'derives', 'contradicts', 'related', 'supersedes'];

    const relationships = Array.isArray(parsed.relationships)
      ? parsed.relationships
          .filter((r: unknown) => {
            if (!r || typeof r !== 'object') return false;
            const rel = r as Record<string, unknown>;
            return (
              typeof rel.sourceMemoryId === 'string' &&
              typeof rel.targetMemoryId === 'string' &&
              typeof rel.type === 'string' &&
              validTypes.includes(rel.type)
            );
          })
          .map((r: Record<string, unknown>) => ({
            sourceMemoryId: String(r.sourceMemoryId),
            targetMemoryId: String(r.targetMemoryId),
            type: String(r.type),
            confidence:
              typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0.5,
            reason: typeof r.reason === 'string' ? r.reason : 'No reason provided',
          }))
      : [];

    const supersededMemoryIds = Array.isArray(parsed.supersededMemoryIds)
      ? parsed.supersededMemoryIds.filter((id: unknown) => typeof id === 'string')
      : [];

    return { relationships, supersededMemoryIds };
  } catch (error) {
    throw new Error(
      `Failed to parse relationship response: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
