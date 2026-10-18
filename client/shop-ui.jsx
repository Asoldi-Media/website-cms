/** Small shared UI pieces and the admin API hook for the shop pages. */
import { useCallback, useEffect, useState } from 'react';

export const API = '/api/cms';
export const inputClass = 'w-full px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white text-sm placeholder-gray-500';

/** fetch wrapper: JSON in/out, throws Error(message) on non-2xx. */
export function useShopApi(authHeaders) {
  return useCallback(
    async (method, path, body, { raw = false, contentType } = {}) => {
      const headers = { ...authHeaders() };
      let payload;
      if (body instanceof FormData) payload = body;
      else if (typeof body === 'string') {
        payload = body;
        headers['Content-Type'] = contentType || 'text/plain';
      } else if (body !== undefined) {
        payload = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
      }
      const res = await fetch(`${API}${path}`, { method, headers, body: payload });
      if (raw) return res;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Feil ${res.status}`);
      return data;
    },
    [authHeaders]
  );
}

/** Loads `path` on mount and whenever deps change; returns [data, reload, error]. */
export function useLoad(api, path, initial, deps = []) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api('GET', path));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [api, path, ...deps]);
  useEffect(() => {
    reload();
  }, [reload]);
  return [data, reload, error];
}

/** Minor units as a formatted amount. */
export function kr(minor, currency = 'nok') {
  const code = String(currency || 'nok').toUpperCase();
  try {
    const fmt = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: code });
    return fmt.format((Number(minor) || 0) / 10 ** fmt.resolvedOptions().maximumFractionDigits);
  } catch {
    return `${((Number(minor) || 0) / 100).toFixed(2)} ${code}`;
  }
}

/** ISO date in nb-NO, with or without the time. */
export function when(value, withTime = true) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return withTime ? d.toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString('nb-NO');
}

/** Panel card with a title and optional actions. */
export function Card({ title, actions, children, className = '' }) {
  return (
    <div className={`rounded-xl bg-[#2a2a2a] border border-white/10 p-5 mb-4 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          {title && <h3 className="text-white font-semibold">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

/** Button in the admin style; kind picks the colour. */
export function Btn({ kind = 'primary', className = '', ...props }) {
  const look = {
    primary: 'bg-[#FF5B00] text-white hover:bg-[#e55200]',
    ghost: 'bg-white/10 text-white hover:bg-white/20',
    danger: 'bg-red-600/80 text-white hover:bg-red-600',
  }[kind];
  return <button type="button" {...props} className={`px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${look} ${className}`} />;
}

/** Labelled form field with an optional hint. */
export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs text-gray-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

/** Checkbox with a label. */
export function Check({ label, checked, onChange, disabled }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-200">
      <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Small status pill. */
export function Badge({ tone = 'gray', children }) {
  const look = {
    gray: 'bg-white/10 text-gray-300',
    green: 'bg-green-500/20 text-green-300',
    yellow: 'bg-yellow-500/20 text-yellow-200',
    red: 'bg-red-500/20 text-red-300',
    blue: 'bg-blue-500/20 text-blue-200',
  }[tone];
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${look}`}>{children}</span>;
}

/** Red error line; renders nothing without an error. */
export function ErrorLine({ error }) {
  return error ? <p className="text-red-400 text-sm mb-3">{error}</p> : null;
}

/** Notice shown to staff that only the owner can change this. */
export function OwnerNote({ isOwner }) {
  return isOwner ? null : <p className="text-yellow-200/80 text-xs mb-3">Bare eier (admin) kan endre dette. Du kan se, men ikke lagre.</p>;
}

/** Runs an action with loading + alert on failure; returns the result or null. */
export function useAction(setLoading) {
  return useCallback(
    async (fn, { confirm: question } = {}) => {
      if (question && !window.confirm(question)) return null;
      setLoading(true);
      try {
        return await fn();
      } catch (err) {
        window.alert(err.message || 'Noe gikk galt.');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [setLoading]
  );
}
