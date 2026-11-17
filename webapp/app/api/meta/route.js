import { route, json } from '@/lib/api';
import { getMeta } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export const GET = route(async () => json(await getMeta()), { roles: ['admin', 'customer'] });
