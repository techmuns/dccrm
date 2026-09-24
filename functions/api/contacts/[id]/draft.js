/**
 * POST /api/contacts/:id/draft — draft an outreach message for ONE contact (a direct
 * Bedrock call). Body: { intent, channel }. Reads the contact + its memory/notes from
 * D1, asks Bedrock for a short, specific draft, and returns { subject, draft } for the
 * drawer to show in an EDITABLE box. It sends nothing anywhere — the team edits, copies
 * or saves it as a note themselves.
 */
import { json, fail, noDb, ensureSchema, readJson } from '../../_lib.js';
import { callBedrock, bedrockConfigured } from '../../_bedrock.js';
import { DRAFT_PROMPT, parseDraft } from '../../_ai.mjs';

const parseId = (params) => { const id = parseInt(params.id, 10); return Number.isInteger(id) && id > 0 ? id : null; };
const INTENTS = ['Warm intro', 'Gentle follow-up', 'Diligence follow-up', 'Re-engage (gone quiet)', 'Thank you / next step'];

export async function onRequestPost({ params, request, env }) {
  if (!env.DB) return noDb();
  const id = parseId(params);
  if (!id) return fail('Invalid contact id.', 400);
  if (!bedrockConfigured(env)) return fail('AI is not switched on yet — set the BEDROCK_API_KEY secret.', 503, { code: 'no-bedrock' });
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }

  const intent = INTENTS.includes(String(body?.intent)) ? String(body.intent) : 'Gentle follow-up';
  const channel = String(body?.channel) === 'WhatsApp' ? 'WhatsApp' : 'Email';

  try {
    const contact = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
    if (!contact) return fail('Contact not found.', 404);
    const acts = await env.DB.prepare(
      'SELECT * FROM activities WHERE contactId = ? ORDER BY occurredAt DESC, id DESC LIMIT 12',
    ).bind(id).all();
    const { system, user, maxTokens } = DRAFT_PROMPT({ contact, notes: acts.results || [], intent, channel });
    const { text, model } = await callBedrock(env, { system, user, maxTokens });
    const draft = parseDraft(text);
    return json({ ...draft, intent, channel, model });
  } catch (err) {
    return fail(err.message || 'Could not draft a message.', err.status || 500, err.code ? { code: err.code } : {});
  }
}
