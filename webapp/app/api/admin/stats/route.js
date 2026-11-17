import { route, json } from '@/lib/api';
import { adminStats } from '@/lib/queries';
import { mongoStatus } from '@/lib/mongo';

export const dynamic = 'force-dynamic';

export const GET = route(
  async () => {
    const [stats, mongo] = await Promise.all([adminStats(), mongoStatus()]);
    return json({ stats, mongo });
  },
  { roles: ['admin'] }
);
