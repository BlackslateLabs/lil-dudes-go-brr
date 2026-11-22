// Request hardening for the public server (M5 step 6): CORS for the web origin(s), body size
// cap, security headers, a per-IP request rate limit, per-route write limits, and no stack
// traces in responses. Pure Hono middleware; app.ts wires it in.
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { RateLimit } from './limits';

export interface GuardOptions {
  /** Allowed web origins (exact, e.g. https://lildudes.vercel.app). '*' = any (dev only). Default:
   *  local dev origins. */
  origins?: string[] | '*';
  now?: () => number;
  /** Requests per IP per minute, all routes together (default 240: a match polls ~1/s). */
  perMinute?: number;
  ipOf: (c: Context) => string;
}

/** Dev origins allowed when nothing is configured (Vite on the LAN for phones too). */
export const DEV_ORIGINS = [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/, /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/, /^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/];

export function parseOrigins(env: string | undefined): string[] | '*' | undefined {
  if (!env?.trim()) return undefined;
  if (env.trim() === '*') return '*';
  return env.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

export function guard(o: GuardOptions): MiddlewareHandler[] {
  const limiter = new RateLimit(60_000, o.perMinute ?? 240, o.now);
  const origin =
    o.origins === '*'
      ? '*'
      : (req: string) => {
          const list = o.origins;
          if (list) return list.includes(req) ? req : null;
          return DEV_ORIGINS.some((r) => r.test(req)) ? req : null;
        };
  return [
    secureHeaders({ crossOriginResourcePolicy: 'cross-origin' }),
    cors({ origin, allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowHeaders: ['content-type'], maxAge: 600 }),
    async (c, next) => {
      // Platform health checks are never limited.
      if (c.req.path === '/healthz') return next();
      const r = limiter.take(o.ipOf(c));
      if (!r.ok) {
        c.header('Retry-After', String(Math.ceil(r.retryMs / 1000)));
        return c.json({ error: 'too many requests', retryAfterSec: Math.ceil(r.retryMs / 1000) }, 429);
      }
      return next();
    },
    bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'body too large (4 KB max)' }, 413) }),
    async (c, next) => {
      // JSON bodies only on writes.
      if ((c.req.method === 'POST' || c.req.method === 'PUT') && !c.req.header('content-type')?.includes('application/json')) {
        return c.json({ error: 'send JSON (content-type: application/json)' }, 415);
      }
      return next();
    },
  ];
}
