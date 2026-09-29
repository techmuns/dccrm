/**
 * /api/contacts/:id — read one (with activities, tasks and tags), edit (PUT), delete.
 */
import { WRITABLE, json, fail, noDb, now, cleanPayload, readJson, ensureSchema, currentUser, gateViolation } from '../_lib.js';

const parseId = (params) => {
  const id = parseInt(params.id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/* Pipeline fields whose changes are recorded on the contact timeline. */
const TRACKED = ['stage', 'heat', 'dormant', 'closedStatus'];

/**
 * Record timeline activities for a genuine pipeline change — Stage move, Heat change, Dormant
 * on/off, or Close/Reopen — each as its own event. Written to the same activities table the
 * drawer / grid / prompt box already read. Grounded: only real changes are logged. The
 * `x-change-source` header (set by the store) says where the change came from.
 */
async function logChanges(env, request, id, before, updated) {
  const src = (request.headers.get('x-change-source') || 'Manual').trim().slice(0, 60) || 'Manual';
  const S = (v) => String(v ?? '').trim();
  const wasClosed = !!S(before.closedStatus);
  const nowClosed = !!S(updated.closedStatus);
  const reopened = wasClosed && !nowClosed;
  const events = [];

  // Stage — skip the redundant move a Reopen implies (Reopen logs its own event below).
  if (S(before.stage) !== S(updated.stage) && !reopened) {
    events.push(['Stage change', `Stage: ${S(before.stage) || '—'} → ${S(updated.stage) || '—'}`]);
  }
  // Heat
  if (S(before.heat) !== S(updated.heat)) {
    events.push(['Heat change', `Heat: ${S(before.heat) || '—'} → ${S(updated.heat) || '—'}`]);
  }
  // Dormant on/off
  const wasDorm = Number(before.dormant) === 1;
  const nowDorm = Number(updated.dormant) === 1;
  if (wasDorm !== nowDorm) {
    events.push(['Dormant', nowDorm
      ? (S(updated.wakeDate) ? `Marked dormant · wake ${S(updated.wakeDate)}` : 'Marked dormant')
      : 'Dormant cleared']);
  }
  // Close / Reopen
  if (!wasClosed && nowClosed) {
    const label = S(updated.closedStatus) === 'disqualified' ? 'Disqualified' : 'Passed';
    events.push(['Status', S(updated.revisitDate) ? `Closed — ${label} · revisit ${S(updated.revisitDate)}` : `Closed — ${label}`]);
  } else if (reopened) {
    events.push(['Status', `Reopened → ${S(updated.stage) || 'Target'}`]);
  }

  if (!events.length) return;
  const ts = now();
  const who = currentUser(request);
  try {
    await env.DB.batch(events.map(([type, summary]) =>
      env.DB.prepare('INSERT INTO activities (contactId, type, summary, occurredAt, createdBy, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, type, summary, ts, who, src, ts)));
  } catch { /* best-effort; the contact update already succeeded */ }
}

/**
 * Phase 11 — when a record reaches Invested, make sure the person is on the LP book.
 * LPs are derived from Invested contacts, so a base record becoming Invested simply IS a new
 * LP: we log it and default its reporting status. A top-up reaching Invested adds to its linked
 * LP's total, so we log on both records. Best-effort — the stage change already succeeded.
 */
async function onReachedInvested(env, request, id, updated) {
  const ts = now();
  const who = currentUser(request);
  const src = (request.headers.get('x-change-source') || 'Manual').trim().slice(0, 60) || 'Manual';
  const act = (cid, summary) => env.DB.prepare(
    'INSERT INTO activities (contactId, type, summary, occurredAt, createdBy, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(cid, 'LP', summary, ts, who, src, ts);
  const stmts = [];
  if (Number(updated.isTopUp) === 1 && updated.linkedLp) {
    stmts.push(act(id, 'Top-up reached Invested — added to the LP total'));
    const root = await env.DB.prepare('SELECT id FROM contacts WHERE id = ?').bind(updated.linkedLp).first();
    if (root) stmts.push(act(root.id, `Top-up (#${id}) reached Invested — total updated`));
  } else {
    stmts.push(act(id, 'Reached Invested — added to the LP book'));
    stmts.push(env.DB.prepare("UPDATE contacts SET reportingStatus = 'Due' WHERE id = ? AND (reportingStatus IS NULL OR reportingStatus = '')").bind(id));
  }
  try { await env.DB.batch(stmts); } catch { /* best-effort */ }
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
  // Capture the prior pipeline fields before the write, so genuine changes can be recorded on
  // the contact's timeline (below). Only needed when this edit actually touches one of them.
  let before = null;
  if (TRACKED.some((k) => k in values)) {
    before = await env.DB.prepare(
      'SELECT stage, heat, dormant, closedStatus, wakeDate, revisitDate, vehicle, targetTicket, committedAmount, fundingDate FROM contacts WHERE id = ?',
    ).bind(id).first();
    if (!before) return fail('Contact not found.', 404);
    // Phase 10 — enforce the hard pipeline gates here, so no editor path can bypass them.
    const gate = gateViolation(before, values);
    if (gate) return fail(gate, 422);
  }
  const cols = WRITABLE.filter((c) => c in values);
  const setSql = [...cols.map((c) => `${c} = ?`), 'updatedAt = ?', 'updatedBy = ?'].join(', ');
  const binds = [...cols.map((c) => values[c]), now(), currentUser(request), id];
  try {
    const updated = await env.DB.prepare(`UPDATE contacts SET ${setSql} WHERE id = ? RETURNING *`).bind(...binds).first();
    if (!updated) return fail('Contact not found.', 404);
    if (before) await logChanges(env, request, id, before, updated);
    // Phase 11 — reaching Invested puts the person on the LP book (and rolls a top-up into its LP).
    if (before && String(before.stage) !== 'Invested' && String(updated.stage) === 'Invested') {
      await onReachedInvested(env, request, id, updated);
    }
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
