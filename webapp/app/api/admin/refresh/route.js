import { route, json } from '@/lib/api';
import { refreshHeatmap } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export const POST = route(
  async () => {
    await refreshHeatmap();
    return json({ ok: true, refreshed_at: new Date().toISOString() });
  },
  { roles: ['admin'] }
);
