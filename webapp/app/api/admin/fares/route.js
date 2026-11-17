import { route, json } from '@/lib/api';
import { ingestFare } from '@/lib/ingest';
import { adminFareSchema, parseBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ req }) => json(await ingestFare(await parseBody(req, adminFareSchema)), { status: 201 }), {
  roles: ['admin'],
});
