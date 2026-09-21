/**
 * functions/api/_lib.js — shared helpers for the CRM API (Cloudflare Pages Functions).
 * Underscore-prefixed, so Pages does not treat it as a route.
 */

/* The columns a client may write. id / createdAt / updatedAt are server-managed. */
export const WRITABLE = [
  'fullName', 'entityType', 'role', 'organisation', 'designation', 'email', 'phone',
  'whatsapp', 'whatsappOptIn', 'country', 'city', 'vehicle', 'stage', 'referredBy',
  'lastContact', 'nextAction', 'nextActionDate', 'relationshipOwner', 'source', 'notes',
];

/* Field -> the sheet header name used for CSV export/import round-trips. */
export const HEADERS = {
  fullName: 'Full Name', entityType: 'Entity Type', role: 'Role', organisation: 'Organisation Name',
  designation: 'Designation', email: 'Email', phone: 'Phone (display)', whatsapp: 'WhatsApp Number (E.164)',
  whatsappOptIn: 'WhatsApp Opt-In', country: 'Primary Country', city: 'Primary City', vehicle: 'Vehicle',
  stage: 'Stage', referredBy: 'Referred By', lastContact: 'Last Contact', nextAction: 'Next Action',
  nextActionDate: 'Next Action Date', relationshipOwner: 'Relationship Owner', source: 'Source / Channel', notes: 'Notes',
};

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

export const fail = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);

/** 503 with a stable code the front-end uses to switch into read-only preview mode. */
export const noDb = () => json({ error: 'Database not connected', code: 'no-database' }, 503);

export const now = () => new Date().toISOString();

const trim = (v) => (v == null ? '' : String(v).trim());
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Clean a client payload down to writable fields.
 *   mode 'create' requires something identifying; 'patch' allows any subset.
 * Returns { values } or throws an Error with a friendly message.
 */
export function cleanPayload(body, mode = 'create') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Expected a JSON object of contact fields.');
  }
  const values = {};
  for (const key of WRITABLE) {
    if (!(key in body)) continue;
    let v = trim(body[key]);
    if (key === 'email') v = v.toLowerCase();
    values[key] = v === '' ? null : v;
  }
  if (values.email && !EMAIL_RE.test(values.email)) {
    throw new Error(`"${values.email}" does not look like an email address.`);
  }
  if (mode === 'create') {
    const identifying = values.fullName || values.email || values.organisation;
    if (!identifying) throw new Error('A contact needs at least a name, an email or an organisation.');
  } else if (!Object.keys(values).length) {
    throw new Error('No editable fields were provided.');
  }
  return values;
}

export async function readJson(request) {
  try { return await request.json(); }
  catch { throw new Error('The request body was not valid JSON.'); }
}

/** CSV-escape one value. */
export const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
