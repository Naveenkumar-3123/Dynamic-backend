import crypto from 'crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const DEFAULT_LENGTH = 6;

/**
 * Generates a cryptographically secure random short code.
 * Uses an unambiguous alphanumeric alphabet (avoids 0, O, 1, I, l).
 *
 * @param length Length of the generated code (default: 6)
 * @returns Short alphanumeric string (e.g. "A7K92P")
 */
export function generateShortCode(length: number = DEFAULT_LENGTH): string {
  const bytes = crypto.randomBytes(length);
  let result = '';
  const alphabetLength = ALPHABET.length;

  for (let i = 0; i < length; i++) {
    result += ALPHABET[bytes[i] % alphabetLength];
  }

  return result;
}
