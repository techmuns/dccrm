/**
 * GET /api/campaigns — every imported campaign (raw rows), oldest first. The tab's
 * campaigns.js normalises + computes rates from these, so an empty table simply lets
 * the tab fall back to its sample.
 */
import { json, fail, noDb, ensureSchema } from '../_lib.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return noDb();
  try {
    await ensureSchema(env);
    const rows = (await env.DB.prepare('SELECT * FROM campaigns ORDER BY sentDate ASC, id ASC').all()).results || [];
    return json({ campaigns: rows, count: rows.length });
  } catch (err) {
    return fail(err.message || 'Could not read campaigns.', 500);
  }
}
