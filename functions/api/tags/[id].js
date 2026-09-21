/** /api/tags/:id — delete a tag (also removes it from all contacts). */
import { json, fail, noDb, ensureSchema } from '../_lib.js';
export async function onRequestDelete({ params, env }) {
  if (!env.DB) return noDb();
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return fail('Invalid tag id.', 400);
  await ensureSchema(env);
  await env.DB.prepare('DELETE FROM contact_tags WHERE tagId = ?').bind(id).run();
  const res = await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
  if (!res.meta?.changes) return fail('Tag not found.', 404);
  return json({ ok: true, id });
}
