/**
 * /api/import — bulk upsert contacts by email. Body: { contacts: [ {fields...} ] }.
 * Returns { added, updated, skipped }. Rows without an email can't be matched, so
 * they are inserted as new (counted as added).
 */
import { WRITABLE, json, fail, noDb, now, readJson, ensureSchema, currentUser } from './_lib.js';

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

const clean = (row) => {
  const v = {};
  for (const key of WRITABLE) {
    if (row[key] == null) continue;
    let val = String(row[key]).trim();
    if (key === 'email') val = val.toLowerCase();
    v[key] = val === '' ? null : val;
  }
  return v;
};

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }
  const who = currentUser(request);

  const rows = Array.isArray(body) ? body : Array.isArray(body?.contacts) ? body.contacts : null;
  if (!rows) return fail('Expected { contacts: [ … ] }.', 400);
  if (!rows.length) return json({ added: 0, updated: 0, skipped: 0 });
  if (rows.length > 20000) return fail('Too many rows in one import (max 20,000).', 413);

  const cleaned = rows.map(clean).filter((r) => r.fullName || r.email || r.organisation);
  const skipped = rows.length - cleaned.length;

  // Which emails already exist? (chunked IN queries to stay under bind limits)
  const emails = [...new Set(cleaned.map((r) => r.email).filter(Boolean))];
  const existing = new Set();
  try {
    for (const group of chunk(emails, 100)) {
      const res = await env.DB.prepare(
        `SELECT email FROM contacts WHERE email IN (${group.map(() => '?').join(',')})`,
      ).bind(...group).all();
      for (const r of res.results || []) existing.add(r.email);
    }
  } catch (err) {
    return fail(`Could not check existing contacts: ${err.message}`, 500);
  }

  const ts = now();
  let added = 0;
  let updated = 0;
  const statements = [];

  for (const r of cleaned) {
    const cols = WRITABLE.filter((c) => c in r);
    if (r.email && existing.has(r.email)) {
      // update by email
      const setSql = [...cols.filter((c) => c !== 'email').map((c) => `${c} = ?`), 'updatedAt = ?', 'updatedBy = ?'].join(', ');
      const binds = [...cols.filter((c) => c !== 'email').map((c) => r[c]), ts, who, r.email];
      statements.push(env.DB.prepare(`UPDATE contacts SET ${setSql} WHERE email = ?`).bind(...binds));
      updated += 1;
    } else {
      const allCols = [...cols, 'createdAt', 'updatedAt', 'updatedBy'];
      const binds = [...cols.map((c) => r[c]), ts, ts, who];
      statements.push(env.DB.prepare(
        `INSERT INTO contacts (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})`,
      ).bind(...binds));
      added += 1;
    }
  }

  try {
    for (const batch of chunk(statements, 50)) await env.DB.batch(batch);
  } catch (err) {
    return fail(`Import failed while writing: ${err.message}`, 500);
  }
  return json({ added, updated, skipped });
}
