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
  STAGE_DORMANT, ACTIVE_STAGES, NEUTRAL,
} from './config.js';
import { registerDimension, colorOf, resetColors } from './colors.js';
import { headerKey, tidy, parseDate, daysFromToday, countBy, rank } from './util.js';

/* Dimensions that get a stable colour assignment at load time. The Overview tab
   uses the first four; the rest are registered now so later tabs inherit them. */
export const COLOURED_DIMENSIONS = ['stage', 'entityType', 'country', 'source', 'relationshipOwner', 'vehicle', 'role'];

/** Canonical spelling for a stage, matched case- and space-insensitively. */
function canonicalStage(value) {
  const raw = tidy(value);
  if (!raw) return '';
  const key = headerKey(raw);
  const match = ALL_STAGES.find((stage) => headerKey(stage) === key);
  return match || raw; // an unknown stage is kept as written rather than dropped
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
  for (const field of FIELDS) {
    const value = row[field];
    contact[field] = value == null ? ''
      : (field === 'lastContact' || field === 'nextActionDate' ? value : tidy(value));
  }
  if (row.id != null) contact.id = row.id;
  if (row.createdAt) contact.createdAt = row.createdAt;
  if (row.updatedAt) contact.updatedAt = row.updatedAt;

  contact.stage = canonicalStage(contact.stage);
  contact.whatsappOptIn = canonicalOptIn(contact.whatsappOptIn);
  contact.lastContactAt = parseDate(contact.lastContact);
  contact.nextActionAt = parseDate(contact.nextActionDate);
  contact.lastContact = contact.lastContactAt ? toISO(contact.lastContactAt) : tidy(contact.lastContact);
  contact.nextActionDate = contact.nextActionAt ? toISO(contact.nextActionAt) : tidy(contact.nextActionDate);
  contact.searchBlob = SEARCH_FIELDS.map((f) => contact[f]).join(' ').toLowerCase();
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

/** The four honest numbers across the top. */
export function headlineNumbers(contacts) {
  let active = 0;
  let onboarded = 0;
  let dueThisWeek = 0;
  let overdue = 0;

  for (const c of contacts) {
    if (ACTIVE_STAGES.includes(c.stage)) active += 1;
    if (c.stage === 'Onboarded') onboarded += 1;
    const days = daysFromToday(c.nextActionAt);
    if (days != null) {
      if (days >= 0 && days <= 7) dueThisWeek += 1;
      else if (days < 0) overdue += 1;
    }
  }
  return { total: contacts.length, active, onboarded, dueThisWeek, overdue };
}

/** Counts per pipeline stage, in pipeline order. Dormant is reported separately. */
export function pipelineStages(contacts) {
  const counts = countBy(contacts, 'stage');
  const total = contacts.length;
  const stages = STAGE_ORDER.map((name) => ({
    name,
    value: counts.get(name) || 0,
    share: total ? (counts.get(name) || 0) / total : 0,
    color: colorOf('stage', name),
  }));
  // Any stage the sheet uses that isn't part of the standard pipeline.
  const extra = [...counts.keys()].filter((name) => !STAGE_ORDER.includes(name));
  const dormant = counts.get(STAGE_DORMANT) || 0;
  const outsideTotal = extra.reduce((sum, name) => sum + counts.get(name), 0);
  return { stages, dormant, outsideTotal, outsideNames: extra };
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
