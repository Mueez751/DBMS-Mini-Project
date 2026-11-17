import { query } from './db';
import { ApiError } from './errors';
import { Int32, ObjectId, rawPayloads } from './mongo';

/**
 * Records one fare across BOTH databases, the same way the scraper does:
 *   1. store the raw Amadeus-style payload in MongoDB (flexible, nested, kept as received)
 *   2. call sp_record_fare_snapshot in PostgreSQL, which inserts the normalised fare and its
 *      raw_scrape_refs row in one transaction and fires the price-drop alert trigger.
 * Two databases cannot share one transaction, so if step 2 fails the Mongo document is
 * removed again (compensating action). A leftover raw document would be harmless anyway:
 * the collection has a 90-day TTL index.
 */
export async function ingestFare(input) {
  const route = (await query('SELECT origin_iata, dest_iata FROM routes WHERE route_id = $1', [input.route_id])).rows[0];
  if (!route) throw new ApiError(400, 'That route does not exist.', { route_id: 'Choose an existing route' });

  const raw = await rawPayloads(); // throws 503 before anything is written if MongoDB is down
  const _id = new ObjectId();
  const offers = input.raw_offers?.length
    ? input.raw_offers
    : [
        {
          id: '1',
          validatingAirlineCodes: [input.airline_iata],
          itineraries: [
            {
              segments: [
                {
                  departure: { iataCode: route.origin_iata, at: `${input.flight_date}T00:00:00` },
                  arrival: { iataCode: route.dest_iata, at: `${input.flight_date}T00:00:00` },
                  carrierCode: input.airline_iata,
                  numberOfStops: 0,
                },
              ],
            },
          ],
          price: { currency: 'USD', total: input.price.toFixed(2) },
        },
      ];

  await raw.insertOne({
    _id,
    route_id: new Int32(input.route_id),
    origin: route.origin_iata,
    destination: route.dest_iata,
    source: 'amadeus',
    scraped_at: new Date(),
    meta: { count: offers.length, entered_by: 'admin-form' },
    data: offers,
  });

  try {
    const { rows } = await query(
      `CALL sp_record_fare_snapshot($1::int, $2::char(2), $3::varchar, $4::numeric, $5::date, $6::char(24), NULL::bigint)`,
      [input.route_id, input.airline_iata, input.cabin_class, input.price, input.flight_date, _id.toHexString()]
    );
    const snapshotId = rows[0].o_snapshot_id;
    const alerts = (await query('SELECT COUNT(*) AS n FROM alerts WHERE fare_snapshot_id = $1', [snapshotId])).rows[0].n;
    return { snapshot_id: snapshotId, mongo_doc_id: _id.toHexString(), alerts_triggered: alerts };
  } catch (err) {
    await raw.deleteOne({ _id }).catch(() => {});
    throw err;
  }
}
