import { route, json } from '@/lib/api';
import { findRoutesByText } from '@/lib/queries';
import { airportSearchSchema, parseQuery } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = route(
  async ({ req }) => {
    const { q } = parseQuery(req, airportSearchSchema);
    return json({ routes: await findRoutesByText(q) });
  },
  { roles: ['admin', 'customer'] }
);
