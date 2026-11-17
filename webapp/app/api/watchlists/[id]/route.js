import { route, json } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { deleteWatchlist, updateWatchlist } from '@/lib/queries';
import { parseBody, watchlistUpdateSchema } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const idSchema = z.coerce.number().int().positive();

// Both handlers filter by the signed-in user's id, so changing the id in the URL can never
// touch someone else's watchlist: it simply matches nothing and returns 404.
export const PATCH = route(
  async ({ req, params, user }) => {
    const id = idSchema.parse(params.id);
    const { target_price } = await parseBody(req, watchlistUpdateSchema);
    const row = await updateWatchlist(user.user_id, id, target_price);
    if (!row) throw new ApiError(404, 'Watchlist not found.');
    return json(row);
  },
  { roles: ['admin', 'customer'] }
);

export const DELETE = route(
  async ({ params, user }) => {
    const id = idSchema.parse(params.id);
    if (!(await deleteWatchlist(user.user_id, id))) throw new ApiError(404, 'Watchlist not found.');
    return json({ ok: true });
  },
  { roles: ['admin', 'customer'] }
);
