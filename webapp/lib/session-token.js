// Edge-safe helpers (used by middleware.js and lib/auth.js). No Node-only imports here.
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'af_session';
export const SESSION_HOURS = 8;

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 random characters (see .env.example).');
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(user) {
  return new SignJWT({ role: user.role, email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.user_id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
}

/** Returns { userId, email, role } for a valid, unexpired token, otherwise null. */
export async function verifySession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    return { userId: Number(payload.sub), email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}
