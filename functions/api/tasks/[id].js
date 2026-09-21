/** /api/tasks/:id — edit / mark done (PUT), delete (DELETE). */
import { json, fail, noDb, readJson, ensureSchema } from '../_lib.js';
const parseId = (params) => { const id = parseInt(params.id, 10); return Number.isInteger(id) && id > 0 ? id : null; };

export async function onRequestPut({ params, request, env }) {
  if (!env.DB) return noDb();
  const id = parseId(params);
  if (!id) return fail('Invalid task id.', 400);
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }
  const sets = [];
  const binds = [];
  if ('done' in body) { sets.push('done = ?'); binds.push(body.done ? 1 : 0); }
  if ('title' in body) { const t = String(body.title || '').trim(); if (!t) return fail('Title cannot be empty.', 400); sets.push('title = ?'); binds.push(t); }
  if ('dueDate' in body) { sets.push('dueDate = ?'); binds.push(String(body.dueDate || '').trim() || null); }
  if ('owner' in body) { sets.push('owner = ?'); binds.push(String(body.owner || '').trim() || null); }
  if ('contactId' in body) { sets.push('contactId = ?'); binds.push(body.contactId != null && body.contactId !== '' ? parseInt(body.contactId, 10) : null); }
  if (!sets.length) return fail('Nothing to update.', 400);
  const task = await env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? RETURNING *`).bind(...binds, id).first();
  if (!task) return fail('Task not found.', 404);
  return json({ task });
}

export async function onRequestDelete({ params, env }) {
  if (!env.DB) return noDb();
  const id = parseId(params);
  if (!id) return fail('Invalid task id.', 400);
  await ensureSchema(env);
  const res = await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  if (!res.meta?.changes) return fail('Task not found.', 404);
  return json({ ok: true, id });
}
