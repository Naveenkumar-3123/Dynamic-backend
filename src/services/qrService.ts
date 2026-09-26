import crypto from 'crypto';
import { query } from '../db/pool';
import { generateShortCode } from '../utils/shortCode';
import { isValidUrl, sanitizeUrl, MAX_URL_LENGTH } from '../utils/urlValidator';

export interface DynamicQRRecord {
  id: string;
  shortCode: string;
  destinationUrl: string;
  scanCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  dynamicUrl: string;
  secretKey?: string; // Only returned on creation or with valid authorization
}

export interface CreateQRResult {
  id: string;
  shortCode: string;
  destinationUrl: string;
  dynamicUrl: string;
  secretKey: string;
}

export type RedirectResult =
  | { status: 'ACTIVE'; destinationUrl: string }
  | { status: 'NOT_FOUND' }
  | { status: 'DISABLED' };

function getBaseUrl(): string {
  if (process.env.BASE_URL && !process.env.BASE_URL.includes('localhost')) {
    const url = process.env.BASE_URL;
    return url.endsWith('/') ? url.slice(0, -1) : url;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.BASE_URL) {
    const url = process.env.BASE_URL;
    return url.endsWith('/') ? url.slice(0, -1) : url;
  }
  return 'https://dynamic-backend-red.vercel.app';
}

function generateSecretKey(): string {
  return crypto.randomBytes(24).toString('hex'); // 48-char high-entropy secret
}

function mapRowToRecord(row: any, includeSecret = false): DynamicQRRecord {
  const record: DynamicQRRecord = {
    id: row.id,
    shortCode: row.short_code,
    destinationUrl: row.destination_url,
    scanCount: Number(row.scan_count || 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    dynamicUrl: `${getBaseUrl()}/q/${row.short_code}`,
  };

  if (includeSecret && row.secret_key) {
    record.secretKey = row.secret_key;
  }

  return record;
}

/**
 * Creates a new dynamic QR entry.
 * Generates an unguessable 48-char secretKey for owner authorization.
 */
export async function createDynamicQR(destinationUrl: string): Promise<CreateQRResult> {
  const cleanUrl = sanitizeUrl(destinationUrl);
  if (!isValidUrl(cleanUrl)) {
    throw new Error('Invalid destination URL. Only public http:// and https:// URLs are allowed.');
  }

  const id = crypto.randomUUID();
  const secretKey = generateSecretKey();
  let shortCode = '';
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    shortCode = generateShortCode(6);
    try {
      const sql = `
        INSERT INTO dynamic_qrs (
          id, short_code, destination_url, secret_key, scan_count, is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 0, TRUE, NOW(), NOW())
        RETURNING *
      `;
      const result = await query(sql, [id, shortCode, cleanUrl, secretKey]);
      const row = result.rows[0];

      return {
        id: row.id,
        shortCode: row.short_code,
        destinationUrl: row.destination_url,
        dynamicUrl: `${getBaseUrl()}/q/${row.short_code}`,
        secretKey: row.secret_key || secretKey,
      };
    } catch (err: any) {
      if (err.code === '23505' || String(err.message).includes('unique')) {
        attempts++;
        continue;
      }
      throw err;
    }
  }

  throw new Error('Failed to generate a unique short code. Please try again.');
}

/**
 * Retrieves dynamic QR details by short code. Publicly viewable without secret.
 */
export async function getByShortCode(shortCode: string): Promise<DynamicQRRecord | null> {
  if (!shortCode || shortCode.length > 20) return null;

  const sql = `
    SELECT id, short_code, destination_url, scan_count, is_active, created_at, updated_at
    FROM dynamic_qrs
    WHERE short_code = $1
    LIMIT 1
  `;
  const result = await query(sql, [shortCode]);
  if (!result.rows || result.rows.length === 0) {
    return null;
  }
  return mapRowToRecord(result.rows[0], false);
}

/**
 * Validates ownership using secret_key.
 * If record has no secret_key (legacy V1 item), permits update/disable for seamless upgrade.
 */
async function verifyOwnership(shortCode: string, providedSecret?: string): Promise<boolean> {
  const sql = `SELECT secret_key FROM dynamic_qrs WHERE short_code = $1 LIMIT 1`;
  const result = await query(sql, [shortCode]);
  if (!result.rows || result.rows.length === 0) {
    return false;
  }
  const expectedSecret = result.rows[0].secret_key;

  // If record has no secret_key set (backward compatibility), allow legacy modification
  if (!expectedSecret) {
    return true;
  }

  if (!providedSecret) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  const bufA = Buffer.from(providedSecret);
  const bufB = Buffer.from(expectedSecret);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Updates the destination URL while keeping the short code completely identical.
 * Requires secretKey authorization.
 */
export async function updateDestinationUrl(
  shortCode: string,
  newDestinationUrl: string,
  secretKey?: string
): Promise<{ success: boolean; record?: DynamicQRRecord; reason?: 'NOT_FOUND' | 'UNAUTHORIZED' | 'INVALID_URL' }> {
  if (!shortCode || shortCode.length > 20) {
    return { success: false, reason: 'NOT_FOUND' };
  }

  const cleanUrl = sanitizeUrl(newDestinationUrl);
  if (!isValidUrl(cleanUrl)) {
    return { success: false, reason: 'INVALID_URL' };
  }

  const isOwner = await verifyOwnership(shortCode, secretKey);
  if (!isOwner) {
    return { success: false, reason: 'UNAUTHORIZED' };
  }

  const sql = `
    UPDATE dynamic_qrs
    SET destination_url = $1, updated_at = NOW()
    WHERE short_code = $2
    RETURNING *
  `;
  const result = await query(sql, [cleanUrl, shortCode]);
  if (!result.rows || result.rows.length === 0) {
    return { success: false, reason: 'NOT_FOUND' };
  }

  return { success: true, record: mapRowToRecord(result.rows[0], true) };
}

/**
 * Soft-disables a dynamic QR code without deleting the record.
 * Requires secretKey authorization.
 */
export async function disableDynamicQR(
  shortCode: string,
  secretKey?: string
): Promise<{ success: boolean; record?: DynamicQRRecord; reason?: 'NOT_FOUND' | 'UNAUTHORIZED' }> {
  if (!shortCode || shortCode.length > 20) {
    return { success: false, reason: 'NOT_FOUND' };
  }

  const isOwner = await verifyOwnership(shortCode, secretKey);
  if (!isOwner) {
    return { success: false, reason: 'UNAUTHORIZED' };
  }

  const sql = `
    UPDATE dynamic_qrs
    SET is_active = FALSE, updated_at = NOW()
    WHERE short_code = $1
    RETURNING *
  `;
  const result = await query(sql, [shortCode]);
  if (!result.rows || result.rows.length === 0) {
    return { success: false, reason: 'NOT_FOUND' };
  }

  return { success: true, record: mapRowToRecord(result.rows[0], true) };
}

/**
 * Handles QR redirect lookup and non-blocking atomic scan counter increment.
 */
export async function handleRedirect(shortCode: string): Promise<RedirectResult> {
  if (!shortCode || shortCode.length > 20) {
    return { status: 'NOT_FOUND' };
  }

  const sql = `
    SELECT destination_url, is_active
    FROM dynamic_qrs
    WHERE short_code = $1
    LIMIT 1
  `;
  const result = await query(sql, [shortCode]);

  if (!result.rows || result.rows.length === 0) {
    return { status: 'NOT_FOUND' };
  }

  const record = result.rows[0];

  if (!record.is_active) {
    return { status: 'DISABLED' };
  }

  // Atomic non-blocking scan counter update in PostgreSQL.
  // CRITICAL RULE: Counter failure MUST NEVER block user redirection.
  query(
    'UPDATE dynamic_qrs SET scan_count = scan_count + 1 WHERE short_code = $1',
    [shortCode]
  ).catch((err) => {
    console.error(`[Metrics] Failed to increment scan count for ${shortCode}:`, err.message);
  });

  return {
    status: 'ACTIVE',
    destinationUrl: record.destination_url,
  };
}
