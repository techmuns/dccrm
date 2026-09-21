/**
 * GET /api/ai/pending — the list of contacts the bulk enrichment runner should score,
 * each with its recent activity, so the runner can build the exact same prompt the
 * on-demand path uses. Authenticated with the shared GHA_SECRET (Bearer). Query:
 *   ?scope=all|changed  (changed = never scored, or edited since last scored)
 *   ?limit=<n>          (default 500)
 */
import { json, fail, noDb, ensureSchema } from '../_lib.js';
import { pickSecret, bearerAuthed } from '../_bedrock.js';

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export async function onRequestGet({ request, env }) {
  if (!env.DB) return noDb();
  if (!bearerAuthed(request, pickSecret(env, 'GHA_SECRET'))) return fail('unauthorized', 401);
  try {
    await ensureSchema(env);
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope') === 'changed' ? 'changed' : 'all';
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '500', 10) || 500, 1), 2000);

    const whereChanged = 'WHERE aiAnalyzedAt IS NULL OR aiAnalyzedAt < updatedAt';
    const rows = (await env.DB.prepare(
      `SELECT * FROM contacts ${scope === 'changed' ? whereChanged : ''} ORDER BY updatedAt DESC LIMIT ?`,
    ).bind(limit).all()).results || [];

    const ids = rows.map((r) => r.id);
    const actMap = new Map();
    for (const group of chunk(ids, 50)) {
      if (!group.length) continue;
      const res = await env.DB.prepare(
        `SELECT * FROM activities WHERE contactId IN (${group.map(() => '?').join(',')}) ORDER BY occurredAt DESC, id DESC`,
      ).bind(...group).all();
      for (const a of res.results || []) {
        if (!actMap.has(a.contactId)) actMap.set(a.contactId, []);
        const arr = actMap.get(a.contactId);
        if (arr.length < 8) arr.push(a);
      }
    }
    const contacts = rows.map((c) => ({ ...c, activities: actMap.get(c.id) || [] }));
    return json({ contacts, scope, count: contacts.length });
  } catch (err) {
    return fail(err.message || 'Could not read pending contacts.', 500);
  }
}
