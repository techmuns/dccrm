/**
 * /api/maintenance — date-driven auto-actions (Phase 10).
 *
 * No background worker: the client calls this on load, exactly like the priorities /
 * follow-ups compute from real dates. But because these actions WRITE (clear a flag,
 * reopen a record, create a reminder, log the timeline) they run here, server-side,
 * atomically and idempotently:
 *
 *   • A dormant record whose wake date has arrived   → clear Dormant (Stage unchanged),
 *     create a reminder for the owner, and log a Timeline event.
 *   • A closed record whose revisit date has arrived → reopen it at Target, create a
 *     reminder for the owner, and log a Timeline event.
 *
 * Idempotent: once a row is woken / reopened it no longer matches, so repeated calls
 * (every app load) are safe no-ops.
 */
import { json, fail, noDb, now, ensureSchema } from './_lib.js';

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const today = () => new Date().toISOString().slice(0, 10);

export async function onRequestPost({ env }) {
  if (!env.DB) return noDb();
  await ensureSchema(env);
  const ts = now();
  const day = today();
  const stmts = [];
  let wokeDormant = 0;
  let reopened = 0;

  const task = (id, title, owner) => env.DB.prepare(
    'INSERT INTO tasks (contactId, title, dueDate, done, owner, intent, createdBy, createdAt) VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
  ).bind(id, title, day, owner || 'Team', 'Re-engage (gone quiet)', 'Auto', ts);
  const logEvent = (id, type, summary) => env.DB.prepare(
    'INSERT INTO activities (contactId, type, summary, occurredAt, createdBy, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, type, summary, ts, 'Auto', 'Auto', ts);

  try {
    // 1. Dormant wake date reached — clear Dormant, keep the Stage.
    const dorm = await env.DB.prepare(
      "SELECT id, relationshipOwner, wakeDate FROM contacts WHERE dormant = 1 AND wakeDate IS NOT NULL AND trim(wakeDate) != '' AND date(wakeDate) <= date(?)",
    ).bind(day).all();
    for (const c of (dorm.results || [])) {
      wokeDormant += 1;
      stmts.push(env.DB.prepare("UPDATE contacts SET dormant = 0, wakeDate = '', updatedAt = ?, updatedBy = ? WHERE id = ?").bind(ts, 'Auto', c.id));
      stmts.push(task(c.id, 'Dormant woke up — follow up', c.relationshipOwner));
      stmts.push(logEvent(c.id, 'Dormant', `Woke from dormant — wake date (${c.wakeDate}) reached`));
    }

    // 2. Revisit date reached on a closed record — reopen at Target.
    const rev = await env.DB.prepare(
      "SELECT id, relationshipOwner, revisitDate FROM contacts WHERE closedStatus IN ('passed','disqualified') AND revisitDate IS NOT NULL AND trim(revisitDate) != '' AND date(revisitDate) <= date(?)",
    ).bind(day).all();
    for (const c of (rev.results || [])) {
      reopened += 1;
      stmts.push(env.DB.prepare("UPDATE contacts SET closedStatus = '', stage = 'Target', revisitDate = '', updatedAt = ?, updatedBy = ? WHERE id = ?").bind(ts, 'Auto', c.id));
      stmts.push(task(c.id, 'Revisit — reopened at Target', c.relationshipOwner));
      stmts.push(logEvent(c.id, 'Status', `Reopened → Target — revisit date (${c.revisitDate}) reached`));
    }

    if (stmts.length) for (const group of chunk(stmts, 50)) await env.DB.batch(group);
  } catch (err) {
    return fail(`Maintenance failed: ${err.message}`, 500);
  }
  return json({ ok: true, wokeDormant, reopened, tasksCreated: wokeDormant + reopened, ranAt: ts });
}
