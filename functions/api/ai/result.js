/**
 * POST /api/ai/result — the bulk enrichment runner posts scored contacts back here;
 * we write the AI fields to D1. Authenticated with the shared GHA_SECRET (Bearer).
 * Body: { results: [ { id, interestScore, band, relationshipSummary, suggestedNextStep, model } ] }.
 */
import { json, fail, noDb, now, ensureSchema } from '../_lib.js';
import { pickSecret, bearerAuthed } from '../_bedrock.js';
import { bandForScore } from '../_ai.mjs';

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const str = (v) => (v == null ? null : String(v).trim() || null);
const clampInt = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  if (!bearerAuthed(request, pickSecret(env, 'GHA_SECRET'))) return fail('unauthorized', 401);
  let body;
  try { await ensureSchema(env); body = await request.json(); } catch { return fail('The request body was not valid JSON.', 400); }

  const rows = Array.isArray(body) ? body : Array.isArray(body?.results) ? body.results : null;
  if (!rows) return fail('Expected { results: [ … ] }.', 400);

  const ts = now();
  const stmts = [];
  let written = 0;
  let skipped = 0;
  for (const r of rows) {
    const id = parseInt(r && r.id, 10);
    if (!Number.isInteger(id) || id <= 0 || r.interestScore == null) { skipped += 1; continue; }
    const score = clampInt(r.interestScore, 0, 100);
    const band = ['Hot', 'Warm', 'Cold'].includes(r.band) ? r.band : bandForScore(score);
    // COALESCE keeps an existing summary/next-step/model when a (partial) result omits it,
    // so a malformed post can never wipe good data. The runner always sends full records.
    stmts.push(env.DB.prepare(
      `UPDATE contacts SET aiScore = ?, aiBand = ?, aiSummary = COALESCE(?, aiSummary),
         aiNextStep = COALESCE(?, aiNextStep), aiAnalyzedAt = ?, aiModel = COALESCE(?, aiModel) WHERE id = ?`,
    ).bind(score, band, str(r.relationshipSummary), str(r.suggestedNextStep), ts, str(r.model), id));
    written += 1;
  }
  try {
    for (const b of chunk(stmts, 50)) await env.DB.batch(b);
  } catch (err) {
    return fail(`Could not write AI results: ${err.message}`, 500);
  }
  return json({ ok: true, written, skipped });
}
