/** /api/tasks — list (GET; ?open=1, ?contactId=) and create (POST). */
import { json, fail, noDb, now, readJson, ensureSchema, currentUser } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB) return noDb();
  await ensureSchema(env);
  const p = new URL(request.url).searchParams;
  const where = [];
  const binds = [];
  if (p.get('open') === '1') where.push('t.done = 0');
  if (p.get('contactId')) { where.push('t.contactId = ?'); binds.push(parseInt(p.get('contactId'), 10)); }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  // join the contact name so the Follow-ups list can show who each task is for
  const rows = await env.DB.prepare(
    `SELECT t.*, c.fullName AS contactName, c.organisation AS contactOrg
     FROM tasks t LEFT JOIN contacts c ON c.id = t.contactId${whereSql}
     ORDER BY t.done ASC, (t.dueDate IS NULL) ASC, t.dueDate ASC, t.id DESC`,
  ).bind(...binds).all();
  return json({ tasks: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }
  const title = String(body.title || '').trim();
  if (!title) return fail('A task needs a title.', 400);
  const contactId = body.contactId != null && body.contactId !== '' ? parseInt(body.contactId, 10) : null;
  const dueDate = String(body.dueDate || '').trim() || null;
  const owner = String(body.owner || '').trim() || null;
  const intent = String(body.intent || '').trim().slice(0, 60) || null;   // suggested draft intent
  try {
    const task = await env.DB.prepare(
      'INSERT INTO tasks (contactId, title, dueDate, done, owner, intent, createdBy, createdAt) VALUES (?, ?, ?, 0, ?, ?, ?, ?) RETURNING *',
    ).bind(contactId, title, dueDate, owner, intent, currentUser(request), now()).first();
    return json({ task }, 201);
  } catch (err) {
    return fail(`Could not create the task: ${err.message}`, 500);
  }
}
