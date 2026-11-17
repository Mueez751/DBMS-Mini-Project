import { route, json } from '@/lib/api';
import { createRoute } from '@/lib/queries';
import { adminRouteSchema, parseBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const POST = route(
  async ({ req }) => json(await createRoute(await parseBody(req, adminRouteSchema)), { status: 201 }),
  { roles: ['admin'] }
);
