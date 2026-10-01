/**
 * POST /api/replies/ingest — the inbound email → CRM pipeline (Phase 12).
 *
 * The scheduled reader (scripts/email-ingest.mjs, GitHub Actions) POSTs RAW parsed emails
 * here; this endpoint does the AI classification (Bedrock, server-side) and all the CRM
 * updates, so the browser never sees a secret and nothing is ever sent. Authenticated with
 * the shared INGEST_SECRET (Bearer). Body: { emails: [ { fromEmail, fromName, subject, body,
 * receivedAt, messageId } ] } (also accepts `replies`).
 *
 * Per email, GROUNDED and idempotent:
 *  - MATCH to a contact by sender email, else by name, else CREATE one (flagged
 *    "From email — review", stage Target).
 *  - CLASSIFY with Bedrock (or a labelled heuristic when no key): intent, category,
 *    sentiment, suggestedStage, summary, suggestedReply, confidence.
 *  - Store the reply, add an "Email in" Timeline event, apply the stage change ONLY when
 *    confident AND allowed by the gates (a reversible "AI updated from email" log) else flag
 *    it, tag the category, refresh next action + priority, and save the draft reply (never
 *    sent). A message already ingested (by messageId) is skipped — a re-fetch never doubles.
 */
import { json, fail, noDb, now, ensureSchema, currentUser, gateViolation, STAGES, TAG_PALETTE } from '../_lib.js';
import { pickSecret, bearerAuthed, bedrockConfigured, callBedrock } from '../_bedrock.js';
import { INBOUND_PROMPT, parseInbound, heuristicInbound, INBOUND_CATEGORIES, automatedSenderReason } from '../_ai.mjs';

const str = (v) => (v == null ? null : String(v).trim() || null);
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const CONF = 0.7;                    // confidence needed to auto-apply a stage move
const dateOnly = (v) => (str(v) || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
const plusDays = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const ACTION_BY_CATEGORY = {
  'Wants info/deck': 'Send the requested materials', 'Wants a call': 'Book the call',
  Proceeding: 'Progress to diligence', 'Objection/question': 'Answer their questions',
  Committed: 'Confirm the commitment terms', 'Not now': 'Note the revisit timing', Other: 'Reply to their email',
};

/** Resolve (or create) a tag by name → its id. */
async function ensureTag(env, name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const found = await env.DB.prepare('SELECT id FROM tags WHERE lower(name) = lower(?)').bind(clean).first();
  if (found) return found.id;
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags').first();
  const created = await env.DB.prepare('INSERT INTO tags (name, colour) VALUES (?, ?) RETURNING id')
    .bind(clean, TAG_PALETTE[n % TAG_PALETTE.length]).first();
  return created?.id ?? null;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  if (!bearerAuthed(request, pickSecret(env, 'INGEST_SECRET'))) return fail('unauthorized', 401);
  let body;
  try { await ensureSchema(env); body = await request.json(); } catch { return fail('The request body was not valid JSON.', 400); }

  const rows = Array.isArray(body) ? body : Array.isArray(body?.emails) ? body.emails : Array.isArray(body?.replies) ? body.replies : null;
  if (!rows) return fail('Expected { emails: [ … ] }.', 400);
  if (!rows.length) return json({ ok: true, processed: 0, matched: 0, created: 0, skipped: 0, applied: 0, suggested: 0 });
  if (rows.length > 500) return fail('Too many emails in one batch (max 500).', 413);

  const who = currentUser(request);
  const useAi = bedrockConfigured(env);
  const result = { ok: true, processed: 0, matched: 0, created: 0, skipped: 0, skippedAutomated: 0, applied: 0, suggested: 0, items: [] };

  for (const raw of rows) {
    const fromEmail = (str(raw.fromEmail ?? raw.from) || '').toLowerCase() || null;

    // HARDENING: ignore automated / non-human senders (no-reply, mailer-daemon, Google
    // security alerts, calendar invites, …). Never classify, create a contact, or store a
    // reply for these — only genuine investor emails get through. Logged so skips are visible.
    const autoReason = automatedSenderReason(fromEmail);
    if (autoReason) {
      result.skippedAutomated += 1;
      result.items.push({ fromEmail, skippedAutomated: true, reason: autoReason });
      console.log(`[ingest] skipped automated sender ${fromEmail || '(no address)'} — ${autoReason}`);
      continue;
    }

    const fromName = str(raw.fromName);
    const subject = str(raw.subject);
    const emailBody = str(raw.body ?? raw.text ?? raw.snippet) || '';
    const receivedAt = dateOnly(raw.receivedAt);
    const messageId = str(raw.messageId) || (fromEmail ? `${fromEmail}|${receivedAt}|${subject || ''}`.slice(0, 400) : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

    // Idempotent: a message already ingested is never re-processed.
    const seen = await env.DB.prepare('SELECT id FROM replies WHERE messageId = ?').bind(messageId).first();
    if (seen) { result.skipped += 1; result.items.push({ messageId, skipped: true }); continue; }

    // MATCH by email, then by name, else CREATE a flagged Target contact.
    let contact = null;
    let created = false;
    if (fromEmail) contact = await env.DB.prepare('SELECT * FROM contacts WHERE lower(email) = ?').bind(fromEmail).first();
    if (!contact && fromName) contact = await env.DB.prepare('SELECT * FROM contacts WHERE lower(fullName) = lower(?) ORDER BY id LIMIT 1').bind(fromName).first();
    if (!contact) {
      const ts0 = now();
      try {
        contact = await env.DB.prepare(
          `INSERT INTO contacts (fullName, email, stage, source, signal, createdAt, updatedAt, updatedBy)
           VALUES (?, ?, 'Target', 'Email', 'From email — review', ?, ?, ?) RETURNING *`,
        ).bind(fromName || fromEmail || 'Unknown sender', fromEmail, ts0, ts0, 'Email').first();
        created = true;
      } catch {
        // A racing UNIQUE(email) means the contact now exists — re-fetch and match to it.
        if (fromEmail) contact = await env.DB.prepare('SELECT * FROM contacts WHERE lower(email) = ?').bind(fromEmail).first();
        if (!contact) { result.items.push({ messageId, error: 'could not match or create a contact' }); continue; }
      }
    }
    if (created) result.created += 1; else result.matched += 1;

    // CLASSIFY (Bedrock, or the labelled heuristic when no key / on failure).
    let ai;
    if (useAi && emailBody) {
      try {
        const { system, user, maxTokens } = INBOUND_PROMPT({ fromEmail, fromName, subject, body: emailBody }, contact, STAGES);
        const { text, model } = await callBedrock(env, { system, user, maxTokens });
        ai = { ...parseInbound(text, { stages: STAGES, categories: INBOUND_CATEGORIES }), model };
      } catch { ai = heuristicInbound({ fromEmail, fromName, subject, body: emailBody }); }
    } else {
      ai = heuristicInbound({ fromEmail, fromName, subject, body: emailBody });
    }

    // Decide the stage move: confident + forward + gate-allowed → apply; else flag.
    const curIdx = STAGES.indexOf(contact.stage);
    const sugIdx = STAGES.indexOf(ai.suggestedStage);
    let applied = null; let suggestion = null; let gateMsg = null;
    if (ai.suggestedStage && sugIdx > -1 && ai.suggestedStage !== contact.stage) {
      const forward = curIdx > -1 && sugIdx > curIdx;
      if (forward && !created) {
        gateMsg = gateViolation(contact, { stage: ai.suggestedStage });
        if (ai.confidence >= CONF && !gateMsg) applied = ai.suggestedStage;
        else suggestion = ai.suggestedStage;
      } else {
        suggestion = ai.suggestedStage;   // never auto-advance a brand-new or backward record from an email
      }
    }

    const ts = now();
    const stmts = [];

    // 1. Store the reply (grounded record behind the Inbox + the drawer reply cards).
    stmts.push(env.DB.prepare(
      `INSERT INTO replies (contactId, fromEmail, fromName, subject, receivedAt, sentiment, interestSignal,
         questionsAsked, summary, draftReply, category, intent, suggestedStage, messageId, model, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(messageId) DO NOTHING`,
    ).bind(
      contact.id, fromEmail, fromName, subject, receivedAt, ai.sentiment, ai.intent,
      (emailBody.match(/\?/g) || []).length, ai.summary, ai.suggestedReply,
      ai.category, ai.intent, ai.suggestedStage || null, messageId, ai.model || 'bedrock', ts,
    ));

    // 2. "Email in" Timeline event — the summary + the real email text, source "Email".
    const bodyExcerpt = emailBody.replace(/\s+/g, ' ').trim().slice(0, 600);
    const emailInSummary = `📩 ${subject ? subject + ' — ' : ''}${ai.summary}${bodyExcerpt ? `\n\n"${bodyExcerpt}"` : ''}`;
    stmts.push(env.DB.prepare(
      'INSERT INTO activities (contactId, type, summary, occurredAt, createdBy, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(contact.id, 'Email in', emailInSummary, receivedAt, who, 'Email', ts));

    // 3. Stage change — applied (reversible) or flagged as a suggestion.
    if (applied) {
      stmts.push(env.DB.prepare(
        'INSERT INTO activities (contactId, type, summary, occurredAt, createdBy, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(contact.id, 'Stage change', `Stage: ${contact.stage} → ${applied} · AI updated from email`, ts, who, 'Email', ts));
      result.applied += 1;
    } else if (suggestion) {
      const why = gateMsg ? ` (${gateMsg})` : '';
      stmts.push(env.DB.prepare(
        'INSERT INTO activities (contactId, type, summary, occurredAt, createdBy, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(contact.id, 'Note', `Suggested from email: move to ${suggestion}${why}`, ts, who, 'Email', ts));
      result.suggested += 1;
    }

    // 4. Refresh next action + priority + last contact (feeds priorities / follow-ups).
    const nextAction = ACTION_BY_CATEGORY[ai.category] || 'Reply to their email';
    const priority = (ai.category === 'Committed' || ai.category === 'Proceeding' || ai.sentiment === 'Positive')
      ? 'High' : ai.sentiment === 'Negative' ? 'Low' : (str(contact.priority) || 'Medium');
    const sets = ['nextAction = ?', 'nextActionDate = ?', 'priority = ?', 'lastContact = ?', 'updatedAt = ?', 'updatedBy = ?'];
    const binds = [nextAction, plusDays(2), priority, receivedAt, ts, who];
    if (applied) { sets.unshift('stage = ?'); binds.unshift(applied); }
    binds.push(contact.id);
    stmts.push(env.DB.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds));

    // 5. Category as a tag.
    const tagId = await ensureTag(env, ai.category);
    if (tagId) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO contact_tags (contactId, tagId) VALUES (?, ?)').bind(contact.id, tagId));

    try {
      await env.DB.batch(stmts);
      result.processed += 1;
      result.items.push({ messageId, contactId: contact.id, created, category: ai.category, applied, suggestion, sentiment: ai.sentiment });
    } catch (err) {
      result.items.push({ messageId, error: err.message });
    }
  }

  return json(result);
}
