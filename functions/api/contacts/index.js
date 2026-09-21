/**
 * /api/contacts — list (GET, with tags + signed-in user) and create (POST).
 */
import { WRITABLE, json, fail, noDb, now, cleanPayload, readJson, ensureSchema, tagsByContact, currentUser } from '../_lib.js';

const FILTERS = ['entityType', 'stage', 'country', 'vehicle', 'source', 'relationshipOwner'];

export async function onRequestGet({ request, env }) {
  if (!env.DB) return noDb();
  try {
    await ensureSchema(env);
    const url = new URL(request.url);
    const p = url.searchParams;

    const where = [];
    const binds = [];
    const q = (p.get('q') || '').trim();
    if (q) {
      where.push('(lower(fullName) LIKE ?1 OR lower(organisation) LIKE ?1 OR lower(email) LIKE ?1)');
      binds.push(`%${q.toLowerCase()}%`);
    }
    for (const field of FILTERS) {
      const raw = p.get(field);
      if (!raw) continue;
      const vals = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (!vals.length) continue;
      where.push(`${field} IN (${vals.map(() => '?').join(',')})`);
      binds.push(...vals);
    }
    if (p.get('whatsappOptIn') === 'yes') where.push("whatsappOptIn = 'Yes'");
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const limit = Math.min(Math.max(parseInt(p.get('limit') || '100000', 10) || 100000, 1), 100000);
    const offset = Math.max(parseInt(p.get('offset') || '0', 10) || 0, 0);
    const sortCol = ['fullName', 'lastContact', 'nextActionDate', 'stage', 'updatedAt', 'createdAt'].includes(p.get('sort'))
      ? p.get('sort') : 'updatedAt';
    const sortDir = (p.get('order') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM contacts${whereSql}`).bind(...binds).first();
    const rows = await env.DB.prepare(
      `SELECT * FROM contacts${whereSql} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
    ).bind(...binds, limit, offset).all();
    const contacts = rows.results || [];

    const tagMap = await tagsByContact(env, contacts.map((c) => c.id));
    for (const c of contacts) c.tags = tagMap.get(c.id) || [];

    return json({ contacts, total: countRow?.n || 0, limit, offset, user: currentUser(request) });
  } catch (err) {
    return fail(`Could not read contacts: ${err.message}`, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  let values;
  try {
    await ensureSchema(env);
    values = cleanPayload(await readJson(request), 'create');
  } catch (err) {
    return fail(err.message, 400);
  }

  const ts = now();
  const cols = WRITABLE.filter((c) => c in values);
  const allCols = [...cols, 'createdAt', 'updatedAt', 'updatedBy'];
  const bindVals = [...cols.map((c) => values[c]), ts, ts, currentUser(request)];

  try {
    const inserted = await env.DB.prepare(
      `INSERT INTO contacts (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')}) RETURNING *`,
    ).bind(...bindVals).first();
    inserted.tags = [];
    return json({ contact: inserted }, 201);
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) return fail('A contact with that email already exists.', 409);
    return fail(`Could not create the contact: ${err.message}`, 500);
  }
}
