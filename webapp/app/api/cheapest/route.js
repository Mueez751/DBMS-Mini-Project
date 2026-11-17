import { route, json } from '@/lib/api';
import { cheapestDates } from '@/lib/queries';
import { cheapestSchema, parseQuery } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req }) => json({ rows: await cheapestDates(parseQuery(req, cheapestSchema)) }), {
  roles: ['admin', 'customer'],
});
