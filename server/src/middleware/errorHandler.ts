import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { sendError } from '../utils/response.js';
import { config } from '../config/index.js';

// ── Custom HTTP Error Classes ────────────────────────────────────

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Resource not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request') {
    super(400, message);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(401, message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

// ── Unified Error Handler Middleware ─────────────────────────────

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
// 1. Handle Zod Validation Errors (400)
  if (err instanceof ZodError) {
    const errorDetails = err.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    return sendError(res, `Validation failed: ${errorDetails}`, 400, {
      issues: err.issues,
    });
  }

  // 2. Handle Custom HttpError (404, 400, 401, 403, etc.)
  if (err instanceof Error && 'statusCode' in err && typeof (err as { statusCode: unknown }).statusCode === 'number') {
    const status = (err as { statusCode: number }).statusCode;
    if (status < 500) {
      return sendError(res, err.message, status);
    }
  }

  console.error('❌ [API Error Handler]:', err);

  // 3. Handle standard Error instances
  if (err instanceof Error) {
    // CORS errors
    if (err.message.includes('CORS')) {
      return sendError(res, err.message, 403);
    }

    // Database Duplicate Key Errors (MySQL code: ER_DUP_ENTRY / 1062)
    const driverErr = (err as any).cause || err;
    if (driverErr && typeof driverErr === 'object' && 'errno' in driverErr && (driverErr as { errno: number }).errno === 1062) {
      return sendError(res, 'A record with this identifier or slug already exists.', 409);
    }

    // Generic error message
    const message = config.nodeEnv === 'production' ? 'Internal server error' : err.message;
    return sendError(res, message, 500);
  }

  // 4. Fallback for non-standard error types
  return sendError(res, 'An unexpected server error occurred.', 500);
}

// 5. 404 Route Not Found Handler
export function notFoundHandler(req: Request, res: Response) {
  return sendError(res, `API route not found: ${req.method} ${req.originalUrl}`, 404);
}
