/**
 * cadences.js — follow-up cadences (auto-create a plan) + single manual reminders.
 *
 * A cadence is a small, editable list of steps: each step is (offset in days from today,
 * a suggested message intent, a short note). Applying one to a contact creates real tasks
 * on that contact through the SAME /api/tasks endpoints the drawer and Follow-ups view use —
 * nothing bespoke, nothing invented. Dates are computed from today at local midnight.
 */
import { today } from './util.js';
import * as store from './store.js';

/* The intents line up with the AI draft feature's DRAFT_INTENTS, so a follow-up's
   "Draft" button can pre-select the right tone. Keep these simple and editable. */
export const CADENCES = [
  {
    key: 'post-meeting', name: 'Post-meeting', icon: 'handshake',
    desc: 'Thank-you → nudge → check-in', steps: [
      { offset: 3, intent: 'Thank you / next step', title: 'Thank-you & recap' },
      { offset: 10, intent: 'Gentle follow-up', title: 'Nudge on the next step' },
      { offset: 21, intent: 'Diligence follow-up', title: 'Check-in' },
    ],
  },
  {
    key: 'new-lead', name: 'New lead', icon: 'sparkles',
    desc: 'Intro → follow-up → check-in', steps: [
      { offset: 1, intent: 'Warm intro', title: 'Send the intro' },
      { offset: 5, intent: 'Gentle follow-up', title: 'Follow-up' },
      { offset: 14, intent: 'Gentle follow-up', title: 'Check-in' },
    ],
  },
  {
    key: 're-engage', name: 'Re-engage', icon: 'clock',
    desc: 'Win back a quiet lead', steps: [
      { offset: 7, intent: 'Re-engage (gone quiet)', title: 'Re-engage' },
      { offset: 21, intent: 'Re-engage (gone quiet)', title: 'Second re-engage' },
    ],
  },
];

export const cadenceByKey = (key) => CADENCES.find((c) => c.key === key) || null;

/** ISO yyyy-mm-dd for today + `offset` days, in local time (matches the date inputs). */
export function dueInDays(offset) {
  const d = today();
  d.setDate(d.getDate() + Number(offset || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Apply a cadence to a contact: one task per step, due today+offset, tagged with the step's
 * intent and (by default) owned by the contact's relationship owner. Best-effort per step;
 * returns how many landed so the caller can report honestly.
 */
export async function applyCadence(contact, key, { owner } = {}) {
  const cadence = cadenceByKey(key);
  if (!cadence) return { ok: false, error: 'Unknown cadence.' };
  let created = 0;
  for (const step of cadence.steps) {
    const r = await store.createTask({
      contactId: contact.id,
      title: step.title,
      dueDate: dueInDays(step.offset),
      owner: owner || contact.relationshipOwner || undefined,
      intent: step.intent,
    });
    if (r.ok) created += 1;
  }
  return { ok: created > 0, created, total: cadence.steps.length, name: cadence.name };
}

/** Add one manual reminder (a dated task with a note + optional intent). */
export async function addReminder(contact, { dueDate, title, intent, owner } = {}) {
  const note = String(title || '').trim();
  if (!note) return { ok: false, error: 'A reminder needs a note.' };
  if (!dueDate) return { ok: false, error: 'A reminder needs a date.' };
  return store.createTask({
    contactId: contact.id, title: note, dueDate,
    owner: owner || contact.relationshipOwner || undefined,
    intent: intent || undefined,
  });
}
