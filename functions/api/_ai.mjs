/**
 * functions/api/_ai.js — the AI layer's prompts and output parsing, in ONE place.
 *
 * Pure and dependency-free (no D1, no Cloudflare bindings, no npm) so it can be
 * imported unchanged by BOTH the Pages Functions (on-demand calls) and the GitHub
 * Actions runner scripts (bulk work) — the prompt a contact is scored with is then
 * identical whether it ran on-demand or in the nightly batch.
 *
 * Underscore-prefixed, so Cloudflare Pages never treats it as a route.
 */

/* ---------- FEATURE 1 — relationship enrichment ---------- */

const ENRICH_SYSTEM =
  'You are an investor-relations analyst for Dhamma Capital, an investment fund. ' +
  'You read the CRM record of ONE investor contact and judge how warm the relationship is, ' +
  'using ONLY the facts given — never invent details. Reply with STRICT JSON only (no prose, ' +
  'no markdown fences), exactly this shape:\n' +
  '{"interestScore": <integer 0-100>, "band": "Hot"|"Warm"|"Cold", ' +
  '"relationshipSummary": "<one plain-English sentence, <=140 chars>", ' +
  '"suggestedNextStep": "<one concrete next action, <=120 chars>"}\n' +
  'Scoring guide: 70-100 Hot (engaged, replying, near commitment), 40-69 Warm (interested but ' +
  'not yet moving), 0-39 Cold (early, dormant, or unresponsive). Weigh a near-term stage ' +
  '(Meeting Scheduled, Onboarded, In Conversation), recent contact, and a concrete next action ' +
  'as warmer; a long silence or an early/dormant stage as colder.';

/** Compact, token-light snapshot of a contact + its recent activity for scoring. */
export function buildEnrichmentUser(contact, activities = []) {
  const line = (label, v) => (v == null || v === '' ? null : `${label}: ${v}`);
  const acts = (activities || []).slice(0, 8).map((a) => {
    const when = (a.occurredAt || a.createdAt || '').slice(0, 10);
    return `- ${when || '?'} [${a.type || 'note'}] ${a.summary || ''}`.trim();
  });
  const parts = [
    line('Name', contact.fullName),
    line('Type', contact.entityType),
    line('Organisation', contact.organisation),
    line('Designation', contact.designation),
    line('Country', contact.country),
    line('Vehicle', contact.vehicle),
    line('Pipeline stage', contact.stage),
    line('Relationship owner', contact.relationshipOwner),
    line('Source', contact.source),
    line('Last contact', contact.lastContact),
    line('Next action', contact.nextAction),
    line('Next action date', contact.nextActionDate),
    line('Notes', contact.notes),
  ].filter(Boolean);
  if (acts.length) parts.push('Recent activity (newest first):\n' + acts.join('\n'));
  return `Score this investor relationship from the record below.\n\n${parts.join('\n')}`;
}

export const ENRICHMENT_PROMPT = (contact, activities) => ({
  system: ENRICH_SYSTEM,
  user: buildEnrichmentUser(contact, activities),
  maxTokens: 500,
});

/** Turn model text into a validated {interestScore, band, relationshipSummary, suggestedNextStep}. */
export function parseEnrichment(text) {
  const obj = extractJson(text);
  if (!obj || typeof obj !== 'object') throw new Error('AI did not return usable JSON.');
  const interestScore = clampInt(obj.interestScore, 0, 100);
  return {
    interestScore,
    band: bandForScore(interestScore),
    relationshipSummary: cap(str(obj.relationshipSummary), 200),
    suggestedNextStep: cap(str(obj.suggestedNextStep), 200),
  };
}

/* ---------- FEATURE 2 — email-reply intelligence ---------- */

const REPLY_SYSTEM =
  'You are an investor-relations analyst for Dhamma Capital. You read ONE email reply from a ' +
  'prospective or existing investor and extract structured signals, using ONLY what the email ' +
  'says. Reply with STRICT JSON only (no prose, no markdown fences), exactly this shape:\n' +
  '{"sentiment": "Positive"|"Neutral"|"Negative", "interestSignal": "<short phrase, <=60 chars>", ' +
  '"questionsAsked": <integer count of distinct questions the sender asked>, ' +
  '"summary": "<one plain sentence, <=140 chars>", ' +
  '"draftReply": "<a warm, concise, professional draft reply the IR team can send, <=900 chars>"}\n' +
  'The draft must answer or acknowledge the sender\'s questions, keep Dhamma Capital\'s calm ' +
  'professional tone, and never invent numbers, terms or commitments.';

export function buildReplyUser(reply, contact = null) {
  const ctx = contact
    ? `Known contact: ${contact.fullName || ''}${contact.organisation ? ' · ' + contact.organisation : ''}` +
      `${contact.stage ? ' · stage ' + contact.stage : ''}\n\n`
    : '';
  const from = reply.fromEmail || reply.from || 'unknown sender';
  const subject = reply.subject || '(no subject)';
  const body = cap(str(reply.body ?? reply.text ?? reply.snippet), 6000);
  return `${ctx}From: ${from}\nSubject: ${subject}\n\n${body}`;
}

export const REPLY_PROMPT = (reply, contact) => ({
  system: REPLY_SYSTEM,
  user: buildReplyUser(reply, contact),
  maxTokens: 900,
});

export function parseReply(text) {
  const obj = extractJson(text);
  if (!obj || typeof obj !== 'object') throw new Error('AI did not return usable JSON.');
  return {
    sentiment: oneOf(obj.sentiment, ['Positive', 'Neutral', 'Negative'], 'Neutral'),
    interestSignal: cap(str(obj.interestSignal), 80),
    questionsAsked: clampInt(obj.questionsAsked, 0, 50),
    summary: cap(str(obj.summary), 200),
    draftReply: cap(str(obj.draftReply), 1500),
  };
}

/**
 * TEST-MODE fallback (no Bedrock key configured): a transparent, deterministic
 * heuristic so the whole ingest → D1 → UI pipeline is demonstrable NOW. It is
 * clearly labelled (model: "test-heuristic") and is replaced by real Bedrock output
 * the moment BEDROCK_API_KEY is set. Never used when a key is present.
 */
export function heuristicReply(reply) {
  const body = str(reply.body ?? reply.text ?? reply.snippet).toLowerCase();
  const questionsAsked = Math.min(50, (str(reply.body ?? reply.text).match(/\?/g) || []).length);
  const pos = /(interested|great|thank|happy|keen|look forward|excited|yes|proceed|sounds good)/.test(body);
  const neg = /(not interested|unfortunately|decline|pass|no longer|unsubscribe|too high|concern|hesitant)/.test(body);
  const sentiment = neg ? 'Negative' : pos ? 'Positive' : 'Neutral';
  const first = cap(str(reply.body ?? reply.text).replace(/\s+/g, ' ').trim(), 140);
  return {
    sentiment,
    interestSignal: neg ? 'Reservations raised' : pos ? 'Positive engagement' : 'Acknowledged',
    questionsAsked,
    summary: first || 'Reply received.',
    draftReply:
      `Dear ${str(reply.fromName) || 'investor'},\n\nThank you for your note — we appreciate you taking the time to reply. ` +
      `We would be glad to address your questions and share whatever detail is useful. ` +
      `Would a short call in the coming days suit you?\n\nWarm regards,\nDhamma Capital — Investor Relations`,
    model: 'test-heuristic',
  };
}

/* ---------- shared JSON extraction + tiny validators ---------- */

/** Pull the first JSON object out of model text, tolerating ```fences``` and stray prose. */
export function extractJson(text) {
  if (text == null) return null;
  let s = String(text).trim();
  // strip a leading ```json / ``` fence and its closing fence
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // direct parse first
  try { return JSON.parse(s); } catch { /* fall through to brace scan */ }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = s.slice(start, end + 1);
    try { return JSON.parse(slice); } catch { /* give up */ }
  }
  return null;
}

export function bandForScore(score) {
  const n = Number(score) || 0;
  return n >= 70 ? 'Hot' : n >= 40 ? 'Warm' : 'Cold';
}

const str = (v) => (v == null ? '' : String(v).trim());
const cap = (v, n) => { const s = str(v); return s.length > n ? s.slice(0, n) : s; };
const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
};
const oneOf = (v, allowed, fallback) => (allowed.includes(str(v)) ? str(v) : fallback);
