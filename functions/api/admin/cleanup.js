/**
 * POST /api/admin/cleanup — remove demo / junk data so the client only ever sees real data.
 *
 * Safe, repeatable and idempotent. Authenticated with the shared INGEST_SECRET (Bearer),
 * exactly like the ingest reader. DRY-RUN by default (reports what WOULD be removed); pass
 * {"apply": true} (or ?apply=1) to actually delete.
 *
 * It ONLY ever matches junk — never a real investor contact or a genuine human reply:
 *   1. Seeded demo replies           — messageId LIKE 'sample-reply%'
 *   2. Automated-sender replies       — fromEmail is a no-reply / mailer-daemon / Google-alert
 *                                       address (the SAME rule the reader uses: _ai.mjs)
 *   3. Contacts auto-created from an automated sender — source = 'Email' AND an automated email.
 *      Deleting the contact cascades its activities / tasks / tags; its replies (FK is
 *      ON DELETE SET NULL, so they'd be orphaned) are removed explicitly too.
 *
 * A genuine human reply (e.g. tech@muns.io / Rahul Verma) never matches, so it always stays.
 */
import { json, fail, noDb, ensureSchema } from '../_lib.js';
import { pickSecret, bearerAuthed } from '../_bedrock.js';
import { isAutomatedSender, automatedSenderReason } from '../_ai.mjs';

const SAMPLE_PREFIX = 'sample-reply';
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  if (!bearerAuthed(request, pickSecret(env, 'INGEST_SECRET'))) return fail('unauthorized', 401);
  await ensureSchema(env);

  let apply = new URL(request.url).searchParams.get('apply') === '1';
  try { const b = await request.json(); if (b && b.apply === true) apply = true; } catch { /* no body is fine */ }

  // ---- gather candidates ----
  const replies = (await env.DB.prepare('SELECT id, messageId, fromEmail, fromName, subject, contactId FROM replies').all()).results || [];
  const emailContacts = (await env.DB.prepare("SELECT id, fullName, email, source FROM contacts WHERE source = 'Email'").all()).results || [];

  const isSample = (r) => String(r.messageId || '').startsWith(SAMPLE_PREFIX);
  const sampleReplies = replies.filter(isSample);
  const automatedReplies = replies.filter((r) => !isSample(r) && isAutomatedSender(r.fromEmail));
  const junkContacts = emailContacts.filter((c) => isAutomatedSender(c.email));
  const junkContactIds = new Set(junkContacts.map((c) => c.id));

  // Replies to delete: sample + automated + any still tied to a junk contact (orphan cleanup).
  const replyIds = new Set([...sampleReplies, ...automatedReplies].map((r) => r.id));
  for (const r of replies) if (r.contactId != null && junkContactIds.has(r.contactId)) replyIds.add(r.id);

  const report = {
    sampleReplies: sampleReplies.map((r) => ({ id: r.id, messageId: r.messageId, from: r.fromEmail, name: r.fromName })),
    automatedReplies: automatedReplies.map((r) => ({ id: r.id, from: r.fromEmail, subject: r.subject, reason: automatedSenderReason(r.fromEmail) })),
    automatedContacts: junkContacts.map((c) => ({ id: c.id, name: c.fullName, email: c.email, reason: automatedSenderReason(c.email) })),
    repliesToDelete: replyIds.size,
    contactsToDelete: junkContactIds.size,
  };

  if (!apply) {
    return json({ ok: true, dryRun: true, ...report, note: 'Dry run — nothing was deleted. POST {"apply":true} (or ?apply=1) to remove.' });
  }

  const stmts = [];
  for (const id of replyIds) stmts.push(env.DB.prepare('DELETE FROM replies WHERE id = ?').bind(id));
  for (const id of junkContactIds) stmts.push(env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(id)); // cascades activities/tasks/contact_tags
  try {
    if (stmts.length) for (const group of chunk(stmts, 50)) await env.DB.batch(group);
  } catch (err) {
    return fail(`Cleanup failed: ${err.message}`, 500);
  }
  return json({ ok: true, dryRun: false, ...report, deletedReplies: replyIds.size, deletedContacts: junkContactIds.size });
}
