/**
 * /api/emails — saved investor emails (Compose, Phase 8): list (GET) and save (POST).
 * A saved email is just { name, subject, preheader, body } the team can reload and reuse.
 * Nothing here sends anything — it only stores drafts.
 */
import { json, fail, noDb, now, readJson, ensureSchema, currentUser } from '../_lib.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return noDb();
  await ensureSchema(env);
  const rows = await env.DB.prepare('SELECT * FROM saved_emails ORDER BY updatedAt DESC, id DESC').all();
  return json({ emails: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }

  const subject = String(body.subject || '').trim();
  const emailBody = String(body.body || '').trim();
  if (!subject && !emailBody) return fail('There is nothing to save yet.', 400);
  const name = String(body.name || '').trim().slice(0, 120) || (subject.slice(0, 80) || 'Untitled email');
  const preheader = String(body.preheader || '').trim().slice(0, 400) || null;
  const ts = now();
  try {
    const email = await env.DB.prepare(
      'INSERT INTO saved_emails (name, subject, preheader, body, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    ).bind(name, subject.slice(0, 400) || null, preheader, emailBody.slice(0, 20000) || null, currentUser(request), ts, ts).first();
    return json({ email }, 201);
  } catch (err) {
    return fail(`Could not save the email: ${err.message}`, 500);
  }
}
