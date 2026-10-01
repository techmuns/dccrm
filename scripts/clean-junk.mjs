/**
 * scripts/clean-junk.mjs — the repeatable "clear demo / junk data" maintenance action.
 *
 * Calls POST /api/admin/cleanup (shared INGEST_SECRET, same as the email reader). DRY-RUN by
 * default — it prints exactly what WOULD be removed; pass --apply to actually delete. Safe and
 * idempotent: it only ever removes seeded demo replies (messageId sample-reply*), automated-
 * sender replies, and contacts auto-created from automated senders — never a real investor
 * contact or a genuine human reply. Re-run it any time the catcher inbox collects junk.
 *
 * Env: WORKER_URL, INGEST_SECRET.
 * Usage: node scripts/clean-junk.mjs            # dry run (shows what it would remove)
 *        node scripts/clean-junk.mjs --apply    # actually remove it
 */
const WORKER = (process.env.WORKER_URL || '').replace(/\/+$/, '');
const SECRET = process.env.INGEST_SECRET || '';
const apply = process.argv.includes('--apply');

async function main() {
  if (!WORKER || !SECRET) throw new Error('WORKER_URL and INGEST_SECRET are required');
  const rr = await fetch(`${WORKER}/api/admin/cleanup${apply ? '?apply=1' : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ apply }),
  });
  const body = await rr.json().catch(() => ({}));
  if (!rr.ok) throw new Error(`HTTP ${rr.status} ${JSON.stringify(body).slice(0, 300)}`);
  console.log(apply ? 'APPLIED cleanup:' : 'DRY RUN — nothing deleted (pass --apply to remove):');
  console.log(JSON.stringify(body, null, 2));
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
