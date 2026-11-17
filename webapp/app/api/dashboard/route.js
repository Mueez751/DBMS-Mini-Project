import { route, json } from '@/lib/api';
import { getDashboard } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => json(await getDashboard(user.user_id)), { roles: ['admin', 'customer'] });
