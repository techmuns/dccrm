/**
 * /api/contacts/:id — read one (with activities, tasks and tags), edit (PUT), delete.
 */
import { WRITABLE, json, fail, noDb, now, cleanPayload, readJson, ensureSchema, currentUser } from '../_lib.js';

const parseId = (params) => {
  const id = parseInt(params.id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/**
 * Record a "Stage change" activity when an edit genuinely moved the contact between stages.
 * Written to the same activities table the drawer / grid / prompt box already read, so the move
 * shows on the contact timeline. Grounded: it fires only on a real change. The `x-change-source`
 * header (set by the store) says where the move came from — Grid edit / Prompt box / Manual.
 * Called only when the payload touched `stage`, so `priorStage` is the real pre-edit value.
 */
async function logStageChange(env, request, id, priorStage, updated) {
  const oldS = String(priorStage ?? '').trim();
  const newS = String(updated?.stage ?? '').trim();
  if (oldS === newS) return;                                   // same stage re-selected — no move
  const source = (request.headers.get('x-change-source') || 'Manual').trim().slice(0, 60) || 'Manual';
  const ts = now();
  try {
    await env.DB.prepare(
      'INSERT INTO activities (contactId, type, summary, occurredAt, createdBy, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, 'Stage change', `Stage: ${oldS || '—'} → ${newS || '—'}`, ts, currentUser(request), source, ts).run();
  } catch { /* best-effort; the contact update already succeeded */ }
}

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
    const replies = await env.DB.prepare('SELECT * FROM replies WHERE contactId = ? ORDER BY receivedAt DESC, id DESC LIMIT 20').bind(id).all();
    return json({ contact, activities: activities.results || [], tasks: tasks.results || [], tags: tags.results || [], replies: replies.results || [] });
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
  // Capture the prior stage before the write, so a genuine stage move can be recorded on the
  // contact's timeline (below). Only needed when this edit actually touches the stage.
  let priorStage = null;
  if ('stage' in values) {
    const before = await env.DB.prepare('SELECT stage FROM contacts WHERE id = ?').bind(id).first();
    if (!before) return fail('Contact not found.', 404);
    priorStage = before.stage;
  }
  const cols = WRITABLE.filter((c) => c in values);
  const setSql = [...cols.map((c) => `${c} = ?`), 'updatedAt = ?', 'updatedBy = ?'].join(', ');
  const binds = [...cols.map((c) => values[c]), now(), currentUser(request), id];
  try {
    const updated = await env.DB.prepare(`UPDATE contacts SET ${setSql} WHERE id = ? RETURNING *`).bind(...binds).first();
    if (!updated) return fail('Contact not found.', 404);
    if ('stage' in values) await logStageChange(env, request, id, priorStage, updated);
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
