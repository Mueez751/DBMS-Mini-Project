import { NextResponse } from 'next/server';
import { requireUser } from './auth';
import { ApiError, handleError } from './errors';

export function json(data, init = {}) {
  return NextResponse.json(data, { ...init, headers: { 'Cache-Control': 'no-store', ...(init.headers || {}) } });
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// CSRF defence in depth (the session cookie is also SameSite=Lax): a browser always sends
// Origin on state-changing requests, so reject any whose Origin is a different site.
function assertSameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new ApiError(403, 'Request blocked.');
  }
  if (parsed.host !== host) throw new ApiError(403, 'Cross-site request blocked.');
}

export function clientIp(req) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
}

/**
 * Wraps every API handler: origin check, role check (pass roles to require a login),
 * and uniform error handling so no stack trace or SQL ever reaches the browser.
 */
export function route(handler, { roles } = {}) {
  return async (req, ctx) => {
    try {
      if (MUTATING.has(req.method)) assertSameOrigin(req);
      const user = roles ? await requireUser(roles) : null;
      const params = ctx?.params ? await ctx.params : {};
      return await handler({ req, params, user });
    } catch (err) {
      return handleError(err);
    }
  };
}
