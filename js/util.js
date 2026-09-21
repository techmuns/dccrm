/** util.js — small shared helpers. No DOM, no state. */

/** Reduce a sheet header to a comparison key: lowercase, letters and digits only. */
export const headerKey = (s) =>
  String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

export const isBlank = (v) =>
  v == null || (typeof v === 'string' && v.trim() === '');

export const text = (v) => (v == null ? '' : String(v).trim());

/** Collapse inner whitespace and trim — sheets are full of stray spaces. */
export const tidy = (v) => text(v).replace(/\s+/g, ' ');

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- dates ---------- */

const MS_DAY = 86400000;

/** Midnight today, in local time — the reference point for every "due" calculation. */
export const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Parse whatever a sheet throws at us into a Date at local midnight, or null.
 * Handles: Date objects (SheetJS cellDates), Excel serial numbers,
 * ISO (2026-09-21), d/m/y and m/d/y, and "12 Mar 2026" style strings.
 */
export function parseDate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : atMidnight(value);

  if (typeof value === 'number' && Number.isFinite(value)) return excelSerialToDate(value);

  const s = String(value).trim();
  if (!s) return null;

  // A bare number in a text cell is still an Excel serial.
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToDate(Number(s));

  // ISO first — unambiguous.
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return safeDate(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]);

  // d/m/y or m/d/y with / . or - separators. Prefer day-first (the sheet is Indian),
  // but fall back to month-first when the first part cannot be a day.
  const parts = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (parts) {
    let [, a, b, y] = parts.map(Number);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    const dayFirst = a > 12 || b <= 12;
    const day = dayFirst ? a : b;
    const month = dayFirst ? b : a;
    return safeDate(y, month - 1, day);
  }

  const parsed = new Date(s);            // "12 Mar 2026", "Mar 12, 2026", …
  return Number.isNaN(parsed.getTime()) ? null : atMidnight(parsed);
}

function atMidnight(d) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Number.isNaN(out.getTime()) ? null : out;
}

function safeDate(y, m, d) {
  const out = new Date(y, m, d);
  if (Number.isNaN(out.getTime())) return null;
  // Reject rolled-over values like 31/02 that JS silently shifts into March.
  return out.getMonth() === m && out.getDate() === d ? out : null;
}

/** Excel stores dates as days since 1899-12-30 (its 1900 leap-year quirk included). */
function excelSerialToDate(serial) {
  if (serial < 1 || serial > 2958465) return null;
  const ms = Math.round(serial * MS_DAY);
  const utc = new Date(Date.UTC(1899, 11, 30) + ms);
  return safeDate(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/** Whole days from today. Negative = in the past. */
export const daysFromToday = (date) =>
  date ? Math.round((atMidnight(date) - today()) / MS_DAY) : null;

export const formatDate = (date) =>
  date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export const formatDateTime = (date) =>
  date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/* ---------- numbers ---------- */

export const formatNumber = (n) => Number(n || 0).toLocaleString();

/** Percent of a whole, rounded to one decimal but dropping a trailing ".0". */
export function formatPercent(part, whole) {
  if (!whole) return '0%';
  const pct = (part / whole) * 100;
  const rounded = pct >= 10 || pct === 0 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${rounded}%`;
}

/* ---------- collections ---------- */

/** Count rows by a field. Blanks are skipped, not bucketed as "undefined". */
export function countBy(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    const key = tidy(row[field]);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/** Map -> [{name, value}] sorted biggest first, ties broken alphabetically so
    the order is stable across renders. */
export const rank = (counts) =>
  [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

export function debounce(fn, wait = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
