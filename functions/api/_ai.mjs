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
const clampNum = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };

/* =====================================================================================
 * PHASE 3 — the intelligence layer (input · read · output). Every prompt is grounded:
 * the model is only ever given real contacts (from D1) and must reference them by #id;
 * the parsers then keep ONLY real ids, real field names and real stages, so nothing the
 * UI shows can be invented. Field/stage lists are passed in by the endpoint (sourced
 * from _lib) so this pure module never hardcodes the schema.
 * ===================================================================================== */

/* ---------- 3.1 UPDATE box (input) — one structured update per investor mentioned ---------- */

export function buildUpdateSystem(fields, stages) {
  return [
    'You are an assistant for the investor-relations team at Dhamma Capital, an investment fund.',
    'The user pastes freeform notes — a call note, a WhatsApp or email thread, or a blob — that may mention SEVERAL investors at once.',
    'For EACH investor mentioned, produce ONE structured update, grounded ONLY in the pasted text and the existing-contact list provided. NEVER invent contacts, numbers, dates or facts.',
    'Match to an existing contact ONLY when the text clearly refers to them (by name, organisation, email, phone or WhatsApp). If two or more could match, mark it ambiguous and list their ids. If the text introduces a genuinely new person, mark it new.',
    'Reply with STRICT JSON only — no prose, no markdown fences — exactly this shape:',
    '{"updates":[{"matchType":"existing"|"new"|"ambiguous","contactId":<number|null>,"candidates":[<number>],"proposedFields":{<field>:<value>},"note":"<what was learned, <=3 sentences>","suggestedStage":"<stage or empty>","confidence":<0..1>}]}',
    `Allowed field names for proposedFields (use these EXACT names; include ONLY fields that should change): ${[...fields].join(', ')}.`,
    `Allowed pipeline stages (use EXACTLY one of these for stage / suggestedStage): ${[...stages].join(', ')}.`,
    'matchType "existing" → set contactId to the matched id. "new" → contactId null and proposedFields MUST include fullName. "ambiguous" → contactId null and candidates listing the possible ids.',
    'Dates must be YYYY-MM-DD. Keep "note" a short plain-English memory the team can read later. Output one updates entry per investor mentioned, and nothing for investors not mentioned.',
  ].join('\n');
}

export function buildUpdateUser({ text, hint, book }) {
  const hintLine = str(hint) ? `The user says this note is about: ${str(hint)}\n\n` : '';
  const bookText = book.map((c) =>
    `#${c.id} ${c.fullName || '(no name)'} | org:${c.organisation || '-'} | email:${c.email || '-'} | phone:${c.phone || '-'} | wa:${c.whatsapp || '-'} | stage:${c.stage || '-'} | tags:${c.signal || '-'}`,
  ).join('\n');
  return `${hintLine}PASTED NOTES:\n"""\n${cap(str(text), 12000)}\n"""\n\nEXISTING CONTACTS (match ONLY to these; reference by #id):\n${bookText || '(none yet)'}`;
}

export const UPDATE_PROMPT = ({ text, hint, book, fields, stages }) => ({
  system: buildUpdateSystem(fields, stages),
  user: buildUpdateUser({ text, hint, book }),
  maxTokens: 2200,
});

/** Validate the model's updates against real ids / fields / stages. Never trusts free text. */
export function parseUpdates(text, { validIds, allowedFields, allowedStages }) {
  const obj = extractJson(text);
  const arr = obj && Array.isArray(obj.updates) ? obj.updates : (Array.isArray(obj) ? obj : null);
  if (!arr) throw new Error('The AI did not return usable JSON.');
  const out = [];
  for (const u of arr.slice(0, 40)) {
    if (!u || typeof u !== 'object') continue;

    const proposed = {};
    if (u.proposedFields && typeof u.proposedFields === 'object') {
      for (const [k, v] of Object.entries(u.proposedFields)) {
        if (!allowedFields.has(k)) continue;                 // real field names only
        let val = v == null ? '' : String(v).trim();
        if (k === 'stage' && val && !allowedStages.has(val)) continue;   // real stages only
        if (k === 'email') val = val.toLowerCase();
        if (val === '') continue;
        proposed[k] = cap(val, 2000);
      }
    }
    let suggestedStage = str(u.suggestedStage);
    if (suggestedStage && !allowedStages.has(suggestedStage)) suggestedStage = '';
    if (suggestedStage && !proposed.stage) proposed.stage = suggestedStage;

    const candidates = Array.isArray(u.candidates)
      ? [...new Set(u.candidates.map((x) => Number(x)).filter((x) => validIds.has(x)))] : [];
    let contactId = Number(u.contactId);
    contactId = validIds.has(contactId) ? contactId : null;

    let matchType = oneOf(u.matchType, ['existing', 'new', 'ambiguous'], contactId ? 'existing' : 'new');
    if (matchType === 'existing' && !contactId) matchType = candidates.length ? 'ambiguous' : 'new';
    if (matchType === 'ambiguous' && candidates.length < 1) matchType = contactId ? 'existing' : 'new';
    if (matchType === 'new' && !proposed.fullName) { if (contactId) matchType = 'existing'; else continue; }

    const note = cap(str(u.note), 600);
    if (!Object.keys(proposed).length && !note) continue;    // nothing actionable

    out.push({
      matchType,
      contactId: matchType === 'existing' ? contactId : null,
      candidates: matchType === 'ambiguous' ? candidates : [],
      proposedFields: proposed,
      suggestedStage,
      note,
      confidence: clampNum(u.confidence, 0, 1),
    });
  }
  return out;
}

/* ---------- 3.2 ASK box (read) — a plain answer + the ids of the real matches ---------- */

export function buildAskSystem(fields) {
  return [
    "You are an assistant for Dhamma Capital's investor-relations team.",
    'Answer the user\'s plain-English question using ONLY the contacts listed below. Never invent contacts.',
    'Reply with STRICT JSON only — no prose, no fences — exactly:',
    '{"answer":"<=2 plain sentences","contactIds":[<number>],"columns":[<field>]}',
    `contactIds MUST be ids drawn from the list. columns are which fields to show, chosen from: ${[...fields].join(', ')}.`,
    'If nothing matches, return an empty contactIds array and say so plainly in answer. No jargon.',
  ].join('\n');
}

export function buildAskUser({ question, book }) {
  const bookText = book.map((c) =>
    `#${c.id} ${c.fullName || '-'} | type:${c.entityType || '-'} | org:${c.organisation || '-'} | stage:${c.stage || '-'} | country:${c.country || '-'} | city:${c.city || '-'} | tier:${c.tier || '-'} | priority:${c.priority || '-'} | owner:${c.relationshipOwner || '-'} | last:${c.lastContact || '-'} | next:${c.nextActionDate || '-'} | tags:${c.signal || '-'}`,
  ).join('\n');
  return `QUESTION: ${cap(str(question), 500)}\n\nCONTACTS:\n${bookText || '(none yet)'}`;
}

export const ASK_PROMPT = ({ question, book, fields }) => ({
  system: buildAskSystem(fields),
  user: buildAskUser({ question, book }),
  maxTokens: 1600,
});

export function parseAsk(text, { validIds, displayFields, defaultColumns }) {
  const obj = extractJson(text);
  if (!obj || typeof obj !== 'object') throw new Error('The AI did not return usable JSON.');
  const contactIds = Array.isArray(obj.contactIds)
    ? [...new Set(obj.contactIds.map((x) => Number(x)).filter((x) => validIds.has(x)))] : [];
  let columns = Array.isArray(obj.columns) ? obj.columns.filter((c) => displayFields.has(c)) : [];
  if (!columns.length) columns = defaultColumns.slice();
  return { answer: cap(str(obj.answer), 400), contactIds, columns };
}

/* ---------- 3.3 DRAFT a message (output) — editable, never auto-sent ---------- */

export function buildDraftSystem() {
  return [
    "You write short, specific outreach messages for Dhamma Capital's investor-relations team.",
    'Use ONLY the facts provided about the contact and their notes. Never invent numbers, returns, terms or commitments, and never promise anything.',
    'Match the requested intent and channel. Email: a short professional note — a greeting, 1–3 short paragraphs, a sign-off — plus a subject line. WhatsApp: shorter and warmer, 2–4 sentences, no subject.',
    'Be specific to this person: use their name, organisation, stage and last contact where it reads naturally. Plain English, no jargon.',
    'Reply with STRICT JSON only: {"subject":"<email subject, or empty for WhatsApp>","draft":"<the message>"}',
  ].join('\n');
}

export function buildDraftUser({ contact, notes, intent, channel }) {
  const f = (l, v) => (v ? `${l}: ${v}` : null);
  const lines = [
    f('Name', contact.fullName), f('Organisation', contact.organisation), f('Type', contact.entityType),
    f('Stage', contact.stage), f('Vehicle', contact.vehicle), f('Country', contact.country),
    f('Last contact', contact.lastContact), f('Next action', contact.nextAction),
    f('Relationship owner', contact.relationshipOwner), f('Notes', contact.notes),
  ].filter(Boolean);
  const mem = (notes || []).slice(0, 12).map((a) =>
    `- ${(a.occurredAt || a.createdAt || '').slice(0, 10)} [${a.type || 'Note'}] ${a.summary || ''}`.trim());
  return `INTENT: ${str(intent)}\nCHANNEL: ${str(channel) || 'Email'}\n\nCONTACT:\n${lines.join('\n')}` +
    (mem.length ? `\n\nMEMORY / NOTES (newest first):\n${mem.join('\n')}` : '');
}

export const DRAFT_PROMPT = ({ contact, notes, intent, channel }) => ({
  system: buildDraftSystem(),
  user: buildDraftUser({ contact, notes, intent, channel }),
  maxTokens: 900,
});

export function parseDraft(text) {
  const obj = extractJson(text);
  if (obj && typeof obj === 'object' && (obj.draft || obj.subject)) {
    return { subject: cap(str(obj.subject), 200), draft: cap(str(obj.draft), 3000) };
  }
  const t = cap(str(text), 3000);           // tolerate a plain-text reply
  if (!t) throw new Error('The AI returned an empty draft.');
  return { subject: '', draft: t };
}

/* ---------- 3.4 "Why now" one-liners for the rule-based priorities list (optional) ---------- */

export function buildWhySystem() {
  return [
    'You help an investor-relations team prioritise. For EACH contact given, write ONE short "why now" line (<=90 chars), grounded ONLY in the facts provided. Plain English, no jargon.',
    'Reply with STRICT JSON only: {"whys":{"<id>":"<line>"}} — one entry per id.',
  ].join('\n');
}

export function buildWhyUser(items) {
  return items.map((it) =>
    `#${it.id} ${it.fullName || '-'} | stage:${it.stage || '-'} | reason:${it.reason || '-'} | last:${it.lastContact || '-'} | next:${it.nextActionDate || '-'}`,
  ).join('\n');
}

export const WHY_PROMPT = (items) => ({ system: buildWhySystem(), user: buildWhyUser(items), maxTokens: 1400 });

export function parseWhy(text, validIds) {
  const obj = extractJson(text);
  const whys = obj && obj.whys && typeof obj.whys === 'object' ? obj.whys
    : (obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {});
  const out = {};
  for (const [k, v] of Object.entries(whys)) { const id = Number(k); if (validIds.has(id)) out[id] = cap(str(v), 120); }
  return out;
}
