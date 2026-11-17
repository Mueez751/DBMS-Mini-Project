import { route, json } from '@/lib/api';
import { rawPayloadInsights } from '@/lib/mongo';

export const dynamic = 'force-dynamic';

// MongoDB aggregation pipelines over the raw Amadeus payloads (admin only).
// Responds 503 (from lib/mongo.js) when MongoDB is not reachable.
export const GET = route(async () => json(await rawPayloadInsights()), { roles: ['admin'] });
