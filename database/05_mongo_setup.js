// =====================================================================
// Airline Fare Intelligence Platform: MongoDB layer (raw scrape payloads)
//
// Run with:   mongosh "mongodb://localhost:27017/airfare" 05_mongo_setup.js
//             (or mongosh "$MONGODB_URI" 05_mongo_setup.js)
//
// WHY MONGODB: the Amadeus Flight Offers response is deeply nested
// (offers -> itineraries -> segments, travelerPricings -> fareDetailsBySegment)
// and its shape varies (nonstop vs connecting, optional fields per fare). Forcing
// that into rigid SQL columns at ingestion time would discard information before
// it is needed. MongoDB keeps the response exactly as received; the ETL then
// normalises the prices into PostgreSQL (fare_snapshots).
//
// LINK TO POSTGRESQL: raw_scrape_refs.mongo_doc_id (PostgreSQL) holds the _id of
// one document here. One document = one scrape batch for one route on one day.
// Sample-data convention shared with 03_seed.sql:
//   _id = ObjectId( hex(route_id * 100 + days_ago), left-padded to 24 chars )
// Prices inside the payloads are illustrative of the structure; the PostgreSQL
// rows hold the normalised prices the app actually queries.
// =====================================================================

db = db.getSiblingDB(db.getName() === 'test' ? 'airfare' : db.getName());
print('Using database: ' + db.getName());

// ---------------------------------------------------------------------
// 1. Collection with schema validation (data integrity on the NoSQL side)
//    Only the fields we rely on are required; everything else stays flexible.
// ---------------------------------------------------------------------
db.raw_fare_payloads.drop();
db.createCollection('raw_fare_payloads', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['route_id', 'origin', 'destination', 'source', 'scraped_at', 'data'],
      properties: {
        route_id:    { bsonType: 'int', minimum: 1, description: 'matches routes.route_id in PostgreSQL' },
        origin:      { bsonType: 'string', pattern: '^[A-Z]{3}$' },
        destination: { bsonType: 'string', pattern: '^[A-Z]{3}$' },
        source:      { enum: ['amadeus'] },
        scraped_at:  { bsonType: 'date' },
        data: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['itineraries', 'price'],
            properties: {
              numberOfBookableSeats: { bsonType: 'int', minimum: 0 },
              price: { bsonType: 'object', required: ['currency', 'total'] }
            }
          }
        }
      }
    }
  },
  validationLevel: 'strict',
  validationAction: 'error'
});

// ---------------------------------------------------------------------
// 2. Indexes
// ---------------------------------------------------------------------
db.raw_fare_payloads.createIndex({ route_id: 1, scraped_at: -1 });             // latest batches per route
db.raw_fare_payloads.createIndex({ 'data.validatingAirlineCodes': 1 });        // find payloads by carrier
db.raw_fare_payloads.createIndex({ scraped_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 }); // TTL: raw payloads expire after 90 days

// ---------------------------------------------------------------------
// 3. Sample raw payloads: 7 routes x 14 scrape days, Amadeus-style structure
// ---------------------------------------------------------------------
const routes = [
  { id: 1, o: 'BLR', d: 'DXB', carriers: ['EK', 'AI', '6E'], base: 180, dur: 200, hub: 'DEL' },
  { id: 2, o: 'DEL', d: 'LHR', carriers: ['BA', 'AI', 'VS'], base: 520, dur: 590, hub: 'DXB' },
  { id: 3, o: 'BOM', d: 'DXB', carriers: ['EK', 'AI', '6E'], base: 160, dur: 215, hub: 'DEL' },
  { id: 4, o: 'DXB', d: 'LHR', carriers: ['EK', 'BA'],       base: 480, dur: 440, hub: 'DOH' },
  { id: 5, o: 'LHR', d: 'JFK', carriers: ['BA', 'VS'],       base: 560, dur: 470, hub: 'DUB' },
  { id: 6, o: 'DXB', d: 'JFK', carriers: ['EK'],             base: 780, dur: 840, hub: 'LHR' },
  { id: 7, o: 'BLR', d: 'SIN', carriers: ['SQ', 'AI', '6E'], base: 210, dur: 270, hub: 'MAA' }
];

// small deterministic generator so reruns produce the same data
let seed = 42;
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }

function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(dt) { return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate()); }
function oid(routeId, daysAgo) { return ObjectId((routeId * 100 + daysAgo).toString(16).padStart(24, '0')); }
function duration(mins) { return 'PT' + Math.floor(mins / 60) + 'H' + pad2(mins % 60) + 'M'; }

const today = new Date();
today.setUTCHours(6, 0, 0, 0);

const docs = [];
for (const r of routes) {
  for (let daysAgo = 0; daysAgo <= 13; daysAgo++) {
    const scrapedAt = new Date(today.getTime() - daysAgo * 86400000);
    const departure = new Date(scrapedAt.getTime() + 14 * 86400000);   // searched 14 days ahead
    const offers = [];
    r.carriers.forEach((carrier, idx) => {
      const connecting = rnd() < 0.3;                                    // ~30% of offers have a stop
      const total = r.base * (0.9 + rnd() * 0.25) * (connecting ? 0.9 : 1);
      const base = total * 0.82;
      const flightNo = String(100 + Math.floor(rnd() * 800));
      const segments = connecting
        ? [
            { departure: { iataCode: r.o, at: isoDate(departure) + 'T02:15:00' }, arrival: { iataCode: r.hub, at: isoDate(departure) + 'T05:30:00' },
              carrierCode: carrier, number: flightNo, aircraft: { code: '320' }, numberOfStops: 0 },
            { departure: { iataCode: r.hub, at: isoDate(departure) + 'T08:10:00' }, arrival: { iataCode: r.d, at: isoDate(departure) + 'T14:00:00' },
              carrierCode: carrier, number: String(Number(flightNo) + 1), aircraft: { code: '77W' }, numberOfStops: 0 }
          ]
        : [
            { departure: { iataCode: r.o, at: isoDate(departure) + 'T03:40:00' }, arrival: { iataCode: r.d, at: isoDate(departure) + 'T09:00:00' },
              carrierCode: carrier, number: flightNo, aircraft: { code: idx % 2 ? '359' : '388' }, numberOfStops: 0 }
          ];
      const offer = {
        id: String(idx + 1),
        numberOfBookableSeats: NumberInt(1 + Math.floor(rnd() * 9)),
        validatingAirlineCodes: [carrier],
        itineraries: [{ duration: duration(r.dur + (connecting ? 150 : 0)), segments: segments }],
        price: {
          currency: 'USD',
          total: total.toFixed(2),
          base: base.toFixed(2),
          fees: [{ amount: '0.00', type: 'SUPPLIER' }]
        },
        travelerPricings: [{
          travelerId: '1',
          fareOption: 'STANDARD',
          travelerType: 'ADULT',
          price: { currency: 'USD', total: total.toFixed(2) },
          fareDetailsBySegment: segments.map((s, i) => ({
            segmentId: String(i + 1),
            cabin: 'ECONOMY',
            class: 'Y',
            includedCheckedBags: { quantity: NumberInt(carrier === '6E' ? 0 : 1) }   // optional-style field that varies by carrier
          }))
        }]
      };
      if (carrier === 'EK' || carrier === 'SQ') {
        offer.fareRules = { refundable: false, changeable: true };              // present on some offers only
      }
      offers.push(offer);
    });

    docs.push({
      _id: oid(r.id, daysAgo),
      route_id: NumberInt(r.id),
      origin: r.o,
      destination: r.d,
      source: 'amadeus',
      scraped_at: scrapedAt,
      request: { originLocationCode: r.o, destinationLocationCode: r.d, departureDate: isoDate(departure), adults: 1, currencyCode: 'USD' },
      meta: { count: offers.length },
      data: offers
    });
  }
}

const res = db.raw_fare_payloads.insertMany(docs);
print('Inserted raw payload documents: ' + Object.keys(res.insertedIds).length);

// ---------------------------------------------------------------------
// 4. Retrieval: how the app fetches the raw document for a PostgreSQL snapshot
//    (mongo_doc_id comes from raw_scrape_refs)
// ---------------------------------------------------------------------
print('\n--- findOne by _id (the PostgreSQL link) ---');
printjson(db.raw_fare_payloads.findOne(
  { _id: ObjectId('000000000000000000000064') },
  { route_id: 1, origin: 1, destination: 1, scraped_at: 1, 'meta.count': 1 }
));

// ---------------------------------------------------------------------
// 5. NoSQL AGGREGATION pipelines (advanced feature)
// ---------------------------------------------------------------------

// 5a. Average offered total per carrier per route (unwinds the nested offers)
print('\n--- 5a. Average offered price per carrier per route ---');
db.raw_fare_payloads.aggregate([
  { $unwind: '$data' },
  { $unwind: '$data.validatingAirlineCodes' },
  { $group: {
      _id: { route: { $concat: ['$origin', '-', '$destination'] }, carrier: '$data.validatingAirlineCodes' },
      avgTotal: { $avg: { $toDouble: '$data.price.total' } },
      offers: { $sum: 1 }
  } },
  { $project: { _id: 0, route: '$_id.route', carrier: '$_id.carrier', offers: 1, avgTotal: { $round: ['$avgTotal', 2] } } },
  { $sort: { route: 1, avgTotal: 1 } }
]).forEach(printjson);

// 5b. Share of nonstop vs connecting offers (variable-length segments array)
print('\n--- 5b. Nonstop vs connecting offers ---');
db.raw_fare_payloads.aggregate([
  { $unwind: '$data' },
  { $addFields: { stops: { $subtract: [{ $size: { $arrayElemAt: ['$data.itineraries.segments', 0] } }, 1] } } },
  { $group: { _id: '$stops', offers: { $sum: 1 } } },
  { $project: { _id: 0, stops: '$_id', offers: 1 } },
  { $sort: { stops: 1 } }
]).forEach(printjson);

// 5c. Scarcity signal: routes with offers that have 3 or fewer seats left
print('\n--- 5c. Low-availability offers per route ---');
db.raw_fare_payloads.aggregate([
  { $unwind: '$data' },
  { $match: { 'data.numberOfBookableSeats': { $lte: 3 } } },
  { $group: { _id: { $concat: ['$origin', '-', '$destination'] }, lowSeatOffers: { $sum: 1 } } },
  { $sort: { lowSeatOffers: -1 } }
]).forEach(printjson);

// 5d. Scrape volume per day (checks the scraper is running every day)
print('\n--- 5d. Payload documents per scrape day ---');
db.raw_fare_payloads.aggregate([
  { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$scraped_at' } }, batches: { $sum: 1 }, offers: { $sum: '$meta.count' } } },
  { $sort: { _id: -1 } },
  { $limit: 5 }
]).forEach(printjson);

// ---------------------------------------------------------------------
// 6. Validation test: a malformed payload must be rejected
// ---------------------------------------------------------------------
print('\n--- 6. Schema validation test ---');
try {
  db.raw_fare_payloads.insertOne({ route_id: NumberInt(1), origin: 'BLR', destination: 'DXB', source: 'amadeus', scraped_at: new Date() });  // 'data' missing
  print('FAIL: invalid document was accepted');
} catch (e) {
  print('PASS: invalid document rejected -> ' + e.codeName);
}
