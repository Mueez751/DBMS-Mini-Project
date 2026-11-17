'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/search', label: 'Search' },
  { href: '/watchlists', label: 'Watchlists' },
  { href: '/alerts', label: 'Alerts' },
];

export default function Nav({ user }) {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const links = user.role === 'admin' ? [...LINKS, { href: '/admin', label: 'Admin' }] : LINKS;

  async function signOut() {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.assign('/login');
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/dashboard" className="brand">
          Fare Intelligence
        </Link>
        <nav aria-label="Main">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="navlink" aria-current={pathname.startsWith(l.href) ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="who">
          <span title={user.email}>{user.email}</span>
          <span className="badge">{user.role}</span>
          <button type="button" className="btn btn-bare" onClick={signOut} disabled={busy}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
