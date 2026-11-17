import { route, json, clientIp } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { query } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { loginSchema, parseBody } from '@/lib/validation';
import { checkLimit, clearFailures, recordFailure } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ req }) => {
  const { email, password } = await parseBody(req, loginSchema);

  // Throttle guessing: 5 failures per (IP + email) and 20 per IP, each for 15 minutes.
  const ip = clientIp(req);
  const accountKey = `acct|${ip}|${email}`;
  const ipKey = `ip|${ip}`;
  const limited = [checkLimit(accountKey, 5), checkLimit(ipKey, 20)].find((l) => !l.ok);
  if (limited) {
    const minutes = Math.max(1, Math.ceil(limited.retryAfter / 60));
    throw new ApiError(429, `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  // bcrypt is checked inside PostgreSQL; the app never sees a password hash.
  const { rows } = await query('SELECT user_id, email, role FROM fn_verify_login($1, $2)', [email, password]);
  const user = rows[0];
  if (!user) {
    recordFailure(accountKey);
    recordFailure(ipKey);
    // Same message whether the email exists or not.
    throw new ApiError(401, 'Incorrect email or password.');
  }

  clearFailures(accountKey);
  await createSession(user);
  return json({ user: { email: user.email, role: user.role } });
});
