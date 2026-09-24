/**
 * POST /api/ai/update — the "Update with AI" input box.
 *
 * Body: { text: "<pasted notes>", hint?: "<which investor>" }. Sends the text plus a
 * COMPACT list of the real contacts to Bedrock (one direct call), and returns a
 * validated list of proposed updates — one per investor mentioned. It NEVER writes:
 * the browser previews the list and applies confirmed changes through the same
 * create/update/activity endpoints the grid and drawer use. Every id/field/stage the
 * model returns is validated against the real book, so nothing invented survives.
 */
import { json, fail, noDb, ensureSchema, readJson, WRITABLE, STAGES, loadCompactBook } from '../_lib.js';
import { callBedrock, bedrockConfigured } from '../_bedrock.js';
import { UPDATE_PROMPT, parseUpdates } from '../_ai.mjs';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  if (!bedrockConfigured(env)) return fail('AI is not switched on yet — set the BEDROCK_API_KEY secret.', 503, { code: 'no-bedrock' });
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }

  const text = String(body?.text || '').trim();
  const hint = String(body?.hint || '').trim();
  if (!text) return fail('Paste the notes you want to file first.', 400);

  try {
    const book = await loadCompactBook(env);
    const validIds = new Set(book.map((c) => c.id));
    const fields = new Set(WRITABLE);
    const stages = new Set(STAGES);
    const { system, user, maxTokens } = UPDATE_PROMPT({ text, hint, book, fields, stages });
    const { text: out, model } = await callBedrock(env, { system, user, maxTokens });
    const updates = parseUpdates(out, { validIds, allowedFields: fields, allowedStages: stages });
    return json({ updates, model });
  } catch (err) {
    return fail(err.message || 'Could not read those notes.', err.status || 500, err.code ? { code: err.code } : {});
  }
}
