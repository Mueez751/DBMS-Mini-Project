import { route, json } from '@/lib/api';
import { priceTrend } from '@/lib/queries';
import { parseQuery, trendSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req }) => json({ rows: await priceTrend(parseQuery(req, trendSchema)) }), {
  roles: ['admin', 'customer'],
});
