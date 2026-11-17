import { route, json } from '@/lib/api';
import { listAlerts } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => json({ rows: await listAlerts(user.user_id) }), {
  roles: ['admin', 'customer'],
});
