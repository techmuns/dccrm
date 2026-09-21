/**
 * POST /api/ai/refresh-all — kick off the BULK enrichment run on GitHub Actions
 * (patient Bedrock retries, no Worker timeout). Fires a repository_dispatch; the
 * Action reads the contacts to score from /api/ai/pending and posts results back to
 * /api/ai/result. Body: { scope?: "all" | "changed" }.
 */
import { json, fail, noDb, ensureSchema } from '../_lib.js';
import { dispatchWorkflow, dispatchConfigured } from '../_bedrock.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  if (!dispatchConfigured(env)) {
    return fail('Bulk AI runs need GITHUB_DISPATCH_TOKEN, GH_OWNER and GH_REPO to be set.', 503, { code: 'no-dispatch' });
  }
  let scope = 'all';
  try { const b = await request.json(); if (b && b.scope === 'changed') scope = 'changed'; } catch { /* default all */ }
  try {
    await ensureSchema(env);
    await dispatchWorkflow(env, 'enrich-contacts', { scope });
    return json({ ok: true, dispatched: true, scope });
  } catch (err) {
    return fail(err.message || 'Could not start the bulk run.', err.status || 502, err.code ? { code: err.code } : {});
  }
}
