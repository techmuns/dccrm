/**
 * /api/contacts/:id — read one (with activities, tasks and tags), edit (PUT), delete.
 */
import { WRITABLE, json, fail, noDb, now, cleanPayload, readJson, ensureSchema, currentUser } from '../_lib.js';

const parseId = (params) => {
  const id = parseInt(params.id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export async function onRequestGet({ params, env }) {
  if (!env.DB) return noDb();
  const id = parseId(params);
  if (!id) return fail('Invalid contact id.', 400);
  try {
    await ensureSchema(env);
    const contact = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
    if (!contact) return fail('Contact not found.', 404);
    const activities = await env.DB.prepare('SELECT * FROM activities WHERE contactId = ? ORDER BY occurredAt DESC, id DESC').bind(id).all();
    const tasks = await env.DB.prepare('SELECT * FROM tasks WHERE contactId = ? ORDER BY done ASC, dueDate ASC, id DESC').bind(id).all();
    const tags = await env.DB.prepare('SELECT t.id, t.name, t.colour FROM contact_tags ct JOIN tags t ON t.id = ct.tagId WHERE ct.contactId = ? ORDER BY t.name').bind(id).all();
    return json({ contact, activities: activities.results || [], tasks: tasks.results || [], tags: tags.results || [] });
  } catch (err) {
    return fail(`Could not read the contact: ${err.message}`, 500);
  }
}

export async function onRequestPut({ params, request, env }) {
  if (!env.DB) return noDb();
  const id = parseId(params);
  if (!id) return fail('Invalid contact id.', 400);
  let values;
  try {
    await ensureSchema(env);
    values = cleanPayload(await readJson(request), 'patch');
  } catch (err) {
    return fail(err.message, 400);
  }
  const cols = WRITABLE.filter((c) => c in values);
  const setSql = [...cols.map((c) => `${c} = ?`), 'updatedAt = ?', 'updatedBy = ?'].join(', ');
  const binds = [...cols.map((c) => values[c]), now(), currentUser(request), id];
  try {
    const updated = await env.DB.prepare(`UPDATE contacts SET ${setSql} WHERE id = ? RETURNING *`).bind(...binds).first();
    if (!updated) return fail('Contact not found.', 404);
    return json({ contact: updated });
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) return fail('Another contact already uses that email.', 409);
    return fail(`Could not update the contact: ${err.message}`, 500);
  }
}

export async function onRequestDelete({ params, env }) {
  if (!env.DB) return noDb();
  const id = parseId(params);
  if (!id) return fail('Invalid contact id.', 400);
  try {
    await ensureSchema(env);
    const res = await env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(id).run();
    if (!res.meta?.changes) return fail('Contact not found.', 404);
    return json({ ok: true, id });
  } catch (err) {
    return fail(`Could not delete the contact: ${err.message}`, 500);
  }
}
