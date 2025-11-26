/**
 * Simple in-memory rate limiter
 * For production, use Redis or a dedicated rate limiting service
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Check if request should be rate limited
 * @param userId - User ID to rate limit
 * @param maxRequests - Maximum requests per window (default: 10)
 * @param windowMs - Time window in milliseconds (default: 60000 = 1 minute)
 * @returns true if rate limit exceeded, false otherwise
 */
export function isRateLimited(
  userId: string,
  maxRequests: number = 10,
  windowMs: number = 60000
): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(userId);

  // No entry or expired entry
  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(userId, {
      count: 1,
      resetTime: now + windowMs,
    });
    return false;
  }

  // Increment count
  entry.count++;

  // Check if limit exceeded
  if (entry.count > maxRequests) {
    return true;
  }

  return false;
}

/**
 * Clean up expired entries (should be called periodically)
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();

  for (const [userId, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(userId);
    }
  }
}

// Cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
}
