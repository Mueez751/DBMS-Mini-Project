export function Notice({ kind = 'error', children }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <span className="error-text" id={`${htmlFor}-error`}>
          {error}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <p className="muted" role="status">
      {label}...
    </p>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <span className="muted">{children}</span>
    </div>
  );
}

export function Segmented({ label, value, onChange, options }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ title, actions, children, id }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <header className="panel-head">
        <h2 id={id}>{title}</h2>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function ErrorBlock({ error }) {
  return error ? <Notice>{error.message}</Notice> : null;
}
