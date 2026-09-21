/**
 * ai-insights.js — the AI relationship-scoring module.
 *
 * EVERY threshold and the whole enrichment mapping lives here, on purpose. Today it
 * runs on data/ai-insights.sample.json (sample AI output keyed by email). When real
 * reply-reading is connected, its output replaces the sample and flows through the
 * exact same `enrich()` pipeline — the tab UI never changes. Nothing below reads the
 * DOM or knows about charts; it only turns raw signals into scored, labelled data.
 */
import { createSource } from './source.js';
import * as store from './store.js';
import { daysFromToday, tidy, parseDate } from './util.js';

/* ---- the knobs a data scientist would tune (all in one place) ---- */
export const THRESHOLDS = {
  hot: 70,            // interest score for the "Hot" bucket
  warm: 40,           // interest score for the "Warm" bucket (below this = Cold)
  highScore: 78,      // score alone that makes a contact High priority
  priorityScore: 62,  // score that, with questions + a recent reply, makes High
  manyQuestions: 3,   // "asked several questions"
  recentReplyDays: 5, // "replied recently"
  respondWindow: 7,   // High-priority contacts are the "respond within 2–3 days" queue
  quietDays: 12,      // a warm contact silent this long is "interested but quiet"
};

export const BUCKETS = [
  { id: 'hot',  label: 'Hot',  hint: '70–100', color: '#ef4444', min: 70, max: 100 },
  { id: 'warm', label: 'Warm', hint: '40–69',  color: '#f59e0b', min: 40, max: 69 },
  { id: 'cold', label: 'Cold', hint: '0–39',   color: '#06b6d4', min: 0,  max: 39 },
];

export const SENTIMENTS = [
  { id: 'Positive', color: '#10b981', icon: 'smile' },
  { id: 'Neutral',  color: '#94a3b8', icon: 'meh' },
  { id: 'Negative', color: '#ef4444', icon: 'frown' },
];

export const PRIORITIES = [
  { id: 'High',   color: '#ef4444' },
  { id: 'Medium', color: '#f59e0b' },
  { id: 'Low',    color: '#94a3b8' },
];

export const bucketOf = (score) => BUCKETS.find((b) => score >= b.min && score <= b.max) || BUCKETS[BUCKETS.length - 1];
export const sentimentColor = (s) => (SENTIMENTS.find((x) => x.id === s) || SENTIMENTS[1]).color;
export const priorityColor = (p) => (PRIORITIES.find((x) => x.id === p) || PRIORITIES[2]).color;

/** Derive priority from the raw signals — recomputed here so real AI output scores
    the same way, regardless of any 'priority' the source may or may not send. */
function computePriority(score, questions, replyAgoDays) {
  const recent = replyAgoDays != null && replyAgoDays <= THRESHOLDS.recentReplyDays;
  if (score >= THRESHOLDS.highScore) return 'High';
  if (questions >= THRESHOLDS.manyQuestions && recent) return 'High';
  if (score >= THRESHOLDS.priorityScore && questions >= 2 && replyAgoDays != null && replyAgoDays <= THRESHOLDS.respondWindow) return 'High';
  if (score >= THRESHOLDS.warm || questions >= 1) return 'Medium';
  return 'Low';
}

/** A plain-English "why this is flagged" line. */
function reasonFor(questions, replyAgoDays) {
  const parts = [];
  if (questions > 0) parts.push(`asked ${questions} question${questions === 1 ? '' : 's'}`);
  if (replyAgoDays != null) {
    parts.push(replyAgoDays === 0 ? 'replied today' : `replied ${replyAgoDays} day${replyAgoDays === 1 ? '' : 's'} ago`);
  }
  return parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'Engaged recently';
}

/** Merge one contact with one raw AI record into a single scored object. */
export function enrich(contact, raw) {
  const score = clamp(Number(raw.interestScore) || 0, 0, 100);
  const questions = Math.max(0, Number(raw.questionsAsked) || 0);
  const replyAt = parseDate(raw.replyReceivedDate);
  const replyAgoDays = replyAt ? Math.max(0, -daysFromToday(replyAt)) : null;
  const sentiment = ['Positive', 'Neutral', 'Negative'].includes(tidy(raw.sentiment)) ? tidy(raw.sentiment) : 'Neutral';
  const priority = computePriority(score, questions, replyAgoDays);
  const bucket = bucketOf(score);

  return {
    ...contact,
    ai: {
      interestScore: score,
      sentiment,
      priority,
      bucket: bucket.id,
      bucketLabel: bucket.label,
      questionsAsked: questions,
      replyReceivedAt: replyAt,
      replyAgoDays,
      lastReplySnippet: tidy(raw.lastReplySnippet),
      suggestedReply: tidy(raw.suggestedReply),
      relationshipSummary: tidy(raw.relationshipSummary),   // Feature 1
      suggestedNextStep: tidy(raw.suggestedNextStep),       // Feature 1
      analyzedAt: parseDate(raw.analyzedAt),
      reason: reasonFor(questions, replyAgoDays),
      isPriority: priority === 'High',
      isQuietWarm: score >= THRESHOLDS.warm && priority !== 'High' && replyAgoDays != null && replyAgoDays >= THRESHOLDS.quietDays,
    },
  };
}

/** Join a contact list with an AI enrichment map keyed by (lowercased) email. */
export function joinInsights(contacts, enrichmentMap) {
  if (!enrichmentMap) return [];
  const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]));
  const out = [];
  for (const [email, raw] of Object.entries(enrichmentMap)) {
    const contact = byEmail.get(String(email).toLowerCase());
    if (contact && raw) out.push(enrich(contact, raw));
  }
  return out;
}

/** parse() for the source: accept the keyed-by-email object as-is (validated shape). */
export function parseInsights(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AI insights must be a JSON object keyed by email.');
  }
  const keys = Object.keys(raw);
  if (!keys.length) throw new Error('That file has no AI insights in it.');
  return raw;
}

/* ---- small aggregations the tab uses ---- */
export const priorityQueue = (list) =>
  list.filter((c) => c.ai.isPriority)
    .sort((a, b) => (a.ai.replyAgoDays ?? 99) - (b.ai.replyAgoDays ?? 99) || b.ai.questionsAsked - a.ai.questionsAsked || b.ai.interestScore - a.ai.interestScore);

export const quietWarm = (list) =>
  list.filter((c) => c.ai.isQuietWarm).sort((a, b) => b.ai.interestScore - a.ai.interestScore);

export function sentimentSplit(list) {
  return SENTIMENTS.map((s) => ({
    name: s.id, color: s.color,
    value: list.filter((c) => c.ai.sentiment === s.id).length,
  })).filter((d) => d.value > 0);
}

export function scoreBuckets(list) {
  return BUCKETS.map((b) => ({
    name: b.label, color: b.color, hint: b.hint,
    value: list.filter((c) => c.ai.bucket === b.id).length,
  }));
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const insightsSource = createSource({
  storageKey: 'dccrm.aiInsights.v1',
  sampleUrl: 'data/ai-insights.sample.json',
  parse: parseInsights,
  // When the database is connected, the feed is REAL: each contact's stored AI
  // enrichment merged with their latest analysed reply, keyed by email (see
  // /api/insights). Empty (nothing scored yet) shows the tab's empty state + the
  // "Refresh all AI" call to action, rather than the sample.
  live: {
    isLive: () => store.isLive(),
    load: async () => (await store.getInsights()).insights || {},
  },
});
