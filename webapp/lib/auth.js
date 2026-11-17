import { cookies } from 'next/headers';
import { query } from './db';
import { ApiError } from './errors';
import { SESSION_COOKIE, SESSION_HOURS, signSession, verifySession } from './session-token';

function cookieOptions() {
  const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_HOURS * 3600 };
}

export async function createSession(user) {
  const token = await signSession(user);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions());
}

export async function destroySession() {
  (await cookies()).set(SESSION_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
}

/**
 * The signed cookie proves who the user is; the database decides what they currently are.
 * Looking the role up on every request means a deleted or demoted account loses access
 * immediately instead of when the cookie expires.
 */
export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;
  const { rows } = await query('SELECT user_id, email, role FROM v_users_public WHERE user_id = $1', [session.userId]);
  return rows[0] || null;
}

/** For API route handlers: throws 401 / 403 instead of returning. */
export async function requireUser(roles = ['admin', 'customer']) {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, 'Please sign in.');
  if (!roles.includes(user.role)) throw new ApiError(403, 'You do not have permission to do that.');
  return user;
}
