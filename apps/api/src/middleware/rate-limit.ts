import type { MiddlewareHandler } from "hono";

interface RateLimitOptions {
  windowMs: number; // Time window in ms
  max: number; // Max requests per window
}

interface Entry {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, Entry>>();

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const store of stores.values()) {
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }
}, 10 * 60 * 1000);

export function rateLimiter(opts: RateLimitOptions): MiddlewareHandler {
  const storeKey = `${opts.windowMs}:${opts.max}`;
  if (!stores.has(storeKey)) stores.set(storeKey, new Map());
  const store = stores.get(storeKey)!;

  return async (c, next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown";

    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now > entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + opts.windowMs });
      await next();
      return;
    }

    if (entry.count >= opts.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many requests" }, 429);
    }

    entry.count++;
    await next();
  };
}
