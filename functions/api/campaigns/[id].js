/**
 * DELETE /api/campaigns/:id — remove one imported campaign.
 */
import { json, fail, noDb, ensureSchema } from '../_lib.js';

export async function onRequestDelete({ params, env }) {
  if (!env.DB) return noDb();
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return fail('Invalid campaign id.', 400);
  try {
    await ensureSchema(env);
    const res = await env.DB.prepare('DELETE FROM campaigns WHERE id = ?').bind(id).run();
    if (!res.meta?.changes) return fail('Campaign not found.', 404);
    return json({ ok: true, id });
  } catch (err) {
    return fail(err.message || 'Could not delete the campaign.', 500);
  }
}
