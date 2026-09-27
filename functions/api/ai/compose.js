/**
 * POST /api/ai/compose — the "one-click" investor email composer.
 *
 * Body: { brief, tone, keyPoints }. One direct Bedrock call turns the brief into a clean,
 * merge-ready email { subject, preheader, body } that uses {{FirstName}} / {{Organisation}}
 * placeholders so a campaign tool can personalise per recipient. Grounded: the model is told
 * to use ONLY the brief + key points. Nothing is ever sent from here — the browser previews,
 * edits and exports the result.
 *
 * This endpoint is contact-agnostic (the audience + per-recipient merge live in the browser),
 * so it needs only Bedrock — no D1.
 */
import { json, fail, readJson } from '../_lib.js';
import { callBedrock, bedrockConfigured } from '../_bedrock.js';
import { COMPOSE_PROMPT, parseComposedEmail } from '../_ai.mjs';

export async function onRequestPost({ request, env }) {
  if (!bedrockConfigured(env)) return fail('AI is not switched on yet — set the BEDROCK_API_KEY secret.', 503, { code: 'no-bedrock' });
  let body;
  try { body = await readJson(request); } catch (err) { return fail(err.message, 400); }

  const brief = String(body?.brief || '').trim();
  if (!brief) return fail('Tell me what the email is about first.', 400);
  const tone = String(body?.tone || 'Warm').trim();
  const keyPoints = String(body?.keyPoints || '').trim();

  try {
    const { system, user, maxTokens } = COMPOSE_PROMPT({ brief, tone, keyPoints });
    const { text, model } = await callBedrock(env, { system, user, maxTokens });
    const email = parseComposedEmail(text);
    return json({ ...email, model });
  } catch (err) {
    return fail(err.message || 'Could not compose that email.', err.status || 500, err.code ? { code: err.code } : {});
  }
}
