/**
 * nav.js — tiny cross-tab navigation with a handoff. Lets one tab open another
 * with a preset filter (e.g. Campaigns' "See the non-repliers" jumps to Contacts
 * pre-filtered to a segment). Kept neutral so tabs don't import each other.
 */
import { activate } from './router.js';

let pendingContactsPreset = null;
let pendingComposeAudience = null;
let pendingInvestorsView = null;

/** Switch to Investors, pre-applying { field: [values] } filters once it mounts. */
export function goToContacts(preset) {
  pendingContactsPreset = preset || null;
  activate('investors');
}

/** Contacts reads this once on (re)render; returns null after it's consumed. */
export function takeContactsPreset() {
  const preset = pendingContactsPreset;
  pendingContactsPreset = null;
  return preset;
}

/** Switch to Outreach (Compose sub-view) with a handed-off audience (a set/array of ids). */
export function goToCompose(ids) {
  pendingComposeAudience = ids && ids.size ? new Set(ids) : (Array.isArray(ids) && ids.length ? new Set(ids) : null);
  activate('outreach');
}

/** Compose reads this once on mount; returns null after it's consumed. */
export function takeComposeAudience() {
  const ids = pendingComposeAudience;
  pendingComposeAudience = null;
  return ids;
}

/** Switch to Investors and open its Follow-ups view (folded in from the old tab). */
export function goToFollowups() {
  pendingInvestorsView = 'followups';
  activate('investors');
}

/** Investors reads this once on (re)render; returns null after it's consumed. */
export function takeInvestorsView() {
  const v = pendingInvestorsView;
  pendingInvestorsView = null;
  return v;
}
