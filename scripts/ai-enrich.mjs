/**
 * scripts/ai-enrich.mjs — BULK relationship enrichment, run on GitHub Actions.
 *
 * Fetches the contacts to score from the Worker (/api/ai/pending), scores each with
 * PATIENT Bedrock retries (using the exact same prompt the on-demand path uses, from
 * functions/api/_ai.mjs), and posts the results back (/api/ai/result). Both endpoints
 * are authenticated with the shared GHA_SECRET. No npm deps — just fetch + the shared
 * modules.
 *
 * Env: WORKER_URL, GHA_SECRET, BEDROCK_API_KEY, AWS_REGION, BEDROCK_MODEL_IDS,
 *      SCOPE (all|changed, default all), CONCURRENCY (default 3).
 */
import { callBedrock, bedrockConfigured } from './_bedrock.mjs';
import { ENRICHMENT_PROMPT, parseEnrichment } from '../functions/api/_ai.mjs';

const WORKER = (process.env.WORKER_URL || '').replace(/\/+$/, '');
const SECRET = process.env.GHA_SECRET || '';
const SCOPE = process.env.SCOPE === 'changed' ? 'changed' : 'all';
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const auth = { Authorization: `Bearer ${SECRET}` };

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

async function postResults(results) {
  if (!results.length) return;
  for (const batch of chunk(results, 50)) {
    const rr = await fetch(`${WORKER}/api/ai/result`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ results: batch }),
    });
    if (!rr.ok) throw new Error(`result post failed: HTTP ${rr.status} ${(await rr.text()).slice(0, 200)}`);
    console.log('posted', (await rr.json()).written, 'result(s)');
  }
}

async function main() {
  if (!WORKER || !SECRET) throw new Error('WORKER_URL and GHA_SECRET are required');
  if (!bedrockConfigured()) throw new Error('BEDROCK_API_KEY is required');

  const pr = await fetch(`${WORKER}/api/ai/pending?scope=${SCOPE}`, { headers: auth });
  if (!pr.ok) throw new Error(`pending fetch failed: HTTP ${pr.status} ${(await pr.text()).slice(0, 200)}`);
  const contacts = (await pr.json()).contacts || [];
  console.log(`scoring ${contacts.length} contact(s) [scope=${SCOPE}, concurrency=${CONCURRENCY}]`);
  if (!contacts.length) { console.log('nothing to score'); return; }

  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < contacts.length) {
      const c = contacts[idx++];
      try {
        const { system, user, maxTokens } = ENRICHMENT_PROMPT(c, c.activities || []);
        const { text, model } = await callBedrock(system, user, { maxTokens });
        const ai = parseEnrichment(text);
        results.push({ id: c.id, ...ai, model });
        console.log(`✓ ${c.id} ${c.fullName || ''} → ${ai.interestScore} (${ai.band})`);
      } catch (e) {
        console.error(`✗ ${c.id} ${c.fullName || ''}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await postResults(results);
  console.log(`done — scored ${results.length}/${contacts.length}`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
