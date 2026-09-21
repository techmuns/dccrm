/**
 * campaigns.js — the Campaigns data layer (parsing + rate maths), kept separate
 * from the tab UI so a live email-stats source can replace the sample loader later
 * without touching the widgets. Runs on data/campaigns.sample.json for now.
 */
import { PALETTE } from './config.js';
import { registerDimension, colorOf, hasOwnColor } from './colors.js';
import { createSource } from './source.js';
import { parseDate, tidy, rank, countBy } from './util.js';

/* The email funnel, in order. Colours are fixed so a stage looks the same
   in the list row, the detail funnel and the trend. */
export const FUNNEL_STAGES = [
  { key: 'recipients', name: 'Sent',      color: PALETTE[0] },
  { key: 'delivered',  name: 'Delivered', color: PALETTE[1] },
  { key: 'opened',     name: 'Opened',    color: PALETTE[5] },
  { key: 'clicked',    name: 'Clicked',   color: PALETTE[3] },
  { key: 'replied',    name: 'Replied',   color: PALETTE[2] },
];

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Normalise one raw campaign row into the shape the tab reads. */
function normalizeOne(raw) {
  const recipients = num(raw.recipients ?? raw.sent ?? raw.Recipients);
  const delivered = num(raw.delivered ?? raw.Delivered);
  const opened = num(raw.opened ?? raw.Opened);
  const clicked = num(raw.clicked ?? raw.Clicked);
  const replied = num(raw.replied ?? raw.Replied);
  const bounced = num(raw.bounced ?? raw.Bounced ?? (recipients - delivered));
  const unsubscribed = num(raw.unsubscribed ?? raw.Unsubscribed);
  const name = tidy(raw.name ?? raw.Name ?? raw.campaign ?? 'Untitled campaign');
  const segment = tidy(raw.segment ?? raw.Segment ?? 'All investors');
  const sentDate = tidy(raw.sentDate ?? raw.SentDate ?? raw.date ?? '');
  const sentAt = parseDate(sentDate);

  const rate = (n) => (recipients ? n / recipients : 0);
  return {
    name, segment, sentDate, sentAt,
    recipients, delivered, opened, clicked, replied, bounced, unsubscribed,
    repliedCount: replied,
    noReplyCount: Math.max(0, recipients - replied),
    rates: { delivered: rate(delivered), opened: rate(opened), clicked: rate(clicked), replied: rate(replied) },
    funnel: FUNNEL_STAGES.map((s) => ({
      name: s.name, color: s.color,
      value: s.key === 'recipients' ? recipients : num(raw[s.key] ?? { delivered, opened, clicked, replied }[s.key]),
    })),
  };
}

/** parse(): raw JSON array (or sheet rows) → sorted, enriched campaigns. */
export function parseCampaigns(raw) {
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.campaigns) ? raw.campaigns : [];
  if (!rows.length) throw new Error('That file has no campaigns in it.');
  const campaigns = rows.map(normalizeOne).filter((c) => c.recipients > 0);
  if (!campaigns.length) throw new Error('No usable campaigns (each needs a recipients count).');
  campaigns.sort((a, b) => (a.sentAt?.getTime() || 0) - (b.sentAt?.getTime() || 0));
  // Give each segment a stable colour for this tab.
  registerDimension('segment', rank(countBy(campaigns, 'segment')).map((d) => d.name));
  return campaigns;
}

// Prefer the entity-type colour so a segment like "FPI" is the same hue here as on
// every other tab; fall back to the segment dimension for non-entity segments.
export const segmentColor = (segment) =>
  (hasOwnColor('entityType', segment) ? colorOf('entityType', segment) : colorOf('segment', segment));

/** Open-rate and reply-rate across campaigns over time, for the trend line. */
export function trendSeries(campaigns) {
  const ordered = [...campaigns].sort((a, b) => (a.sentAt?.getTime() || 0) - (b.sentAt?.getTime() || 0));
  return {
    categories: ordered.map((c) => shortLabel(c)),
    opened: ordered.map((c) => Math.round(c.rates.opened * 100)),
    replied: ordered.map((c) => Math.round(c.rates.replied * 100)),
  };
}

function shortLabel(c) {
  if (c.sentAt) return c.sentAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return c.name.slice(0, 10);
}

export const campaignsSource = createSource({
  storageKey: 'dccrm.campaigns.v1',
  sampleUrl: 'data/campaigns.sample.json',
  parse: parseCampaigns,
});
