const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-US');

export const money0 = (n) => (n == null ? '-' : usd0.format(n));
export const money = (n) => (n == null ? '-' : usd2.format(n));
export const count = (n) => (n == null ? '-' : int.format(n));

const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const stamp = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayOnly = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const timeOnly = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

// DATE columns arrive as 'YYYY-MM-DD' strings; parse as UTC so no timezone can shift the day.
const utc = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
export const fmtDate = (iso) => (iso ? longDate.format(utc(iso)) : '-');
export const fmtShortDate = (iso) => (iso ? shortDate.format(utc(iso)) : '-');
export const fmtMonth = (iso) => (iso ? monthYear.format(utc(iso)) : '-');
export const fmtStamp = (ts) => (ts ? stamp.format(new Date(ts)) : '-');
export const fmtDay = (ts) => (ts ? dayOnly.format(new Date(ts)) : '-');
export const fmtTime = (ts) => (ts ? timeOnly.format(new Date(ts)) : '');

export const CABIN_LABEL = {
  economy: 'Economy',
  premium_economy: 'Premium economy',
  business: 'Business',
  first: 'First',
};
export const CABIN_OPTIONS = Object.entries(CABIN_LABEL).map(([value, label]) => ({ value, label }));

/** SQL returns 'BLR > DXB', 'BLR -> DXB' or 'BLR-DXB' (ASCII); show every form as 'BLR → DXB'. */
export const routeLabel = (s) => String(s).replace(/\s*(->|>|-)\s*/, ' → ');
