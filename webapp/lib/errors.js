import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

const NO_STORE = { 'Cache-Control': 'no-store' };

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

// Database constraint name -> message a person can act on (requirement #12:
// integrity is enforced by the database, the app just explains the rejection).
const CONSTRAINT_MESSAGES = {
  chk_fare_price: 'Price must be greater than 0.',
  chk_fare_cabin: 'Choose a valid cabin class.',
  chk_watch_price: 'Target price must be greater than 0.',
  chk_watch_price_cap: 'Target price is too high.',
  chk_watch_cabin: 'Choose a valid cabin class.',
  chk_route_not_self: 'Origin and destination must be different airports.',
  chk_airport_iata: 'Airport codes are three capital letters, for example DXB.',
  chk_airline_iata: 'Airline codes are two letters or digits, for example EK.',
  chk_user_email: 'Enter a valid email address.',
  chk_user_bcrypt: 'Passwords must be stored hashed.',
  chk_user_role: 'Unknown role.',
  chk_mongo_oid: 'Raw payload reference is malformed.',
  uq_route_pair: 'That route already exists.',
  uq_watch: 'You already have a watchlist for this route and cabin.',
  uq_fare_observation: 'That fare observation was already recorded.',
  users_email_key: 'An account with this email already exists.',
};

export function handleError(err) {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message, fields: err.fields }, { status: err.status, headers: NO_STORE });
  }
  if (err instanceof ZodError) {
    const fields = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    return NextResponse.json({ error: 'Please fix the highlighted fields.', fields }, { status: 400, headers: NO_STORE });
  }
  const code = typeof err?.code === 'string' ? err.code : '';
  const friendly = CONSTRAINT_MESSAGES[err?.constraint];
  switch (code) {
    case '23505':
      return NextResponse.json({ error: friendly || 'That record already exists.' }, { status: 409, headers: NO_STORE });
    case '23503':
      return NextResponse.json(
        { error: 'That references a record that does not exist, or one that is still in use.' },
        { status: 409, headers: NO_STORE }
      );
    case '23514':
      return NextResponse.json({ error: friendly || 'A value was rejected by a database rule.' }, { status: 400, headers: NO_STORE });
    case '23502':
    case '22P02':
    case '22001':
    case '22007':
    case '22008':
      return NextResponse.json({ error: 'One of the values is missing or in the wrong format.' }, { status: 400, headers: NO_STORE });
    case '23000': // integrity_constraint_violation, raised by our own triggers with a safe message
      return NextResponse.json({ error: err.message }, { status: 409, headers: NO_STORE });
    default:
      // Never leak SQL, stack traces or driver messages to the browser.
      console.error('Unhandled error:', err);
      return NextResponse.json({ error: 'Something went wrong on our side. Try again.' }, { status: 500, headers: NO_STORE });
  }
}
