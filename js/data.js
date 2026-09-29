/**
 * data.js — the data layer.
 *
 * Takes rows exactly as they come out of a sheet (or the sample JSON), maps the
 * headers onto one normalised contact shape, and exposes the small set of
 * calculations the Overview tab needs. Every category list is derived from
 * whatever data is loaded — nothing here is hard-coded to the sample.
 */
import {
  HEADER_MAP, FIELDS, SEARCH_FIELDS, ALL_STAGES, STAGE_ORDER,
  STAGE_INVESTED, ACTIVE_STAGES, HEAT_VALUES, NEUTRAL,
  STAGE_GATES, FIELD_LABELS,
} from './config.js';
import { registerDimension, colorOf, resetColors } from './colors.js';
import { headerKey, tidy, parseDate, daysFromToday, countBy, rank } from './util.js';

/* Dimensions that get a stable colour assignment at load time. The Overview tab
   uses the first four; the rest are registered now so later tabs inherit them. */
export const COLOURED_DIMENSIONS = ['stage', 'heat', 'entityType', 'country', 'source', 'relationshipOwner', 'vehicle', 'role'];

/** A record is "closed" (Passed / Disqualified) — outside the six active stages. */
export const isClosed = (c) => !!(c && tidy(c.closedStatus));

/** An "active" record is one we should be working: not closed and not parked (dormant). */
export const isActive = (c) => !!c && !isClosed(c) && !c.dormant;

/**
 * Soft-required check (Phase 10): what an ACTIVE record is missing to be well-formed.
 * Owner is expected from Target onward; a "Next step" is action text + a due date. Returns a
 * short list like ['Owner', 'Next step'] — empty when nothing's missing or the record isn't active.
 * These are flagged, never blocked, because imported rows are sparse.
 */
export function needsAttentionReasons(c) {
  if (!isActive(c)) return [];
  const out = [];
  if (!tidy(c.relationshipOwner)) out.push('Owner');
  if (!tidy(c.nextAction) || !tidy(c.nextActionDate)) out.push('Next step');
  return out;
}
/** Active records missing an Owner or a Next step — the dashboard "Needs attention" list. */
export const needsAttention = (contacts) => (contacts || []).filter((c) => needsAttentionReasons(c).length);

/**
 * The drawer's "what's needed to advance" checklist: the requirements to reach the NEXT
 * stage, each with whether it's met. Hard-gate fields when the next stage gates on entry
 * (Vehicle+Target ticket for Diligence, Committed amount+Funding date for Committed);
 * otherwise the soft-requireds. Null at the final stage, an unknown stage, or when closed.
 */
export function advanceChecklist(contact) {
  if (!contact || isClosed(contact)) return null;
  const idx = STAGE_ORDER.indexOf(contact.stage);
  if (idx < 0 || idx >= STAGE_ORDER.length - 1) return null;
  const next = STAGE_ORDER[idx + 1];
  const gate = STAGE_GATES[next];
  const items = gate
    ? gate.fields.map((f) => ({ label: FIELD_LABELS[f] || f, met: tidy(contact[f]) !== '' }))
    : [
      { label: 'Owner assigned', met: tidy(contact.relationshipOwner) !== '' },
      { label: 'Next step set', met: tidy(contact.nextAction) !== '' && tidy(contact.nextActionDate) !== '' },
    ];
  return { next, hard: !!gate, items };
}

/** Canonical spelling for a stage, matched case- and space-insensitively. */
function canonicalStage(value) {
  const raw = tidy(value);
  if (!raw) return '';
  const key = headerKey(raw);
  const match = ALL_STAGES.find((stage) => headerKey(stage) === key);
  return match || raw; // an unknown stage is kept as written rather than dropped
}

/** Canonical Heat value (Hot / Warm / Cold), matched case-insensitively; else blank. */
function canonicalHeat(value) {
  const key = headerKey(value);
  if (!key) return '';
  return HEAT_VALUES.find((h) => headerKey(h) === key) || '';
}

/** Fix known spelling slips in Entity Type (e.g. the sheet's "Fmaily Office"); else keep as written. */
const ENTITY_TYPE_FIXES = { fmailyoffice: 'Family Office', familyofice: 'Family Office', famioffice: 'Family Office' };
function canonicalEntityType(value) {
  const v = tidy(value);
  if (!v) return '';
  return ENTITY_TYPE_FIXES[headerKey(v)] || v;
}

/** "Yes" / "true" / "1" / "y" -> true; blank stays blank so we can tell "no" from "unknown". */
function canonicalOptIn(value) {
  const key = headerKey(value);
  if (!key) return '';
  if (['yes', 'y', 'true', '1', 'optedin', 'opted', 'consented'].includes(key)) return 'Yes';
  if (['no', 'n', 'false', '0', 'optedout'].includes(key)) return 'No';
  return tidy(value);
}

/**
 * Work out which sheet column feeds which field.
 * Returns { map: {header -> field}, matched: [fields], unmatched: [headers] }.
 */
export function mapHeaders(headers) {
  const map = {};
  const matched = new Set();
  const unmatched = [];
  for (const header of headers) {
    const field = HEADER_MAP[headerKey(header)];
    if (field && !matched.has(field)) {
      map[header] = field;
      matched.add(field);
    } else if (field) {
      map[header] = field; // a duplicate column for the same field — first non-blank wins
    } else {
      unmatched.push(header);
    }
  }
  return { map, matched: [...matched], unmatched };
}

/**
 * Normalise ONE already-field-shaped record (from the API, or a mapped sheet row)
 * into the contact shape every tab reads: canonical stage/opt-in, parsed dates, a
 * search blob — plus id/createdAt/updatedAt when the source (the database) has them.
 */
export function normalizeContact(row) {
  const contact = {};
  const RAW_DATE_FIELDS = ['lastContact', 'nextActionDate', 'wakeDate', 'revisitDate', 'fundingDate'];
  for (const field of FIELDS) {
    const value = row[field];
    contact[field] = value == null ? ''
      : (RAW_DATE_FIELDS.includes(field) ? value : tidy(value));
  }
  if (row.id != null) contact.id = row.id;
  if (row.createdAt) contact.createdAt = row.createdAt;
  if (row.updatedAt) contact.updatedAt = row.updatedAt;
  if (row.updatedBy) contact.updatedBy = row.updatedBy;
  contact.tags = Array.isArray(row.tags) ? row.tags : [];
  // AI relationship enrichment (Feature 1), carried through unchanged when present.
  if (row.aiScore != null) contact.aiScore = row.aiScore;
  if (row.aiBand) contact.aiBand = row.aiBand;
  if (row.aiSummary) contact.aiSummary = row.aiSummary;
  if (row.aiNextStep) contact.aiNextStep = row.aiNextStep;
  if (row.aiAnalyzedAt) contact.aiAnalyzedAt = row.aiAnalyzedAt;
  if (row.aiModel) contact.aiModel = row.aiModel;

  contact.stage = canonicalStage(contact.stage);
  contact.entityType = canonicalEntityType(contact.entityType);
  contact.whatsappOptIn = canonicalOptIn(contact.whatsappOptIn);
  // Finalised model (Phase 9): Heat / Dormant / Closed are separate from Stage.
  contact.heat = canonicalHeat(contact.heat);
  contact.dormant = row.dormant === 1 || row.dormant === true || /^(1|yes|true|y)$/i.test(String(row.dormant ?? ''));
  contact.closedStatus = tidy(contact.closedStatus).toLowerCase();
  contact.lastContactAt = parseDate(contact.lastContact);
  contact.nextActionAt = parseDate(contact.nextActionDate);
  contact.wakeDateAt = parseDate(contact.wakeDate);
  contact.revisitDateAt = parseDate(contact.revisitDate);
  contact.fundingDateAt = parseDate(contact.fundingDate);
  contact.lastContact = contact.lastContactAt ? toISO(contact.lastContactAt) : tidy(contact.lastContact);
  contact.nextActionDate = contact.nextActionAt ? toISO(contact.nextActionAt) : tidy(contact.nextActionDate);
  contact.wakeDate = contact.wakeDateAt ? toISO(contact.wakeDateAt) : tidy(contact.wakeDate);
  contact.revisitDate = contact.revisitDateAt ? toISO(contact.revisitDateAt) : tidy(contact.revisitDate);
  contact.fundingDate = contact.fundingDateAt ? toISO(contact.fundingDateAt) : tidy(contact.fundingDate);
  const tagNames = contact.tags.map((t) => t.name).join(' ');
  contact.searchBlob = (SEARCH_FIELDS.map((f) => contact[f]).join(' ') + ' ' + tagNames).toLowerCase();
  return contact;
}

/** Turn raw sheet rows into normalised contacts. Throws if no column can be recognised. */
export function normalizeRows(rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  if (!rows.length) throw new Error('That file has no rows in it.');

  // Union of keys across the first rows — sheets sometimes omit trailing blank columns.
  const headers = [...new Set(rows.slice(0, 50).flatMap((row) => Object.keys(row || {})))];
  const { map, matched, unmatched } = mapHeaders(headers);

  if (!matched.includes('fullName') && matched.length < 3) {
    throw new Error(
      "We couldn't recognise the columns in that file. It needs headers like " +
      '"Full Name", "Entity Type", "Stage" and "Primary Country".'
    );
  }

  const contacts = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;

    // Map this row's headers onto field names (first non-blank column wins).
    const fieldObj = {};
    for (const [header, field] of Object.entries(map)) {
      const value = raw[header];
      if (fieldObj[field] == null && value != null && value !== '') fieldObj[field] = value;
    }

    const contact = normalizeContact(fieldObj);

    // A row with nothing identifying in it is noise, not a contact.
    if (!contact.fullName && !contact.email && !contact.organisation) continue;
    contacts.push(contact);
  }

  if (!contacts.length) throw new Error('That file has headers but no usable contact rows.');
  return { contacts, matchedFields: matched, unmatchedHeaders: unmatched };
}

const toISO = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * Assign every dimension its colours, once, from the full dataset.
 * Stage follows pipeline order; everything else follows how common it is.
 */
export function assignColors(contacts) {
  // Re-register each contact dimension (registerDimension replaces that dimension's
  // map). We intentionally do NOT reset the whole registry — other modules
  // (e.g. Campaigns' 'segment') register their own dimensions and must survive.
  for (const dimension of COLOURED_DIMENSIONS) {
    const present = rank(countBy(contacts, dimension)).map((d) => d.name);
    const ordered = dimension === 'stage'
      ? [...ALL_STAGES.filter((s) => present.includes(s)), ...present.filter((s) => !ALL_STAGES.includes(s))]
      : present;
    registerDimension(dimension, ordered);
  }
}

/* ---------- calculations the Overview tab reads ---------- */

/** Case-insensitive search across the fields that identify a person. */
export function applySearch(contacts, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return contacts;
  const terms = q.split(/\s+/);
  return contacts.filter((c) => terms.every((term) => c.searchBlob.includes(term)));
}

/** The four honest numbers across the top. Closed records sit outside the active numbers. */
export function headlineNumbers(contacts) {
  let active = 0;
  let invested = 0;
  let dueThisWeek = 0;
  let overdue = 0;
  let closed = 0;
  let dormant = 0;

  for (const c of contacts) {
    if (isClosed(c)) { closed += 1; continue; }   // closed are out of the active pipeline
    if (c.dormant) dormant += 1;
    if (ACTIVE_STAGES.includes(c.stage)) active += 1;
    if (c.stage === STAGE_INVESTED) invested += 1;
    const days = daysFromToday(c.nextActionAt);
    if (days != null) {
      if (days >= 0 && days <= 7) dueThisWeek += 1;
      else if (days < 0) overdue += 1;
    }
  }
  return { total: contacts.length, active, invested, dueThisWeek, overdue, closed, dormant };
}

/**
 * Counts per pipeline stage, in pipeline order — over the ACTIVE (non-closed) records only.
 * Closed (Passed / Disqualified) and Dormant are reported separately, not in the funnel.
 */
export function pipelineStages(contacts) {
  const open = contacts.filter((c) => !isClosed(c));   // the funnel is the active pipeline
  const counts = countBy(open, 'stage');
  const total = open.length;
  const stages = STAGE_ORDER.map((name) => ({
    name,
    value: counts.get(name) || 0,
    share: total ? (counts.get(name) || 0) / total : 0,
    color: colorOf('stage', name),
  }));
  const dormant = open.reduce((sum, c) => sum + (c.dormant ? 1 : 0), 0);
  let passed = 0;
  let disqualified = 0;
  for (const c of contacts) {
    if (c.closedStatus === 'passed') passed += 1;
    else if (c.closedStatus === 'disqualified') disqualified += 1;
  }
  return { stages, dormant, passed, disqualified, closed: passed + disqualified, total };
}

/**
 * A ranked, coloured series for one field.
 *   limit     — keep the top N (default: all)
 *   foldOther — roll everything past the palette into a single "Other" slice
 *               (used by the donut, where slivers are unreadable)
 */
export function series(contacts, field, { limit = 0, foldOther = false } = {}) {
  const ranked = rank(countBy(contacts, field));
  const total = ranked.reduce((sum, d) => sum + d.value, 0);

  let items = ranked;
  let folded = null;

  if (foldOther && ranked.length > 8) {
    const head = ranked.slice(0, 7);
    const tail = ranked.slice(7);
    folded = {
      name: 'Other',
      value: tail.reduce((sum, d) => sum + d.value, 0),
      color: NEUTRAL,
      members: tail.map((d) => `${d.name} (${d.value})`),
    };
    items = head;
  } else if (limit) {
    items = ranked.slice(0, limit);
  }

  const data = items.map((d) => ({
    name: d.name,
    value: d.value,
    color: colorOf(field, d.name),
    share: total ? d.value / total : 0,
  }));
  if (folded) data.push({ ...folded, share: total ? folded.value / total : 0 });

  return { data, total, hiddenCount: Math.max(0, ranked.length - data.length + (folded ? 1 : 0)) };
}
