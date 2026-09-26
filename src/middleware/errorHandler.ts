import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = err.statusCode || (err.type === 'entity.too.large' ? 413 : 500);

  // Safe structured logging - scrub any sensitive credentials
  const cleanUrl = req.originalUrl.split('?')[0];
  console.error(`[Error] ${req.method} ${cleanUrl} - Status: ${statusCode} - Msg: ${err.message || 'Unknown'}`);

  // Never leak internal database credentials, connection strings, or system paths
  let clientMessage = 'An unexpected error occurred. Please try again later.';
  let errorCode = 'INTERNAL_ERROR';

  if (statusCode === 413 || err.type === 'entity.too.large') {
    clientMessage = 'Payload too large. Request body exceeds the allowed size.';
    errorCode = 'PAYLOAD_TOO_LARGE';
  } else if (err.message && (
    err.message.includes('Invalid destination URL') ||
    err.message.includes('required') ||
    err.message.includes('Invalid')
  )) {
    clientMessage = err.message;
    errorCode = 'INVALID_INPUT';
  } else if (statusCode === 404) {
    clientMessage = err.message || 'Resource not found.';
    errorCode = 'NOT_FOUND';
  } else if (statusCode === 401 || statusCode === 403) {
    clientMessage = err.message || 'Unauthorized.';
    errorCode = 'UNAUTHORIZED';
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: clientMessage,
    },
  });
}
