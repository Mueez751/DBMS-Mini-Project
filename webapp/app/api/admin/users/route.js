import { route, json } from '@/lib/api';
import { listUsers } from '@/lib/queries';

export const dynamic = 'force-dynamic';

// Reads v_users_public: there is no way to get a password hash through the app.
export const GET = route(async () => json({ rows: await listUsers() }), { roles: ['admin'] });
