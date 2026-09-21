/** /api/tags — list (GET, with usage counts) and create (POST). */
import { json, fail, noDb, readJson, ensureSchema, TAG_PALETTE } from '../_lib.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return noDb();
  await ensureSchema(env);
  const rows = await env.DB.prepare(
    `SELECT t.id, t.name, t.colour, COUNT(ct.contactId) AS count
     FROM tags t LEFT JOIN contact_tags ct ON ct.tagId = t.id GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
  ).all();
  return json({ tags: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }
  const name = String(body.name || '').trim();
  if (!name) return fail('A tag needs a name.', 400);
  const existing = await env.DB.prepare('SELECT id, name, colour FROM tags WHERE lower(name) = lower(?)').bind(name).first();
  if (existing) return json({ tag: existing });   // idempotent: return the existing tag
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags').first();
  const colour = String(body.colour || '').trim() || TAG_PALETTE[n % TAG_PALETTE.length];
  try {
    const tag = await env.DB.prepare('INSERT INTO tags (name, colour) VALUES (?, ?) RETURNING *').bind(name, colour).first();
    return json({ tag }, 201);
  } catch (err) {
    return fail(`Could not create the tag: ${err.message}`, 500);
  }
}
