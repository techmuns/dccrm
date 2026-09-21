/**
 * functions/api/_bedrock.js — Amazon Bedrock, the exact proven pattern from
 * techmuns/paramemo (worker/index.js callClaude): a Bedrock API KEY used as a
 * Bearer token (NOT AWS SigV4), the Converse endpoint, a model fallback chain, and
 * bounded retries sized for a Cloudflare Pages Function's wall-clock.
 *
 * This is the DIRECT, on-demand path used by single actions (e.g. "Refresh AI" on one
 * contact). Bulk work runs the PATIENT version in scripts/_bedrock.mjs on GitHub
 * Actions, which has no Worker timeout. Secrets are ALWAYS read from env — never
 * hardcoded, never sent to the browser.
 *
 * Underscore-prefixed, so Cloudflare Pages never treats it as a route.
 */

/** Resolve a secret/var tolerantly: exact name, then a case-insensitive match. */
export function pickSecret(env, name) {
  if (env && env[name] != null && String(env[name]).trim()) return String(env[name]).trim();
  if (env) {
    const lower = name.toLowerCase();
    for (const k of Object.keys(env)) {
      if (k.toLowerCase() === lower && env[k] != null && String(env[k]).trim()) return String(env[k]).trim();
    }
  }
  return '';
}

export const bedrockConfigured = (env) => !!pickSecret(env, 'BEDROCK_API_KEY');

// The default fallback chain: prefer Sonnet 5, fall back to the proven Sonnet 4.5 profile.
const DEFAULT_MODEL_CHAIN = [
  'anthropic.claude-sonnet-5',                     // preferred (clean Bedrock id)
  'us.anthropic.claude-sonnet-5',                  // US cross-region inference profile
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0',  // proven fallback — keep last
];

/** BEDROCK_MODEL_ID (single override) → BEDROCK_MODEL_IDS (comma list) → default chain. */
export function modelChain(env) {
  const single = pickSecret(env, 'BEDROCK_MODEL_ID');
  if (single) return [single];
  const raw = pickSecret(env, 'BEDROCK_MODEL_IDS');
  if (raw) { const list = raw.split(',').map((s) => s.trim()).filter(Boolean); if (list.length) return list; }
  return DEFAULT_MODEL_CHAIN;
}

/**
 * Call Bedrock Converse with the Bearer API key. Tries each model in the chain;
 * retries the SAME id on 429/5xx (transient/busy), falls through to the NEXT id on
 * 400/403/404 (model unusable). Returns { text, model }; throws on total failure.
 */
export async function callBedrock(env, { system, user, maxTokens = 1200 }) {
  const key = pickSecret(env, 'BEDROCK_API_KEY');
  if (!key) { const e = new Error('The AI features are not switched on yet — set BEDROCK_API_KEY.'); e.status = 503; e.code = 'no-bedrock'; throw e; }
  const region = pickSecret(env, 'AWS_REGION') || 'us-east-1';
  const headers = {
    Authorization: `Bearer ${key}`,          // Bedrock API key (Bearer, not SigV4)
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const body = JSON.stringify({
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: user }] }],
    inferenceConfig: { temperature: 0, maxTokens },
  });

  const models = modelChain(env);
  let sawBusy = false;
  let lastErr = '';
  for (const modelId of models) {
    const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;
    // Retry only genuinely-transient failures (429/5xx, a dropped connection); do NOT
    // hammer a timed-out call. One slow-but-complete attempt beats several aborted ones.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(1500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400));
      let res;
      try {
        res = await fetch(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        lastErr = `network: ${e.message}`;
        if (e.name === 'TimeoutError') break;   // too slow — stop; another wait won't help
        continue;                               // transient blip — retry same id
      }
      if (res.status === 429 || res.status >= 500) { sawBusy = true; lastErr = `HTTP ${res.status} (busy)`; continue; }
      if (res.status === 400 || res.status === 403 || res.status === 404) { lastErr = `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`; break; } // next id
      if (res.status !== 200) { lastErr = `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`; break; }
      const data = await res.json().catch(() => null);
      const parts = data && data.output && data.output.message && data.output.message.content;
      const text = Array.isArray(parts) ? parts.map((p) => (p && p.text) || '').join('') : '';
      if (text) return { text, model: modelId };
      lastErr = 'empty response';
      break; // empty from this id → try the next
    }
  }
  const e = new Error(sawBusy
    ? `The AI service is busy right now — please try again in a moment. (${lastErr})`
    : `The AI request could not be completed. (${lastErr})`);
  e.status = 502;
  throw e;
}

/* ---------- GitHub Actions handoff (bulk work, no Worker timeout) ---------- */

export function dispatchConfigured(env) {
  return !!(pickSecret(env, 'GITHUB_DISPATCH_TOKEN') && pickSecret(env, 'GH_OWNER') && pickSecret(env, 'GH_REPO'));
}

/**
 * Fire a repository_dispatch so a GitHub Action does bulk AI work patiently.
 * Mirrors paramemo's dispatch handshake. Nothing sensitive travels in the payload.
 */
export async function dispatchWorkflow(env, eventType, clientPayload = {}) {
  const token = pickSecret(env, 'GITHUB_DISPATCH_TOKEN');
  const owner = pickSecret(env, 'GH_OWNER');
  const repo = pickSecret(env, 'GH_REPO');
  if (!token || !owner || !repo) {
    const e = new Error('Bulk AI runs need GITHUB_DISPATCH_TOKEN, GH_OWNER and GH_REPO to be set.');
    e.status = 503; e.code = 'no-dispatch'; throw e;
  }
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'dccrm-worker',
    },
    body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
  });
  if (!res.ok) {
    const e = new Error(`GitHub dispatch failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
    e.status = 502; throw e;
  }
  return true;
}

/** Shared-secret check for the GHA/ingest endpoints (Authorization: Bearer <secret>). */
export function bearerAuthed(request, secret) {
  if (!secret) return false;
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return got === secret;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
