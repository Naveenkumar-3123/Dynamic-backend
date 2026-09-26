/**
 * Validates that a string is a well-formed HTTP or HTTPS URL.
 * Rejects javascript:, file:, data:, and malformed inputs.
 *
 * @param urlString The candidate destination URL
 * @returns boolean true if valid http/https URL, false otherwise
 */
export function isValidUrl(urlString: string): boolean {
  if (!urlString || typeof urlString !== 'string') {
    return false;
  }

  const trimmed = urlString.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalizes destination URL by trimming whitespace.
 */
export function sanitizeUrl(urlString: string): string {
  return urlString.trim();
}
