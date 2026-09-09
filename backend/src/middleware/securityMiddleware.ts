import { Request, Response, NextFunction } from 'express';

// In-memory sliding window rate limiter (no Redis dependency required for lightweight prototype deployment)
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

/**
 * Configurable IP Rate Limiter to guard against brute-force and DDoS
 */
export function rateLimiter(maxRequests: number = 100, windowMs: number = 60000) {
  return (req: Request, res: Response, next: NextFunction) => {
    // In production behind a proxy (like Nginx, Cloudflare, AWS ALB), trust X-Forwarded-For
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown-ip';
    const key = `${req.baseUrl || req.path}:${clientIp}`;
    const now = Date.now();

    let record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      rateLimitStore.set(key, record);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
      res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));
      return next();
    }

    record.count++;
    const remaining = Math.max(0, maxRequests - record.count);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > maxRequests) {
      const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Statutory rate limit exceeded. Please retry in ${retryAfterSec} seconds.`,
      });
    }

    next();
  };
}

/**
 * Standard Security Headers Middleware
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/**
 * Production Error Sanitizer Middleware:
 * Masks internal database structures, stack traces, and private paths in production.
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const correlationId = `ERR-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  
  // Safe console log for server administrators
  console.error(`[${correlationId}] Internal Server Error:`, err.message || err);

  const isProduction = process.env.NODE_ENV === 'production';

  res.status(err.status || 500).json({
    error: isProduction ? 'An unexpected service error occurred. Please contact the administrator with correlation ID.' : (err.message || 'Internal Server Error'),
    correlationId,
    timestamp: new Date().toISOString(),
  });
}
