/**
 * GET /api/insights — the AI Insights feed for the tab, built from LIVE D1 data:
 * each contact's stored AI enrichment (Feature 1) merged with their latest analysed
 * email reply (Feature 2), keyed by lowercased email. This is the exact shape the
 * front-end's ai-insights.js `enrich()` pipeline already reads, so the tab renders
 * real output through the same code path the sample used.
 */
import { json, fail, noDb, ensureSchema, latestRepliesByContact } from './_lib.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return noDb();
  try {
    await ensureSchema(env);
    const contacts = (await env.DB.prepare(
      'SELECT id, email, aiScore, aiBand, aiSummary, aiNextStep, aiAnalyzedAt FROM contacts WHERE email IS NOT NULL',
    ).all()).results || [];
    const replies = await latestRepliesByContact(env);

    const insights = {};
    let analyzedAt = null;
    let scored = 0;
    let withReplies = 0;

    for (const c of contacts) {
      const rep = replies.get(c.id);
      const hasAi = c.aiScore != null;
      if (!hasAi && !rep) continue;

      const entry = {};
      if (hasAi) {
        entry.interestScore = c.aiScore;
        entry.band = c.aiBand;
        entry.relationshipSummary = c.aiSummary;
        entry.suggestedNextStep = c.aiNextStep;
        entry.analyzedAt = c.aiAnalyzedAt;
        scored += 1;
        if (c.aiAnalyzedAt && (!analyzedAt || c.aiAnalyzedAt > analyzedAt)) analyzedAt = c.aiAnalyzedAt;
      }
      if (rep) {
        entry.sentiment = rep.sentiment || 'Neutral';
        entry.questionsAsked = rep.questionsAsked || 0;
        entry.replyReceivedDate = rep.receivedAt;
        entry.lastReplySnippet = rep.summary;
        entry.suggestedReply = rep.draftReply;
        withReplies += 1;
        // If a reply exists but the contact hasn't been AI-scored yet, seed a light
        // interest from sentiment so it still surfaces in the queue until enrichment runs.
        if (entry.interestScore == null) {
          entry.interestScore = rep.sentiment === 'Positive' ? 62 : rep.sentiment === 'Negative' ? 25 : 45;
        }
      }
      insights[String(c.email).toLowerCase()] = entry;
    }

    return json({ insights, analyzedAt, count: Object.keys(insights).length, scored, withReplies });
  } catch (err) {
    return fail(err.message || 'Could not build insights.', 500);
  }
}
