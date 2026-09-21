/** /api/segments — list (GET) and save (POST) named filter sets. */
import { json, fail, noDb, now, readJson, ensureSchema } from '../_lib.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return noDb();
  await ensureSchema(env);
  const rows = await env.DB.prepare('SELECT * FROM segments ORDER BY id DESC').all();
  return json({ segments: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }
  const name = String(body.name || '').trim();
  if (!name) return fail('A segment needs a name.', 400);
  let filtersJson = '{}';
  try { filtersJson = JSON.stringify(body.filters || {}); } catch { return fail('Invalid filters.', 400); }
  const seg = await env.DB.prepare('INSERT INTO segments (name, filtersJson, createdAt) VALUES (?, ?, ?) RETURNING *').bind(name, filtersJson, now()).first();
  return json({ segment: seg }, 201);
}
