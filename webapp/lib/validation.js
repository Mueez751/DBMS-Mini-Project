import { z } from 'zod';
import { ApiError } from './errors';

// Application-side validation gives fast, friendly errors. The database re-checks every
// rule with CHECK / UNIQUE / FOREIGN KEY constraints, so bad data cannot get in even if
// this layer is bypassed (requirement #12).

export const CABINS = ['economy', 'premium_economy', 'business', 'first'];

const emptyToUndefined = (v) => (v === '' || v === null ? undefined : v);
const optional = (schema) => z.preprocess(emptyToUndefined, schema.optional());

const id = z.coerce.number().int('Must be a whole number').positive('Choose a valid option');
const cabin = z.enum(CABINS);
const price = z.coerce
  .number()
  .positive('Must be greater than 0')
  .max(999999.99, 'Must be below 1,000,000')
  .refine((v) => Math.round(v * 100) / 100 === v, 'Use at most 2 decimal places');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const email = z.string().trim().toLowerCase().max(255, 'Too long').email('Enter a valid email address');
const strongPassword = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');

export const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password').max(72) });
export const registerSchema = z.object({ email, password: strongPassword });

export const watchlistCreateSchema = z.object({ route_id: id, cabin_class: cabin, target_price: price });
export const watchlistUpdateSchema = z.object({ target_price: price });

export const fareSearchSchema = z.object({
  route_id: id,
  cabin: optional(cabin),
  airline: optional(z.string().regex(/^[A-Z0-9]{2}$/, 'Airline code is 2 characters')),
  max_price: optional(price),
  from: optional(isoDate),
  to: optional(isoDate),
  sort: z.preprocess(emptyToUndefined, z.enum(['price_asc', 'price_desc', 'date_asc', 'scraped_desc']).default('price_asc')),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(1000).default(1)),
  page_size: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(50).default(12)),
});

export const cheapestSchema = z.object({
  route_id: id,
  cabin,
  days: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(365).default(30)),
  limit: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(30).default(8)),
});

export const trendSchema = z.object({
  route_id: id,
  cabin,
  days: z.preprocess(emptyToUndefined, z.coerce.number().int().min(2).max(90).default(30)),
});

export const heatmapSchema = z.object({ cabin: z.preprocess(emptyToUndefined, cabin.default('economy')) });

export const airportSearchSchema = z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(40) });

export const adminRouteSchema = z
  .object({
    origin_iata: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code'),
    dest_iata: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code'),
  })
  .refine((v) => v.origin_iata !== v.dest_iata, { path: ['dest_iata'], message: 'Must differ from the origin' });

export const adminFareSchema = z.object({
  route_id: id,
  airline_iata: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2}$/, 'Airline code is 2 characters'),
  cabin_class: cabin,
  price,
  flight_date: isoDate.refine((d) => d >= new Date().toISOString().slice(0, 10), 'Flight date cannot be in the past'),
  raw_offers: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
});

export const snapshotIdSchema = z.coerce.number().int().positive();

export function parseQuery(req, schema) {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}

const MAX_BODY_BYTES = 200_000;

export async function parseBody(req, schema) {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, 'Request body is too large.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON.');
  }
  return schema.parse(data);
}
