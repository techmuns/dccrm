/**
 * /api/contacts/:id/activities — list (GET) and log (POST), stamped with who did it.
 */
import { json, fail, noDb, now, readJson, ensureSchema, currentUser } from '../../_lib.js';

const parseId = (params) => { const id = parseInt(params.id, 10); return Number.isInteger(id) && id > 0 ? id : null; };
const TYPES = ['Note', 'Call', 'Email', 'Meeting', 'WhatsApp', 'Stage change', 'Other'];

export async function onRequestGet({ params, env }) {
  if (!env.DB) return noDb();
  const id = parseId(params);
  if (!id) return fail('Invalid contact id.', 400);
  await ensureSchema(env);
  const rows = await env.DB.prepare('SELECT * FROM activities WHERE contactId = ? ORDER BY occurredAt DESC, id DESC').bind(id).all();
  return json({ activities: rows.results || [] });
}

export async function onRequestPost({ params, request, env }) {
  if (!env.DB) return noDb();
  const id = parseId(params);
  if (!id) return fail('Invalid contact id.', 400);
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }

  const summary = String(body.summary || body.note || '').trim();
  if (!summary) return fail('An activity needs a short note.', 400);
  const type = TYPES.includes(String(body.type)) ? String(body.type) : 'Note';
  const occurredAt = String(body.occurredAt || '').trim() || now();
  const ts = now();
  try {
    const contact = await env.DB.prepare('SELECT id FROM contacts WHERE id = ?').bind(id).first();
    if (!contact) return fail('Contact not found.', 404);
    const activity = await env.DB.prepare(
      'INSERT INTO activities (contactId, type, summary, occurredAt, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
    ).bind(id, type, summary, occurredAt, currentUser(request), ts).first();
    await env.DB.prepare('UPDATE contacts SET updatedAt = ?, updatedBy = ? WHERE id = ?').bind(ts, currentUser(request), id).run();
    return json({ activity }, 201);
  } catch (err) {
    return fail(`Could not log the activity: ${err.message}`, 500);
  }
}
