/**
 * scripts/email-ingest.mjs — the email-reply pipeline, run on GitHub Actions on a
 * schedule (~every 15 min).
 *
 * Reads NEW client replies from a dedicated IMAP inbox, analyses each with Bedrock
 * (sentiment, interest signal, questions asked, a summary and a DRAFT reply), and POSTs
 * them to the Worker (/api/replies/ingest, shared INGEST_SECRET), which matches each to
 * a contact by sender email and stores it in D1.
 *
 * TEST MODE: until IMAP credentials are set, it reads data/replies.sample.json instead of
 * a live inbox, so the whole pipeline is demonstrable now and goes live the moment the
 * inbox is connected. If BEDROCK_API_KEY is unset, a clearly-labelled heuristic stands in
 * for the model so ingest → D1 → UI still works end-to-end.
 *
 * Env: WORKER_URL, INGEST_SECRET, IMAP_HOST, IMAP_USER, IMAP_PASSWORD (optional
 *      IMAP_PORT=993, IMAP_MAILBOX=INBOX), BEDROCK_API_KEY, AWS_REGION, BEDROCK_MODEL_IDS.
 */
import { readFile } from 'node:fs/promises';
import { callBedrock, bedrockConfigured } from './_bedrock.mjs';
import { REPLY_PROMPT, parseReply, heuristicReply } from '../functions/api/_ai.mjs';

const WORKER = (process.env.WORKER_URL || '').replace(/\/+$/, '');
const SECRET = process.env.INGEST_SECRET || '';
const IMAP_HOST = process.env.IMAP_HOST || '';
const IMAP_USER = process.env.IMAP_USER || '';
const IMAP_PASSWORD = process.env.IMAP_PASSWORD || '';
const imapReady = !!(IMAP_HOST && IMAP_USER && IMAP_PASSWORD);

/** Pull raw replies — from the live IMAP inbox, or (TEST mode) from the sample file. */
async function readInbox() {
  if (!imapReady) {
    console.log('TEST mode — no IMAP credentials; reading data/replies.sample.json');
    const raw = JSON.parse(await readFile(new URL('../data/replies.sample.json', import.meta.url), 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw.replies || []);
    return list.map((r) => ({
      fromEmail: (r.fromEmail || r.from || '').toLowerCase(),
      fromName: r.fromName || '',
      subject: r.subject || '',
      receivedAt: r.receivedAt || new Date().toISOString().slice(0, 10),
      body: r.body || r.text || '',
      messageId: r.messageId || null,
    }));
  }

  console.log(`LIVE mode — reading UNSEEN mail from ${IMAP_USER}@${IMAP_HOST}`);
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const client = new ImapFlow({
    host: IMAP_HOST, port: Number(process.env.IMAP_PORT || 993), secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD }, logger: false,
  });
  await client.connect();
  const out = [];
  const lock = await client.getMailboxLock(process.env.IMAP_MAILBOX || 'INBOX');
  try {
    for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
      const parsed = await simpleParser(msg.source);
      const from = (parsed.from && parsed.from.value && parsed.from.value[0]) || {};
      out.push({
        fromEmail: (from.address || '').toLowerCase(),
        fromName: from.name || '',
        subject: parsed.subject || '',
        receivedAt: (parsed.date || new Date()).toISOString(),
        body: (parsed.text || parsed.html || '').toString().slice(0, 8000),
        messageId: parsed.messageId || String(msg.uid),
      });
      await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true });
    }
  } finally {
    lock.release();
    await client.logout();
  }
  return out;
}

/** Analyse one reply — Bedrock when configured, else the labelled heuristic. */
async function analyse(reply) {
  if (bedrockConfigured()) {
    try {
      const { system, user, maxTokens } = REPLY_PROMPT(reply);
      const { text, model } = await callBedrock(system, user, { maxTokens });
      return { ...reply, ...parseReply(text), model };
    } catch (e) {
      console.error(`analysis failed for ${reply.fromEmail}: ${e.message} — using heuristic`);
      return { ...reply, ...heuristicReply(reply) };
    }
  }
  return { ...reply, ...heuristicReply(reply) };
}

async function main() {
  if (!WORKER || !SECRET) throw new Error('WORKER_URL and INGEST_SECRET are required');
  if (!bedrockConfigured()) console.log('note: BEDROCK_API_KEY unset — using the labelled test heuristic for analysis');

  const inbox = await readInbox();
  console.log(`read ${inbox.length} reply(ies)`);
  if (!inbox.length) { console.log('nothing to ingest'); return; }

  const analysed = [];
  for (const r of inbox) analysed.push(await analyse(r));   // sequential: gentle on Bedrock

  const rr = await fetch(`${WORKER}/api/replies/ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ replies: analysed }),
  });
  if (!rr.ok) throw new Error(`ingest post failed: HTTP ${rr.status} ${(await rr.text()).slice(0, 200)}`);
  console.log('ingested:', JSON.stringify(await rr.json()));
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
