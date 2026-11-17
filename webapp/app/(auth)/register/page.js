'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Field, Notice } from '@/components/ui';
import { api } from '@/lib/client';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/register', { method: 'POST', body: { email, password } });
      window.location.assign('/dashboard');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const fields = error?.fields || {};
  return (
    <>
      <div className="auth-brand">
        <span className="brand-mark">Create an account</span>
        <p className="muted">Customer accounts can search fares and set watchlists with alerts.</p>
      </div>
      <form className="auth-form" onSubmit={submit} noValidate>
        {error && !Object.keys(fields).length ? <Notice>{error.message}</Notice> : null}
        <Field label="Email" htmlFor="email" error={fields.email}>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required aria-invalid={Boolean(fields.email)} />
        </Field>
        <Field label="Password" htmlFor="password" error={fields.password} hint="At least 8 characters with an uppercase letter, a lowercase letter and a number.">
          <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-invalid={Boolean(fields.password)} />
        </Field>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Creating account...' : 'Create account'}
        </button>
        <p className="auth-alt">
          Already registered? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </>
  );
}
