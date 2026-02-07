import { randomUUID } from 'node:crypto';

/**
 * Generate a unique ID using crypto for better randomness
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Generate a UUID v4 using Node.js crypto module
 */
export function generateUUID(): string {
  return randomUUID();
}
