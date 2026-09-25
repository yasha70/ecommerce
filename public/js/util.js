// Shared helpers for the storefront and admin panel.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function discount(price, mrp) {
  return mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
}

export function stars(r) {
  const full = Math.round(r);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

// SQLite datetimes are UTC without a zone marker.
export function toDate(s) {
  return new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`);
}

export function dateFmt(s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return toDate(s).toLocaleString('en-IN', opts);
}

export function statusLabel(s) {
  return String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

// localStorage wrapper that never throws (private mode, quota, etc.).
export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(`ss_${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`ss_${key}`, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value.trim();
  }
  return out;
}

// Success toasts accept trusted HTML (links); error text is always rendered as plain text.
export function toast(html, isError = false) {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' err' : ''}`;
  if (isError) el.textContent = html; else el.innerHTML = html;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
