import { MongoClient, ObjectId, Int32 } from 'mongodb';
import { ApiError } from './errors';

export { ObjectId, Int32 };

const g = globalThis;

/** Collection holding raw Amadeus payloads. Connection details come only from MONGODB_URI. */
export async function rawPayloads() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new ApiError(503, 'MongoDB is not configured. Set MONGODB_URI in .env.local.');
  try {
    if (!g.__mongoClient) {
      g.__mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 3000, maxPoolSize: 5 });
    }
    await g.__mongoClient.connect();
    return g.__mongoClient.db(process.env.MONGODB_DB || 'airfare').collection('raw_fare_payloads');
  } catch (err) {
    const stale = g.__mongoClient;
    g.__mongoClient = null;
    if (stale) stale.close().catch(() => {});
    throw new ApiError(503, 'MongoDB is not reachable right now.');
  }
}

export async function mongoStatus() {
  try {
    const coll = await rawPayloads();
    return { ok: true, documents: await coll.estimatedDocumentCount() };
  } catch {
    return { ok: false, documents: null };
  }
}

/**
 * NoSQL aggregation (requirement #7). Three pipelines over the raw Amadeus documents.
 * They mirror section 5 of database/05_mongo_setup.js, but are written defensively because
 * admins may store raw offers with optional fields: bad or missing values are skipped
 * (onError / $isArray guards) instead of making the whole pipeline fail.
 */
export async function rawPayloadInsights() {
  const coll = await rawPayloads();

  const [carrierAvg, stops, lowSeats] = await Promise.all([
    // average offered price per carrier per route (unwinds offers, then carriers)
    coll
      .aggregate([
        { $unwind: '$data' },
        { $unwind: '$data.validatingAirlineCodes' },
        {
          $group: {
            _id: { route: { $concat: ['$origin', '-', '$destination'] }, carrier: '$data.validatingAirlineCodes' },
            avgTotal: { $avg: { $convert: { input: '$data.price.total', to: 'double', onError: null, onNull: null } } },
            offers: { $sum: 1 },
          },
        },
        { $project: { _id: 0, route: '$_id.route', carrier: '$_id.carrier', offers: 1, avgTotal: { $round: ['$avgTotal', 2] } } },
        { $sort: { route: 1, avgTotal: 1 } },
        { $limit: 60 },
      ])
      .toArray(),

    // nonstop vs connecting offers (segments array length - 1)
    coll
      .aggregate([
        { $unwind: '$data' },
        {
          $addFields: {
            segs: {
              $let: {
                vars: { s: { $arrayElemAt: ['$data.itineraries.segments', 0] } },
                in: { $cond: [{ $isArray: '$$s' }, '$$s', []] },
              },
            },
          },
        },
        { $match: { $expr: { $gt: [{ $size: '$segs' }, 0] } } },
        { $group: { _id: { $subtract: [{ $size: '$segs' }, 1] }, offers: { $sum: 1 } } },
        { $project: { _id: 0, stops: '$_id', offers: 1 } },
        { $sort: { stops: 1 } },
      ])
      .toArray(),

    // scarcity signal: offers with 3 or fewer seats left, per route
    coll
      .aggregate([
        { $unwind: '$data' },
        { $match: { 'data.numberOfBookableSeats': { $lte: 3 } } },
        { $group: { _id: { $concat: ['$origin', '-', '$destination'] }, lowSeatOffers: { $sum: 1 } } },
        { $project: { _id: 0, route: '$_id', lowSeatOffers: 1 } },
        { $sort: { lowSeatOffers: -1, route: 1 } },
      ])
      .toArray(),
  ]);

  return { carrierAvg, stops, lowSeats };
}
