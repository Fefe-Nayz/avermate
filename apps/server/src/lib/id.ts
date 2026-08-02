import { customAlphabet } from "nanoid";

/**
 * Prefixed, URL-safe ids. The prefix is worth the three characters: an id in a
 * log line or an error report says what it points at without a lookup.
 */
const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const generate = customAlphabet(alphabet, 24);

export function newId(prefix: string, size = 16): string {
  return `${prefix}_${generate(size)}`;
}
