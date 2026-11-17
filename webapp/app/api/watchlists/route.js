import { route, json } from '@/lib/api';
import { createWatchlist, listWatchlists } from '@/lib/queries';
import { parseBody, watchlistCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => json({ rows: await listWatchlists(user.user_id) }), {
  roles: ['admin', 'customer'],
});

export const POST = route(
  async ({ req, user }) => {
    const body = await parseBody(req, watchlistCreateSchema);
    return json(await createWatchlist(user.user_id, body), { status: 201 });
  },
  { roles: ['admin', 'customer'] }
);
