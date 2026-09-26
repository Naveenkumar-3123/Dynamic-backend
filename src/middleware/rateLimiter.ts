import { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message: string;
}

interface ClientRecord {
  count: number;
  resetTime: number;
}

// Memory store for tracking IP requests with automatic eviction
const ipStore = new Map<string, ClientRecord>();

// Periodic garbage collection every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of ipStore.entries()) {
    if (now > record.resetTime) {
      ipStore.delete(key);
    }
  }
}, 60000).unref();

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown-client';
}

/**
 * Creates an in-memory rate limiting middleware with standard headers.
 */
export function createRateLimiter(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = getClientIp(req);
    const key = `${req.baseUrl || ''}:${req.path}:${ip}`;
    const now = Date.now();

    let record = ipStore.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + options.windowMs,
      };
      ipStore.set(key, record);
    } else {
      record.count++;
    }

    const remaining = Math.max(0, options.max - record.count);
    const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader('X-RateLimit-Limit', options.max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > options.max) {
      res.setHeader('Retry-After', retryAfterSeconds);
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: options.message,
          retryAfter: retryAfterSeconds,
        },
      });
      return;
    }

    next();
  };
}

/**
 * Limit for creating new Dynamic QRs (e.g. max 30 per 15 minutes per IP)
 */
export const qrCreationLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many Dynamic QR codes created from this IP. Please try again later.',
});

/**
 * Limit for modifying existing Dynamic QRs (e.g. max 30 updates per 15 minutes per IP)
 */
export const qrManagementLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many update/disable requests. Please wait a moment and try again.',
});

/**
 * Generous limit for scanning/redirecting QRs (e.g. max 1,000 per 1 minute per IP)
 * Legitimate QR codes may experience surges; scans should not be blocked aggressively.
 */
export const redirectLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 1000,
  message: 'Too many redirects requested. Please try again shortly.',
});

/**
 * Standard API read limiter (e.g. max 120 reads per minute per IP)
 */
export const apiReadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many API requests. Please slow down.',
});
