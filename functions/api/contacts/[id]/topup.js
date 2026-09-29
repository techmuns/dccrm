/**
 * /api/contacts/:id/topup — add a top-up to an existing Invested LP (Phase 11).
 *
 * A top-up is a NEW pipeline record at stage Committed, linked to the LP (linkedLp) and
 * flagged isTopUp. It copies the person's identity from the LP (but NOT the email — that
 * column is UNIQUE), and carries the commitment terms so it satisfies the Committed gate.
 * The old Invested record is never touched. "Top-up started" is logged on BOTH timelines.
 */
import { WRITABLE, json, fail, noDb, now, readJson, ensureSchema, currentUser, gateViolation } from '../../_lib.js';

const parseId = (params) => { const id = parseInt(params.id, 10); return Number.isInteger(id) && id > 0 ? id : null; };

/* Identity carried over to the top-up record — everything that identifies the person,
   except the UNIQUE email (a second record can't reuse it). */
const COPY = ['fullName', 'organisation', 'entityType', 'role', 'designation', 'phone', 'altPhone',
  'whatsapp', 'whatsappOptIn', 'country', 'city', 'relationshipOwner', 'source', 'referredBy', 'tier', 'priority'];

export async function onRequestPost({ params, request, env }) {
  if (!env.DB) return noDb();
  const lpId = parseId(params);
  if (!lpId) return fail('Invalid LP id.', 400);
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }

  const lp = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(lpId).first();
  if (!lp) return fail('LP not found.', 404);
  if (String(lp.stage || '') !== 'Invested') return fail('Top-ups can only be added to an Invested LP.', 422);

  const clean = (v) => { const s = String(v == null ? '' : v).trim(); return s === '' ? null : s; };
  const values = { stage: 'Committed', isTopUp: 1, linkedLp: lpId };
  for (const k of COPY) values[k] = lp[k] ?? null;
  values.vehicle = clean(body.vehicle) || lp.vehicle || null;
  values.committedAmount = clean(body.committedAmount);
  values.fundingDate = clean(body.fundingDate);
  values.targetTicket = clean(body.targetTicket);

  // Same Committed gate everyone else hits: a commitment needs an amount and a funding date.
  const gate = gateViolation({}, values);
  if (gate) return fail(gate, 422);

  const ts = now();
  const who = currentUser(request);
  const cols = WRITABLE.filter((c) => c in values && values[c] != null);
  const allCols = [...cols, 'createdAt', 'updatedAt', 'updatedBy'];
  const binds = [...cols.map((c) => values[c]), ts, ts, who];

  try {
    const created = await env.DB.prepare(
      `INSERT INTO contacts (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')}) RETURNING *`,
    ).bind(...binds).first();
    // Log "Top-up started" on both the new record and the LP.
    const src = (request.headers.get('x-change-source') || 'Manual').trim().slice(0, 60) || 'Manual';
    const act = (cid, summary) => env.DB.prepare(
      'INSERT INTO activities (contactId, type, summary, occurredAt, createdBy, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(cid, 'Top-up', summary, ts, who, src, ts);
    await env.DB.batch([
      act(created.id, `Top-up started — new commitment linked to ${lp.fullName || 'the LP'} (#${lpId})`),
      act(lpId, `Top-up started — new record #${created.id} opened at Committed`),
    ]);
    created.tags = [];
    return json({ contact: created, lpId }, 201);
  } catch (err) {
    return fail(`Could not create the top-up: ${err.message}`, 500);
  }
}
