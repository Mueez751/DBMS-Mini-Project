import { route, json } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { ObjectId, rawPayloads } from '@/lib/mongo';
import { mongoRefForSnapshot } from '@/lib/queries';
import { snapshotIdSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// The PostgreSQL <-> MongoDB link in action: snapshot id -> raw_scrape_refs.mongo_doc_id
// -> the original Amadeus payload stored in MongoDB.
export const GET = route(
  async ({ params }) => {
    const snapshotId = snapshotIdSchema.parse(params.snapshotId);
    const ref = await mongoRefForSnapshot(snapshotId);
    if (!ref) throw new ApiError(404, 'No fare with that snapshot id.');
    const coll = await rawPayloads();
    const doc = await coll.findOne({ _id: new ObjectId(ref.mongo_doc_id) });
    if (!doc) throw new ApiError(404, 'The raw payload for this fare is no longer in MongoDB (payloads expire after 90 days).');
    return json({ snapshot_id: snapshotId, fare: ref, payload: doc });
  },
  { roles: ['admin'] }
);
