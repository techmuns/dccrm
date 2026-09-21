/** /api/contacts/:id/tags — add (POST {tagId|name}) / remove (DELETE ?tagId=) a tag. */
import { json, fail, noDb, readJson, ensureSchema, TAG_PALETTE } from '../../_lib.js';
const parseId = (v) => { const id = parseInt(v, 10); return Number.isInteger(id) && id > 0 ? id : null; };

export async function onRequestPost({ params, request, env }) {
  if (!env.DB) return noDb();
  const contactId = parseId(params.id);
  if (!contactId) return fail('Invalid contact id.', 400);
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }

  let tag;
  if (body.tagId) {
    tag = await env.DB.prepare('SELECT id, name, colour FROM tags WHERE id = ?').bind(parseInt(body.tagId, 10)).first();
    if (!tag) return fail('Tag not found.', 404);
  } else {
    const name = String(body.name || '').trim();
    if (!name) return fail('Provide a tagId or a new tag name.', 400);
    tag = await env.DB.prepare('SELECT id, name, colour FROM tags WHERE lower(name) = lower(?)').bind(name).first();
    if (!tag) {
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags').first();
      const colour = String(body.colour || '').trim() || TAG_PALETTE[n % TAG_PALETTE.length];
      tag = await env.DB.prepare('INSERT INTO tags (name, colour) VALUES (?, ?) RETURNING *').bind(name, colour).first();
    }
  }
  await env.DB.prepare('INSERT OR IGNORE INTO contact_tags (contactId, tagId) VALUES (?, ?)').bind(contactId, tag.id).run();
  return json({ tag }, 201);
}

export async function onRequestDelete({ params, request, env }) {
  if (!env.DB) return noDb();
  const contactId = parseId(params.id);
  if (!contactId) return fail('Invalid contact id.', 400);
  await ensureSchema(env);
  const tagId = parseInt(new URL(request.url).searchParams.get('tagId'), 10);
  if (!Number.isInteger(tagId)) return fail('Provide ?tagId=', 400);
  await env.DB.prepare('DELETE FROM contact_tags WHERE contactId = ? AND tagId = ?').bind(contactId, tagId).run();
  return json({ ok: true });
}
