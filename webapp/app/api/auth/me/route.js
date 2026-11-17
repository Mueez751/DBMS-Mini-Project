import { route, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => json({ user: { email: user.email, role: user.role } }), {
  roles: ['admin', 'customer'],
});
