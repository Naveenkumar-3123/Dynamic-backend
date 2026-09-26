import crypto from 'crypto';
import { query } from '../db/pool';
import { generateShortCode } from '../utils/shortCode';
import { isValidUrl, sanitizeUrl } from '../utils/urlValidator';

export interface DynamicQRRecord {
  id: string;
  shortCode: string;
  destinationUrl: string;
  scanCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  dynamicUrl: string;
}

export interface CreateQRResult {
  id: string;
  shortCode: string;
  destinationUrl: string;
  dynamicUrl: string;
}

export type RedirectResult =
  | { status: 'ACTIVE'; destinationUrl: string }
  | { status: 'NOT_FOUND' }
  | { status: 'DISABLED' };

function getBaseUrl(): string {
  const url = process.env.BASE_URL || 'http://localhost:3000';
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function mapRowToRecord(row: any): DynamicQRRecord {
  return {
    id: row.id,
    shortCode: row.short_code,
    destinationUrl: row.destination_url,
    scanCount: Number(row.scan_count || 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    dynamicUrl: `${getBaseUrl()}/q/${row.short_code}`,
  };
}

/**
 * Creates a new dynamic QR entry.
 * Generates a unique short code, writes to PostgreSQL, and returns response payload.
 */
export async function createDynamicQR(destinationUrl: string): Promise<CreateQRResult> {
  const cleanUrl = sanitizeUrl(destinationUrl);
  if (!isValidUrl(cleanUrl)) {
    throw new Error('Invalid destination URL. Only http:// and https:// URLs are allowed.');
  }

  const id = crypto.randomUUID();
  let shortCode = '';
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    shortCode = generateShortCode(6);
    try {
      const sql = `
        INSERT INTO dynamic_qrs (
          id, short_code, destination_url, scan_count, is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, 0, TRUE, NOW(), NOW())
        RETURNING *
      `;
      const result = await query(sql, [id, shortCode, cleanUrl]);
      const row = result.rows[0];

      return {
        id: row.id,
        shortCode: row.short_code,
        destinationUrl: row.destination_url,
        dynamicUrl: `${getBaseUrl()}/q/${row.short_code}`,
      };
    } catch (err: any) {
      // Check for unique collision on short_code
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
 * Retrieves dynamic QR details by short code.
 */
export async function getByShortCode(shortCode: string): Promise<DynamicQRRecord | null> {
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
  return mapRowToRecord(result.rows[0]);
}

/**
 * Updates the destination URL while keeping the short code completely identical.
 */
export async function updateDestinationUrl(
  shortCode: string,
  newDestinationUrl: string
): Promise<DynamicQRRecord | null> {
  const cleanUrl = sanitizeUrl(newDestinationUrl);
  if (!isValidUrl(cleanUrl)) {
    throw new Error('Invalid destination URL. Only http:// and https:// URLs are allowed.');
  }

  const sql = `
    UPDATE dynamic_qrs
    SET destination_url = $1, updated_at = NOW()
    WHERE short_code = $2
    RETURNING *
  `;
  const result = await query(sql, [cleanUrl, shortCode]);
  if (!result.rows || result.rows.length === 0) {
    return null;
  }
  return mapRowToRecord(result.rows[0]);
}

/**
 * Soft-disables a dynamic QR code without deleting the record.
 */
export async function disableDynamicQR(shortCode: string): Promise<DynamicQRRecord | null> {
  const sql = `
    UPDATE dynamic_qrs
    SET is_active = FALSE, updated_at = NOW()
    WHERE short_code = $1
    RETURNING *
  `;
  const result = await query(sql, [shortCode]);
  if (!result.rows || result.rows.length === 0) {
    return null;
  }
  return mapRowToRecord(result.rows[0]);
}

/**
 * Handles QR redirect lookup and non-blocking scan counter increment.
 */
export async function handleRedirect(shortCode: string): Promise<RedirectResult> {
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

  // Non-blocking asynchronous scan counter increment.
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
