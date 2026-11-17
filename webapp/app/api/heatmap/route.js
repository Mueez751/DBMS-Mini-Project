import { route, json } from '@/lib/api';
import { getHeatmap } from '@/lib/queries';
import { heatmapSchema, parseQuery } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = route(
  async ({ req }) => {
    const { cabin } = parseQuery(req, heatmapSchema);
    return json({ cabin, rows: await getHeatmap(cabin) });
  },
  { roles: ['admin', 'customer'] }
);
