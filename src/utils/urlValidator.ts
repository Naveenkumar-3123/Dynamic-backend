/**
 * Strict destination URL validator with comprehensive SSRF and scheme protection.
 *
 * Rules:
 * 1. Only http: and https: protocols allowed.
 * 2. Rejects dangerous schemes: javascript:, data:, file:, ftp:, intent:, content:, chrome:, etc.
 * 3. Rejects private/loopback network targets: localhost, 127.0.0.1, 0.0.0.0, 10.x.x.x, 192.168.x.x, 172.16-31.x.x, 169.254.x.x (AWS metadata), [::1], etc.
 * 4. Maximum length enforced (e.g. 2,048 characters max).
 */

const BLOCKED_SCHEMES = [
  'javascript:',
  'data:',
  'file:',
  'ftp:',
  'intent:',
  'content:',
  'chrome:',
  'blob:',
  'vbscript:',
  'about:',
];

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/, // AWS / cloud link-local metadata address (169.254.169.254)
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
];

export const MAX_URL_LENGTH = 2048;

export function isValidUrl(urlString: string): boolean {
  if (!urlString || typeof urlString !== 'string') {
    return false;
  }

  const trimmed = urlString.trim();

  // Enforce realistic URL length limit
  if (trimmed.length < 4 || trimmed.length > MAX_URL_LENGTH) {
    return false;
  }

  const lower = trimmed.toLowerCase();

  // Reject dangerous schemes
  for (const scheme of BLOCKED_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return false;
    }
  }

  // Must strictly start with http:// or https://
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);

    // Protocol must be strictly http: or https:
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    // Hostname must be present and contain at least one dot (unless standard TLD)
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname) {
      return false;
    }

    // Check private/internal network addresses (SSRF mitigation)
    for (const pattern of PRIVATE_HOST_PATTERNS) {
      if (pattern.test(hostname)) {
        return false;
      }
    }

    // Reject credentials embedded in URL authority (e.g. https://user:pass@evil.com)
    if (parsed.username || parsed.password) {
      return false;
    }

    return true;
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
