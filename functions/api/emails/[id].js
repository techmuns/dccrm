/** /api/emails/:id — delete a saved email (Compose, Phase 8). */
import { json, fail, noDb, ensureSchema } from '../_lib.js';

const parseId = (params) => { const id = parseInt(params.id, 10); return Number.isInteger(id) && id > 0 ? id : null; };

export async function onRequestDelete({ params, env }) {
  if (!env.DB) return noDb();
  const id = parseId(params);
  if (!id) return fail('Invalid email id.', 400);
  await ensureSchema(env);
  const res = await env.DB.prepare('DELETE FROM saved_emails WHERE id = ?').bind(id).run();
  if (!res.meta?.changes) return fail('Saved email not found.', 404);
  return json({ ok: true, id });
}
