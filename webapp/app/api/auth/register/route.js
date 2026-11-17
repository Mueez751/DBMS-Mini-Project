import { route, json } from '@/lib/api';
import { query } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { registerSchema, parseBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// Self-service sign-up always creates a customer; the role is fixed inside fn_register_user,
// not taken from the request, so nobody can register as an admin.
export const POST = route(async ({ req }) => {
  const { email, password } = await parseBody(req, registerSchema);
  const { rows } = await query('SELECT fn_register_user($1, $2) AS user_id', [email, password]);
  const user = { user_id: rows[0].user_id, email, role: 'customer' };
  await createSession(user);
  return json({ user: { email, role: 'customer' } }, { status: 201 });
});
