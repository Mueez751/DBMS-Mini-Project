import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">Page not found</span>
          <p className="muted">That address does not match a page here.</p>
        </div>
        <Link className="btn" style={{ textAlign: 'center', lineHeight: '38px', textDecoration: 'none' }} href="/dashboard">
          Go to the dashboard
        </Link>
      </div>
    </main>
  );
}
