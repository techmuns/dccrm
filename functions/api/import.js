/**
 * /api/import — bulk upsert contacts. Body: { contacts: [ {fields...} ], mode }.
 *
 * mode = 'merge' (default): update people already in the CRM and add new ones.
 *   - Rows WITH an email are matched by email (an UPSERT, so a duplicate email in
 *     the sheet updates the same person rather than failing).
 *   - Rows WITHOUT an email are matched by (Full Name + WhatsApp/phone). Dhamma's
 *     working copy only has an email for ~a quarter of people, so matching on email
 *     alone would be wrong. A blank-email row that matches nothing is inserted as
 *     its own contact — multiple blank-email rows are NEVER collapsed together.
 * mode = 'replace': delete every contact first, then import the sheet fresh.
 *
 * Returns { added, updated, skipped, mode }.
 */
import { WRITABLE, json, fail, noDb, now, readJson, ensureSchema, currentUser } from './_lib.js';

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/* Known spelling slips in the sheet's Entity Type column, fixed server-side too so a
   direct API import is cleaned the same way the browser upload is. */
const ENTITY_TYPE_FIXES = { fmailyoffice: 'Family Office', familyofice: 'Family Office', famioffice: 'Family Office' };
const keyify = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');
const nameKey = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');

const clean = (row) => {
  const v = {};
  for (const key of WRITABLE) {
    if (row[key] == null) continue;
    let val = String(row[key]).trim();
    if (key === 'email') val = val.toLowerCase();
    if (key === 'entityType' && val) val = ENTITY_TYPE_FIXES[keyify(val)] || val;
    v[key] = val === '' ? null : val;
  }
  return v;
};

/* Match keys for a blank-email row: name + each phone number it carries (digits only).
   A row with a name but no phone/whatsapp has no key, so it can never match and is
   always inserted — which is exactly what keeps distinct blank-email rows apart. */
function contactKeys(r) {
  const n = nameKey(r.fullName);
  if (!n) return [];
  const keys = [];
  const wa = digits(r.whatsapp); if (wa) keys.push(`${n}|${wa}`);
  const ph = digits(r.phone); if (ph) keys.push(`${n}|${ph}`);
  return keys;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }
  const who = currentUser(request);

  const rows = Array.isArray(body) ? body : Array.isArray(body?.contacts) ? body.contacts : null;
  if (!rows) return fail('Expected { contacts: [ … ] }.', 400);
  const mode = body && body.mode === 'replace' ? 'replace' : 'merge';
  if (rows.length > 20000) return fail('Too many rows in one import (max 20,000).', 413);

  const cleaned = rows.map(clean).filter((r) => r.fullName || r.email || r.organisation);
  const skipped = rows.length - cleaned.length;
  if (mode === 'replace' && !cleaned.length) {
    return fail('Refusing to replace all contacts with an empty import.', 400);
  }
  if (!cleaned.length) return json({ added: 0, updated: 0, skipped, mode });

  const ts = now();

  /* Snapshot existing contacts so we can tell an update from an insert and match
     blank-email rows by name + phone. Only needed for a merge; replace wipes first. */
  const emailToId = new Map();
  const nameKeyToId = new Map();
  if (mode === 'merge') {
    try {
      const res = await env.DB.prepare('SELECT id, fullName, email, whatsapp, phone FROM contacts').all();
      for (const c of res.results || []) {
        if (c.email) emailToId.set(String(c.email).toLowerCase(), c.id);
        for (const k of contactKeys(c)) if (!nameKeyToId.has(k)) nameKeyToId.set(k, c.id);
      }
    } catch (err) {
      return fail(`Could not read existing contacts: ${err.message}`, 500);
    }
  }

  /* ---- statement builders ---- */
  const upsertByEmail = (r) => {
    const cols = WRITABLE.filter((c) => c in r);
    const allCols = [...cols, 'createdAt', 'updatedAt', 'updatedBy'];
    const setCols = [...cols.filter((c) => c !== 'email'), 'updatedAt', 'updatedBy'];
    const sql = `INSERT INTO contacts (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})
      ON CONFLICT(email) DO UPDATE SET ${setCols.map((c) => `${c} = excluded.${c}`).join(', ')}`;
    return env.DB.prepare(sql).bind(...cols.map((c) => r[c]), ts, ts, who);
  };
  const updateById = (r, id) => {
    const cols = WRITABLE.filter((c) => c in r);
    const setSql = [...cols.map((c) => `${c} = ?`), 'updatedAt = ?', 'updatedBy = ?'].join(', ');
    return env.DB.prepare(`UPDATE contacts SET ${setSql} WHERE id = ?`).bind(...cols.map((c) => r[c]), ts, who, id);
  };
  const insertNew = (r) => {
    const cols = WRITABLE.filter((c) => c in r);
    const allCols = [...cols, 'createdAt', 'updatedAt', 'updatedBy'];
    return env.DB.prepare(
      `INSERT INTO contacts (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})`,
    ).bind(...cols.map((c) => r[c]), ts, ts, who);
  };

  const statements = [];
  let added = 0;
  let updated = 0;
  const handledEmails = new Set();

  if (mode === 'replace') statements.push(env.DB.prepare('DELETE FROM contacts'));

  for (const r of cleaned) {
    if (r.email) {
      // A repeat of an email already handled this run, or one already in the CRM, is an update.
      if (mode === 'merge' && (handledEmails.has(r.email) || emailToId.has(r.email))) updated += 1;
      else if (mode === 'replace' && handledEmails.has(r.email)) updated += 1;
      else added += 1;
      handledEmails.add(r.email);
      statements.push(upsertByEmail(r));
    } else if (mode === 'merge') {
      const id = contactKeys(r).map((k) => nameKeyToId.get(k)).find((x) => x != null);
      if (id != null) { statements.push(updateById(r, id)); updated += 1; }
      else { statements.push(insertNew(r)); added += 1; }
    } else {
      statements.push(insertNew(r)); added += 1;   // replace: every blank-email row is a fresh contact
    }
  }

  try {
    for (const batch of chunk(statements, 50)) await env.DB.batch(batch);
  } catch (err) {
    return fail(`Import failed while writing: ${err.message}`, 500);
  }
  return json({ added, updated, skipped, mode });
}
