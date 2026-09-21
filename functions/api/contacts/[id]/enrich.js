/**
 * POST /api/contacts/:id/enrich — score ONE contact on demand (the direct Bedrock
 * call). Reads the contact + recent activity from D1, asks Bedrock for an interest
 * score, band, one-line relationship summary and a suggested next step, and stores
 * them back on the contact. Returns the updated contact.
 */
import { json, fail, noDb, now, ensureSchema } from '../../_lib.js';
import { callBedrock, bedrockConfigured } from '../../_bedrock.js';
import { ENRICHMENT_PROMPT, parseEnrichment } from '../../_ai.mjs';

const parseId = (params) => {
  const id = parseInt(params.id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export async function onRequestPost({ params, env }) {
  if (!env.DB) return noDb();
  const id = parseId(params);
  if (!id) return fail('Invalid contact id.', 400);
  if (!bedrockConfigured(env)) return fail('AI is not switched on yet — set the BEDROCK_API_KEY secret.', 503, { code: 'no-bedrock' });
  try {
    await ensureSchema(env);
    const contact = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
    if (!contact) return fail('Contact not found.', 404);
    const acts = await env.DB.prepare(
      'SELECT * FROM activities WHERE contactId = ? ORDER BY occurredAt DESC, id DESC LIMIT 8',
    ).bind(id).all();

    const { system, user, maxTokens } = ENRICHMENT_PROMPT(contact, acts.results || []);
    const { text, model } = await callBedrock(env, { system, user, maxTokens });
    const ai = parseEnrichment(text);

    const ts = now();
    const updated = await env.DB.prepare(
      `UPDATE contacts SET aiScore = ?, aiBand = ?, aiSummary = ?, aiNextStep = ?, aiAnalyzedAt = ?, aiModel = ?
       WHERE id = ? RETURNING *`,
    ).bind(ai.interestScore, ai.band, ai.relationshipSummary, ai.suggestedNextStep, ts, model, id).first();

    return json({ contact: updated, ai: { ...ai, analyzedAt: ts, model } });
  } catch (err) {
    return fail(err.message || 'Enrichment failed.', err.status || 500, err.code ? { code: err.code } : {});
  }
}
