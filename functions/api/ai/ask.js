/**
 * POST /api/ai/ask — the plain-English "Ask" box.
 *
 * Body: { question }. Sends the question + the compact book to Bedrock (one direct
 * call) and returns { answer, contactIds, columns }. The answer is a short summary;
 * the ids are validated against the real book so the browser can render a REAL table
 * of those contacts from the store (never from the model's text).
 */
import { json, fail, noDb, ensureSchema, readJson, loadCompactBook } from '../_lib.js';
import { callBedrock, bedrockConfigured } from '../_bedrock.js';
import { ASK_PROMPT, parseAsk } from '../_ai.mjs';

const DISPLAY_FIELDS = [
  'fullName', 'organisation', 'entityType', 'role', 'designation', 'email', 'phone', 'whatsapp',
  'country', 'city', 'vehicle', 'stage', 'tier', 'priority', 'relationshipOwner',
  'lastContact', 'nextAction', 'nextActionDate', 'source', 'signal',
];
const DEFAULT_COLUMNS = ['fullName', 'entityType', 'stage', 'country', 'lastContact'];

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  if (!bedrockConfigured(env)) return fail('AI is not switched on yet — set the BEDROCK_API_KEY secret.', 503, { code: 'no-bedrock' });
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }

  const question = String(body?.question || '').trim();
  if (!question) return fail('Type a question first.', 400);

  try {
    const book = await loadCompactBook(env);
    const validIds = new Set(book.map((c) => c.id));
    const fields = new Set(DISPLAY_FIELDS);
    const { system, user, maxTokens } = ASK_PROMPT({ question, book, fields });
    const { text, model } = await callBedrock(env, { system, user, maxTokens });
    const result = parseAsk(text, { validIds, displayFields: fields, defaultColumns: DEFAULT_COLUMNS });
    return json({ ...result, model });
  } catch (err) {
    return fail(err.message || 'Could not answer that question.', err.status || 500, err.code ? { code: err.code } : {});
  }
}
