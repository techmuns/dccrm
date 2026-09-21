/**
 * POST /api/replies/ingest — the email-reply pipeline writes analysed client replies
 * here. Each reply is matched to a contact by sender email and stored in D1, so the
 * AI Insights "respond within 2–3 days" queue and the drawer's reply cards show REAL
 * data. Authenticated with the shared INGEST_SECRET (Bearer) — the same handshake the
 * scheduled GitHub Action uses. Body:
 *   { replies: [ { fromEmail, fromName, subject, receivedAt, sentiment, interestSignal,
 *                  questionsAsked, summary, draftReply, messageId, model } ] }
 */
import { json, fail, noDb, now, ensureSchema } from '../_lib.js';
import { pickSecret, bearerAuthed } from '../_bedrock.js';

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const str = (v) => (v == null ? null : String(v).trim() || null);
const clampInt = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };
const sentimentOf = (v) => (['Positive', 'Neutral', 'Negative'].includes(String(v)) ? String(v) : 'Neutral');

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  if (!bearerAuthed(request, pickSecret(env, 'INGEST_SECRET'))) return fail('unauthorized', 401);
  let body;
  try { await ensureSchema(env); body = await request.json(); } catch { return fail('The request body was not valid JSON.', 400); }

  const rows = Array.isArray(body) ? body : Array.isArray(body?.replies) ? body.replies : null;
  if (!rows) return fail('Expected { replies: [ … ] }.', 400);
  if (!rows.length) return json({ ok: true, stored: 0, matched: 0, unmatched: 0 });
  if (rows.length > 2000) return fail('Too many replies in one batch (max 2,000).', 413);

  // Resolve sender emails → contact ids (chunked IN queries).
  const emails = [...new Set(rows.map((r) => (str(r.fromEmail ?? r.from) || '').toLowerCase()).filter(Boolean))];
  const emailToId = new Map();
  try {
    for (const group of chunk(emails, 100)) {
      if (!group.length) continue;
      const res = await env.DB.prepare(
        `SELECT id, lower(email) AS e FROM contacts WHERE lower(email) IN (${group.map(() => '?').join(',')})`,
      ).bind(...group).all();
      for (const c of res.results || []) emailToId.set(c.e, c.id);
    }
  } catch (err) {
    return fail(`Could not match senders to contacts: ${err.message}`, 500);
  }

  const ts = now();
  const stmts = [];
  let matched = 0;
  let unmatched = 0;
  for (const r of rows) {
    const fromEmail = (str(r.fromEmail ?? r.from) || '').toLowerCase() || null;
    const contactId = fromEmail ? (emailToId.get(fromEmail) ?? null) : null;
    if (contactId) matched += 1; else unmatched += 1;
    // A stable id so re-ingesting the same email updates rather than duplicates.
    const messageId = str(r.messageId) || (fromEmail ? `${fromEmail}|${str(r.receivedAt) || ''}|${str(r.subject) || ''}`.slice(0, 400) : null);
    stmts.push(env.DB.prepare(
      `INSERT INTO replies (contactId, fromEmail, fromName, subject, receivedAt, sentiment, interestSignal, questionsAsked, summary, draftReply, messageId, model, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(messageId) DO UPDATE SET
         contactId = excluded.contactId, subject = excluded.subject, receivedAt = excluded.receivedAt,
         sentiment = excluded.sentiment, interestSignal = excluded.interestSignal, questionsAsked = excluded.questionsAsked,
         summary = excluded.summary, draftReply = excluded.draftReply, model = excluded.model`,
    ).bind(
      contactId, fromEmail, str(r.fromName), str(r.subject), str(r.receivedAt), sentimentOf(r.sentiment),
      str(r.interestSignal), clampInt(r.questionsAsked, 0, 50), str(r.summary), str(r.draftReply),
      messageId, str(r.model) || 'bedrock', ts,
    ));
  }

  try {
    for (const b of chunk(stmts, 50)) await env.DB.batch(b);
  } catch (err) {
    return fail(`Could not store replies: ${err.message}`, 500);
  }
  return json({ ok: true, stored: rows.length, matched, unmatched });
}
