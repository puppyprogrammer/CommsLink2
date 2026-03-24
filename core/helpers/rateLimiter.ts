/**
 * Simple in-memory sliding window rate limiter.
 * No external dependencies — uses a Map with periodic cleanup.
 */

interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, WindowEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    // Remove entries whose window expired more than 2x ago
    if (now - entry.windowStart > 600_000) {
      store.delete(key);
    }
  }
}, 300_000).unref();

/**
 * Check if a request is allowed under the rate limit.
 *
 * @param key - Unique identifier (e.g. "login:<ip>" or "register:<ip>")
 * @param maxRequests - Maximum requests allowed within the window
 * @param windowMs - Window duration in milliseconds
 * @returns Object with `allowed` boolean and `retryAfterMs` (ms until window resets, 0 if allowed)
 */
function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    // No entry or window expired — start a new window
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count < maxRequests) {
    entry.count++;
    return { allowed: true, retryAfterMs: 0 };
  }

  // Rate limited
  const retryAfterMs = windowMs - (now - entry.windowStart);
  return { allowed: false, retryAfterMs };
}

export { checkRateLimit };
