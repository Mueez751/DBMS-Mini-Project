// Failed-login throttling (requirement #13). In-memory, so it is per server process;
// use a shared store such as Redis if the app is ever run on several instances.
const g = globalThis;
const store = (g.__loginFailures ??= new Map());

function prune(now) {
  if (store.size < 5000) return;
  for (const [key, entry] of store) if (entry.reset <= now) store.delete(key);
}

export function checkLimit(key, max, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.reset <= now) return { ok: true };
  return entry.count < max ? { ok: true } : { ok: false, retryAfter: Math.ceil((entry.reset - now) / 1000) };
}

export function recordFailure(key, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  prune(now);
  const entry = store.get(key);
  if (!entry || entry.reset <= now) store.set(key, { count: 1, reset: now + windowMs });
  else entry.count += 1;
}

export function clearFailures(key) {
  store.delete(key);
}
