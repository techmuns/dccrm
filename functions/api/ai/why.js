/**
 * POST /api/ai/why — optional one-line "why now" notes for the priorities panel.
 *
 * Body: { items: [{ id, fullName, stage, reason, lastContact, nextActionDate }] }.
 * The priorities LIST itself is computed by the browser from real dates (always
 * correct); this only adds a cheap plain-English "why now" per row. It is best-effort:
 * with no AI key, or on any error, it returns {} so the panel still works.
 */
import { json, fail, noDb, ensureSchema, readJson } from '../_lib.js';
import { callBedrock, bedrockConfigured } from '../_bedrock.js';
import { WHY_PROMPT, parseWhy } from '../_ai.mjs';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  if (!bedrockConfigured(env)) return json({ whys: {} });   // no AI → no why-lines, panel unaffected
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }

  const items = Array.isArray(body?.items) ? body.items.slice(0, 15) : [];
  if (!items.length) return json({ whys: {} });

  try {
    const ids = items.map((it) => parseInt(it.id, 10)).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return json({ whys: {} });
    const rows = await env.DB.prepare(
      `SELECT id FROM contacts WHERE id IN (${ids.map(() => '?').join(',')})`,
    ).bind(...ids).all();
    const validIds = new Set((rows.results || []).map((r) => r.id));
    const safe = items
      .filter((it) => validIds.has(parseInt(it.id, 10)))
      .map((it) => ({
        id: parseInt(it.id, 10), fullName: String(it.fullName || ''), stage: String(it.stage || ''),
        reason: String(it.reason || ''), lastContact: String(it.lastContact || ''), nextActionDate: String(it.nextActionDate || ''),
      }));
    if (!safe.length) return json({ whys: {} });
    const { system, user, maxTokens } = WHY_PROMPT(safe);
    const { text } = await callBedrock(env, { system, user, maxTokens });
    return json({ whys: parseWhy(text, validIds) });
  } catch {
    return json({ whys: {} });   // why-lines are optional; never block the panel
  }
}
