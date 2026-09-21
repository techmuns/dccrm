/** /api/segments/:id — delete a saved segment. */
import { json, fail, noDb, ensureSchema } from '../_lib.js';
export async function onRequestDelete({ params, env }) {
  if (!env.DB) return noDb();
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return fail('Invalid segment id.', 400);
  await ensureSchema(env);
  const res = await env.DB.prepare('DELETE FROM segments WHERE id = ?').bind(id).run();
  if (!res.meta?.changes) return fail('Segment not found.', 404);
  return json({ ok: true, id });
}
