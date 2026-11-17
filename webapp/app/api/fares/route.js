import { route, json } from '@/lib/api';
import { searchFares } from '@/lib/queries';
import { fareSearchSchema, parseQuery } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req }) => json(await searchFares(parseQuery(req, fareSearchSchema))), {
  roles: ['admin', 'customer'],
});
