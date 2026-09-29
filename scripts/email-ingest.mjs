/**
 * scripts/email-ingest.mjs — the inbound email reader (Phase 12), run on GitHub Actions
 * on a schedule (~every 5 min) or on demand.
 *
 * Connects to the dedicated catcher inbox over IMAP, fetches UNSEEN messages, parses each
 * (from, subject, plain-text body, date), and POSTs the RAW email to the Worker
 * (/api/replies/ingest, shared INGEST_SECRET). The Worker does the AI classification and all
 * the CRM updates — no secrets and no AI run here. A message is marked \\Seen ONLY after a
 * successful POST, so it is never processed twice; on any error it is left UNSEEN for the next
 * run. Auto-forwards (envelope from = the catcher) are re-attributed to the ORIGINAL sender
 * parsed from the forwarded headers, so the reply lands on the real investor.
 *
 * TEST MODE: with no IMAP credentials it POSTs data/replies.sample.json instead, so the whole
 * pipeline is demonstrable now and goes live the moment the inbox is connected.
 *
 * Env: WORKER_URL, INGEST_SECRET, IMAP_HOST, IMAP_USER, IMAP_PASSWORD (optional IMAP_PORT=993,
 *      IMAP_MAILBOX=INBOX).
 */
import { readFile } from 'node:fs/promises';

const WORKER = (process.env.WORKER_URL || '').replace(/\/+$/, '');
const SECRET = process.env.INGEST_SECRET || '';
const IMAP_HOST = process.env.IMAP_HOST || '';
const IMAP_USER = process.env.IMAP_USER || '';
const IMAP_PASSWORD = process.env.IMAP_PASSWORD || '';
const imapReady = !!(IMAP_HOST && IMAP_USER && IMAP_PASSWORD);

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/** POST one raw email to the ingest endpoint; throws on a non-2xx so the caller leaves it UNSEEN. */
async function postEmails(emails) {
  const rr = await fetch(`${WORKER}/api/replies/ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ emails }),
  });
  if (!rr.ok) throw new Error(`HTTP ${rr.status} ${(await rr.text()).slice(0, 200)}`);
  return rr.json();
}

/**
 * Work out the REAL sender. Normally the envelope From. But when the catcher auto-forwards a
 * message to itself, the envelope From is the catcher — so dig the original sender out of the
 * forwarded header block ("From: Name <email>"), then a Reply-To, then give up to the envelope.
 */
function originalSender(parsed, catcher) {
  const cat = String(catcher || '').toLowerCase();
  const env = parsed.from && parsed.from.value && parsed.from.value[0];
  const envEmail = (env && env.address || '').toLowerCase();
  if (envEmail && envEmail !== cat) return { email: envEmail, name: (env && env.name) || '' };

  const text = String(parsed.text || parsed.html || '');
  const m = text.match(/From:\s*"?([^"<\n]+?)"?\s*<?([\w.+-]+@[\w-]+\.[\w.-]+)>?/i);
  if (m && m[2].toLowerCase() !== cat) return { email: m[2].toLowerCase(), name: (m[1] || '').trim() };

  const rt = parsed.replyTo && parsed.replyTo.value && parsed.replyTo.value[0];
  if (rt && rt.address && rt.address.toLowerCase() !== cat) return { email: rt.address.toLowerCase(), name: rt.name || '' };

  return { email: envEmail, name: (env && env.name) || '' };
}

async function runLive() {
  console.log(`LIVE — reading UNSEEN mail from ${IMAP_USER}@${IMAP_HOST}`);
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const client = new ImapFlow({
    host: IMAP_HOST, port: Number(process.env.IMAP_PORT || 993), secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD }, logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock(process.env.IMAP_MAILBOX || 'INBOX');
  let processed = 0; let failed = 0;
  try {
    const uids = await client.search({ seen: false }, { uid: true });
    console.log(`found ${uids.length} unseen message(s)`);
    for (const uid of uids) {
      try {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        const parsed = await simpleParser(msg.source);
        const sender = originalSender(parsed, IMAP_USER);
        if (!sender.email || !EMAIL_RE.test(sender.email)) throw new Error('no usable sender address');
        const email = {
          fromEmail: sender.email,
          fromName: sender.name || '',
          subject: (parsed.subject || '').replace(/^\s*(fwd?|re):\s*/i, '').trim() || (parsed.subject || ''),
          body: String(parsed.text || parsed.html || '').slice(0, 8000),
          receivedAt: (parsed.date || new Date()).toISOString(),
          messageId: parsed.messageId || `uid-${uid}`,
        };
        await postEmails([email]);                                       // AI + CRM update run server-side
        await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true }); // mark Seen ONLY on success → idempotent
        processed += 1;
      } catch (e) {
        console.error(`uid ${uid} failed (left UNSEEN for retry): ${e.message}`);
        failed += 1;                                                     // do NOT mark Seen
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }
  console.log(`done — processed ${processed}, failed ${failed}`);
}

async function runTest() {
  console.log('TEST mode — no IMAP credentials; POSTing data/replies.sample.json as raw emails');
  const raw = JSON.parse(await readFile(new URL('../data/replies.sample.json', import.meta.url), 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.replies || []);
  const emails = list.map((r) => ({
    fromEmail: (r.fromEmail || r.from || '').toLowerCase(),
    fromName: r.fromName || '',
    subject: r.subject || '',
    body: r.body || r.text || '',
    receivedAt: r.receivedAt || new Date().toISOString().slice(0, 10),
    messageId: r.messageId || null,
  }));
  console.log('ingested:', JSON.stringify(await postEmails(emails)));   // endpoint is idempotent by messageId
}

async function main() {
  if (!WORKER || !SECRET) throw new Error('WORKER_URL and INGEST_SECRET are required');
  if (imapReady) await runLive(); else await runTest();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
