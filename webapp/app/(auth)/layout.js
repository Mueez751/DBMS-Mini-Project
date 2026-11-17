export default function AuthLayout({ children }) {
  return (
    <main className="auth-wrap">
      <div className="auth-card">{children}</div>
    </main>
  );
}
