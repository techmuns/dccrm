/**
 * GET /api/replies — analysed email replies, newest first, with the matched contact's
 * name/organisation. Query: ?contactId=<n> (one contact), ?needsResponse=1 (asked a
 * question or positive), ?limit=<n> (default 100).
 */
import { json, fail, noDb, ensureSchema } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB) return noDb();
  try {
    await ensureSchema(env);
    const url = new URL(request.url);
    const contactId = parseInt(url.searchParams.get('contactId') || '', 10);
    const needsResponse = url.searchParams.get('needsResponse') === '1';
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 1000);

    const where = [];
    const binds = [];
    if (Number.isInteger(contactId) && contactId > 0) { where.push('r.contactId = ?'); binds.push(contactId); }
    if (needsResponse) where.push("(r.questionsAsked > 0 OR r.sentiment = 'Positive')");
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = (await env.DB.prepare(
      `SELECT r.*, c.fullName AS contactName, c.organisation AS contactOrg, c.entityType AS contactType
       FROM replies r LEFT JOIN contacts c ON c.id = r.contactId
       ${whereSql} ORDER BY r.receivedAt DESC, r.id DESC LIMIT ?`,
    ).bind(...binds, limit).all()).results || [];

    return json({ replies: rows, count: rows.length });
  } catch (err) {
    return fail(err.message || 'Could not read replies.', 500);
  }
}
