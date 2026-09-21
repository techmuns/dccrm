/**
 * nav.js — tiny cross-tab navigation with a handoff. Lets one tab open another
 * with a preset filter (e.g. Campaigns' "See the non-repliers" jumps to Contacts
 * pre-filtered to a segment). Kept neutral so tabs don't import each other.
 */
import { activate } from './router.js';

let pendingContactsPreset = null;

/** Switch to Contacts, pre-applying { field: [values] } filters once it mounts. */
export function goToContacts(preset) {
  pendingContactsPreset = preset || null;
  activate('contacts');
}

/** Contacts reads this once on (re)render; returns null after it's consumed. */
export function takeContactsPreset() {
  const preset = pendingContactsPreset;
  pendingContactsPreset = null;
  return preset;
}
