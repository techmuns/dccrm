/**
 * scripts/_bedrock.mjs — Amazon Bedrock for the GitHub Actions runners.
 *
 * The exact Bearer-key Converse pattern from techmuns/paramemo (scripts/gha-generate.mjs
 * callBedrock), but PATIENT: GitHub Actions has no 14-minute Worker wall, so it rides out
 * a rate-limited/overloaded model across many waves (default ~15 × 60s). Same model
 * fallback chain and the same 429/5xx-retry / 400-403-404-fall-through rules as the
 * Worker path. The API key is read from env — never hardcoded.
 */
const REGION = process.env.AWS_REGION || 'us-east-1';
const BKEY = process.env.BEDROCK_API_KEY || '';
const MODELS = (process.env.BEDROCK_MODEL_ID && process.env.BEDROCK_MODEL_ID.trim())
  ? [process.env.BEDROCK_MODEL_ID.trim()]
  : (process.env.BEDROCK_MODEL_IDS
      || 'anthropic.claude-sonnet-5,us.anthropic.claude-sonnet-5,us.anthropic.claude-sonnet-4-5-20250929-v1:0')
      .split(',').map((s) => s.trim()).filter(Boolean);

export const bedrockConfigured = () => !!BKEY;
export const MODEL_IDS = MODELS;

export async function callBedrock(system, user, { maxTokens = 1200, rounds = 15 } = {}) {
  if (!BKEY) throw new Error('BEDROCK_API_KEY is not set');
  const body = JSON.stringify({
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: user }] }],
    inferenceConfig: { temperature: 0, maxTokens },
  });
  let lastErr = '';
  for (let round = 0; round < rounds; round++) {
    for (const model of MODELS) {
      try {
        const res = await fetch(`https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(model)}/converse`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${BKEY}`, 'content-type': 'application/json', accept: 'application/json' },
          body,
          signal: AbortSignal.timeout(300_000),   // 5 min per attempt — Actions can afford it
        });
        if (res.status === 429 || res.status >= 500) { lastErr = `HTTP ${res.status} (busy)`; continue; }         // busy → next model / next wave
        if ([400, 403, 404].includes(res.status)) { lastErr = `HTTP ${res.status} ${(await res.text()).slice(0, 160)}`; continue; }  // unusable → next id
        if (res.status !== 200) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        const data = await res.json();
        const parts = data && data.output && data.output.message && data.output.message.content;
        const text = Array.isArray(parts) ? parts.map((p) => (p && p.text) || '').join('') : '';
        if (text) return { text, model };
        lastErr = 'empty response';
      } catch (e) { lastErr = `network: ${e.message}`; }
    }
    console.log(`round ${round + 1}/${rounds}: all models busy (${lastErr}); waiting 60s and retrying…`);
    await new Promise((r) => setTimeout(r, 60_000));
  }
  throw new Error(`Bedrock exhausted after ${rounds} waves — last: ${lastErr}`);
}
