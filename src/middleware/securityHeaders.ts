import { Request, Response, NextFunction } from 'express';

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking / frame embedding
  res.setHeader('X-Frame-Options', 'DENY');

  // Strict Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Basic Content Security Policy for redirect & error HTML pages
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
  );

  // Cross-Origin policies
  res.setHeader('X-XSS-Protection', '0'); // Modern best practice: disable buggy legacy browser XSS filters in favor of CSP

  // Disable cache on API endpoints to prevent stale authorization/states
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  next();
}
