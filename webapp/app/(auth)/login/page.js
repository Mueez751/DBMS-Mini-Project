'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Field, Notice } from '@/components/ui';
import { api } from '@/lib/client';

// Demo accounts are shown only when NEXT_PUBLIC_SHOW_DEMO_LOGINS=true (coursework demo).
const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === 'true';
const DEMO = [
  { label: 'Admin', email: 'admin@airfare.local', password: 'Admin@12345' },
  { label: 'Customer', email: 'alice@example.com', password: 'Alice@12345' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { method: 'POST', body: { email, password } });
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.assign(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="auth-brand">
        <span className="brand-mark">Fare Intelligence</span>
        <p className="muted">See how airfares move, find the cheapest day to fly, and get an alert when a fare hits your target.</p>
      </div>
      <form className="auth-form" onSubmit={submit} noValidate>
        {error ? <Notice>{error.message}</Notice> : null}
        <Field label="Email" htmlFor="email" error={error?.fields?.email}>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required aria-invalid={Boolean(error?.fields?.email)} />
        </Field>
        <Field label="Password" htmlFor="password" error={error?.fields?.password}>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-invalid={Boolean(error?.fields?.password)} />
        </Field>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
        <p className="auth-alt">
          New here? <Link href="/register">Create an account</Link>
        </p>
      </form>
      {SHOW_DEMO ? (
        <div className="demo">
          <p>Demo accounts. Select one to fill the form.</p>
          {DEMO.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => {
                setEmail(d.email);
                setPassword(d.password);
              }}
            >
              <span>{d.label}</span>
              <span>{d.email}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
