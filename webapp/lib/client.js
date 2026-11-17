// Browser-side helpers. Every page talks to the database only through the /api routes.
import { useEffect, useState } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.location.assign('/login');
  }
  if (!res.ok) {
    const err = new Error(data?.error || 'Request failed. Try again.');
    err.status = res.status;
    err.fields = data?.fields || {};
    throw err;
  }
  return data;
}

/** GET a URL and keep the previous data on screen while a new request is in flight. Pass null to skip. */
export function useFetch(url) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(url) });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api(url)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
  }, [url, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) sp.set(k, String(v));
  return sp.toString();
}
