/**
 * filters.js — pure helpers shared by the Contacts and Follow-ups tabs.
 *
 * No DOM here. The FilterBar component drives these; the tabs combine them with
 * their own extra predicates (buckets, "needs a nudge"). Everything derives its
 * categories from the loaded data, so nothing is hard-coded to the sample.
 */
import { ACTIVE_STAGES, FIELDS } from './config.js';
import { colorOf } from './colors.js';
import { countBy, rank, daysFromToday, tidy } from './util.js';

/** Options for one filter dropdown: every value present, most common first, with its colour. */
export function filterOptions(contacts, field) {
  return rank(countBy(contacts, field)).map((d) => ({
    value: d.name,
    count: d.value,
    color: colorOf(field, d.name),
  }));
}

/**
 * Apply a set of dimension selections and boolean toggles to a contact list.
 *   selections: { [field]: Set<string> }   — OR within a field, AND across fields
 *   toggles:    [{ predicate(contact) -> bool }]  — every active toggle must pass
 */
export function applyFilters(contacts, selections = {}, toggles = []) {
  const active = Object.entries(selections).filter(([, set]) => set && set.size);
  if (!active.length && !toggles.length) return contacts;

  return contacts.filter((contact) => {
    for (const [field, set] of active) {
      if (!set.has(tidy(contact[field]))) return false;
    }
    for (const toggle of toggles) {
      if (!toggle.predicate(contact)) return false;
    }
    return true;
  });
}

/* ---------- Follow-up urgency ---------- */

/** Which urgency bucket a contact's next action falls into. */
export function bucketOf(contact) {
  const days = daysFromToday(contact.nextActionAt);
  if (days == null) return 'none';
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 7) return 'week';
  return 'later';
}

export const BUCKETS = [
  { id: 'overdue', label: 'Overdue',      icon: 'alarm-clock-off', color: '#c0392b' },
  { id: 'today',   label: 'Due today',    icon: 'calendar-clock',  color: '#c08a2e' },
  { id: 'week',    label: 'Due this week', icon: 'calendar-days',   color: '#a83a5b' },
  { id: 'later',   label: 'Later',        icon: 'calendar-range',  color: '#4c6ea5' },
  { id: 'none',    label: 'No date set',  icon: 'calendar-x',      color: '#9a9aa0' },
];

/** Count of contacts in each bucket. */
export function bucketCounts(contacts) {
  const counts = { overdue: 0, today: 0, week: 0, later: 0, none: 0 };
  for (const contact of contacts) counts[bucketOf(contact)] += 1;
  return counts;
}

/**
 * "Needs a nudge": in an active stage but gone quiet — last contact more than
 * `days` ago, or no contact on record at all despite an active stage.
 */
export function needsNudge(contact, days = 30) {
  if (!ACTIVE_STAGES.includes(contact.stage)) return false;
  const since = daysFromToday(contact.lastContactAt);
  return since == null || since < -days;
}

export const countNudge = (contacts, days = 30) =>
  contacts.reduce((sum, c) => sum + (needsNudge(c, days) ? 1 : 0), 0);

/**
 * Follow-ups due, grouped into the next `weeks` seven-day windows from today.
 * Overdue items are not counted here — this is the road ahead.
 */
export function dueByWeek(contacts, weeks = 6) {
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    index: i,
    start: i * 7,
    end: i * 7 + 6,
    value: 0,
    name: i === 0 ? 'This week' : i === 1 ? 'Next week' : `In ${i} weeks`,
  }));
  for (const contact of contacts) {
    const days = daysFromToday(contact.nextActionAt);
    if (days == null || days < 0) continue;
    const i = Math.floor(days / 7);
    if (i < weeks) buckets[i].value += 1;
  }
  return buckets;
}

/* ---------- CSV export ---------- */

const CSV_HEADERS = {
  fullName: 'Full Name', entityType: 'Entity Type', role: 'Role', organisation: 'Organisation Name',
  designation: 'Designation', email: 'Email', phone: 'Phone (display)', altPhone: 'Alt Phone',
  whatsapp: 'WhatsApp Number (E.164)', whatsappOptIn: 'WhatsApp Opt-In', country: 'Primary Country', city: 'Primary City',
  vehicle: 'Vehicle', stage: 'Stage', tier: 'Tier', priority: 'Priority', referredBy: 'Referred By',
  lastContact: 'Last Contact', nextAction: 'Next Action', nextActionDate: 'Next Action Date',
  relationshipOwner: 'Relationship Owner', source: 'Source / Channel', signal: 'Signal / Tags',
  notes: 'Notes', roughNotes: 'Rough Notes for Raghav',
};

const csvCell = (value) => {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Turn a contact list into a CSV string, using the sheet's own header names. */
export function contactsToCsv(contacts) {
  const header = FIELDS.map((f) => csvCell(CSV_HEADERS[f] || f)).join(',');
  const lines = contacts.map((contact) => FIELDS.map((f) => csvCell(contact[f])).join(','));
  return [header, ...lines].join('\r\n');
}
