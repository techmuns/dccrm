/**
 * POST /api/campaigns/import — upsert campaigns from a Zoho Campaigns export (parsed
 * in the browser). Matched by (name, sentDate). Body:
 *   { campaigns: [ { name, sentDate, segment, recipients, delivered, opened, clicked,
 *                    replied, bounced, unsubscribed } ] }
 * Returns { added, updated, skipped }.
 */
import { json, fail, noDb, now, ensureSchema } from '../_lib.js';

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const str = (v) => (v == null ? '' : String(v).trim());
const num = (v) => { const n = Number(String(v ?? '').replace(/[, ]/g, '')); return Number.isFinite(n) ? Math.round(n) : 0; };
const keyOf = (name, sentDate) => `${name}\u0000${sentDate}`;

/** Coerce one raw row (flexible Zoho / spreadsheet headers) into a campaign record. */
function normalize(raw) {
  return {
    name: str(raw.name ?? raw.Name ?? raw.campaign ?? raw.Campaign ?? raw['Campaign Name']),
    sentDate: str(raw.sentDate ?? raw.SentDate ?? raw.date ?? raw.Date ?? raw['Sent Date'] ?? raw['Sent On']),
    segment: str(raw.segment ?? raw.Segment ?? raw.list ?? raw.List ?? raw['Mailing List']) || 'All investors',
    recipients: num(raw.recipients ?? raw.Recipients ?? raw.sent ?? raw.Sent),
    delivered: num(raw.delivered ?? raw.Delivered),
    opened: num(raw.opened ?? raw.Opened ?? raw.opens ?? raw.Opens),
    clicked: num(raw.clicked ?? raw.Clicked ?? raw.clicks ?? raw.Clicks),
    replied: num(raw.replied ?? raw.Replied ?? raw.replies ?? raw.Replies),
    bounced: num(raw.bounced ?? raw.Bounced ?? raw.bounces ?? raw.Bounces),
    unsubscribed: num(raw.unsubscribed ?? raw.Unsubscribed ?? raw.unsubscribes ?? raw.Unsubscribes ?? raw['Unsubscribe']),
  };
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  let body;
  try { await ensureSchema(env); body = await request.json(); } catch { return fail('The request body was not valid JSON.', 400); }

  const rows = Array.isArray(body) ? body : Array.isArray(body?.campaigns) ? body.campaigns : null;
  if (!rows) return fail('Expected { campaigns: [ … ] }.', 400);
  if (!rows.length) return json({ added: 0, updated: 0, skipped: 0 });
  if (rows.length > 5000) return fail('Too many rows in one import (max 5,000).', 413);

  const cleaned = rows.map(normalize).filter((c) => c.name);
  const skipped = rows.length - cleaned.length;

  // Existing (name, sentDate) keys so we can report added vs updated.
  const existing = new Set();
  try {
    const ex = (await env.DB.prepare('SELECT name, sentDate FROM campaigns').all()).results || [];
    for (const e of ex) existing.add(keyOf(e.name, e.sentDate || ''));
  } catch (err) {
    return fail(`Could not read existing campaigns: ${err.message}`, 500);
  }

  const ts = now();
  let added = 0;
  let updated = 0;
  const stmts = [];
  for (const c of cleaned) {
    const k = keyOf(c.name, c.sentDate);
    if (existing.has(k)) updated += 1; else { added += 1; existing.add(k); }
    stmts.push(env.DB.prepare(
      `INSERT INTO campaigns (name, sentDate, segment, recipients, delivered, opened, clicked, replied, bounced, unsubscribed, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name, sentDate) DO UPDATE SET
         segment = excluded.segment, recipients = excluded.recipients, delivered = excluded.delivered,
         opened = excluded.opened, clicked = excluded.clicked, replied = excluded.replied,
         bounced = excluded.bounced, unsubscribed = excluded.unsubscribed, updatedAt = excluded.updatedAt`,
    ).bind(
      c.name, c.sentDate, c.segment, c.recipients, c.delivered, c.opened, c.clicked, c.replied, c.bounced, c.unsubscribed, ts, ts,
    ));
  }

  try {
    for (const b of chunk(stmts, 50)) await env.DB.batch(b);
  } catch (err) {
    return fail(`Could not import campaigns: ${err.message}`, 500);
  }
  return json({ added, updated, skipped });
}
