'use client';

export default function GlobalError({ reset }) {
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">Something went wrong</span>
          <p className="muted">The page could not load. Your data is safe. Try again in a moment.</p>
        </div>
        <button type="button" className="btn" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </main>
  );
}
