/**
 * Input sanitization utilities for RELAY FAVOURS.
 *
 * Strips HTML tags, control characters, and enforces max length
 * to prevent XSS and oversized payloads.
 */

/**
 * Sanitize a user-provided string:
 * 1. Strip HTML tags
 * 2. Strip control characters (below 0x20) except \n (0x0A) and \t (0x09)
 * 3. Trim whitespace
 * 4. Enforce max length
 */
export function sanitizeInput(str: string, maxLen: number): string {
  if (typeof str !== "string") return "";

  // Strip HTML tags
  let cleaned = str.replace(/<[^>]*>/g, "");

  // Strip control characters below 0x20 except \n and \t
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

  // Trim whitespace
  cleaned = cleaned.trim();

  // Enforce max length
  if (cleaned.length > maxLen) {
    cleaned = cleaned.slice(0, maxLen);
  }

  return cleaned;
}
