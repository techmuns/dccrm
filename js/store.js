/**
 * store.js — the single source of truth for "what contacts are we looking at".
 *
 * Contacts now live in a Cloudflare D1 database, reached through /api/contacts.
 * The store loads them all once (so every tab's client-side aggregation keeps
 * working unchanged), and exposes create / edit / delete / activity / import.
 *
 * If the API is unreachable (e.g. a preview with no database bound), it falls back
 * to the bundled sample JSON, read-only, and flags preview mode. Tabs don't need to
 * know which mode is active — they read the same `state.contacts` / `state.visible`.
 */
import { SAMPLE_URL } from './config.js';
import { normalizeRows, normalizeContact, assignColors, applySearch, COLOURED_DIMENSIONS } from './data.js';
import { ensureCategory } from './colors.js';

const listeners = new Set();

const state = {
  status: 'loading',   // loading | ready | error
  mode: 'live',        // live | preview
  error: '',
  contacts: [],
  visible: [],         // after the header search box
  query: '',
  total: 0,
  loadedAt: null,
  notice: '',
};

export const getState = () => state;
export const isLive = () => state.mode === 'live';

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit() { for (const listener of listeners) listener(state); }

function recomputeVisible() { state.visible = applySearch(state.contacts, state.query); }

export function setQuery(query) {
  state.query = query;
  recomputeVisible();
  emit();
}

/* ---------- API helper ---------- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status}).`);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

/* ---------- colours ---------- */

/** Colour any categories a single write introduced, without repainting the rest. */
function ensureColours(contact) {
  for (const dim of COLOURED_DIMENSIONS) ensureCategory(dim, contact[dim]);
}

function sortNewestFirst() {
  state.contacts.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

/* ---------- loading ---------- */

/** Boot: try the live database; on any failure, fall back to the read-only sample. */
export async function init() {
  state.status = 'loading';
  emit();
  try {
    const data = await api('/api/contacts?limit=100000');
    adoptLive(data);
  } catch {
    await loadSampleFallback();
  }
  emit();
}

/** Reload everything from the database (after an import or to refresh). */
export async function reload() {
  if (!isLive()) return loadSampleFallback().then(emit);
  const data = await api('/api/contacts?limit=100000');
  adoptLive(data);
  emit();
}

function adoptLive(data) {
  const rows = (data && data.contacts) || [];
  state.contacts = rows.map(normalizeContact);
  assignColors(state.contacts);
  sortNewestFirst();
  state.total = data.total ?? state.contacts.length;
  state.mode = 'live';
  state.status = 'ready';
  state.error = '';
  state.loadedAt = new Date();
  recomputeVisible();
}

async function loadSampleFallback() {
  try {
    const res = await fetch(SAMPLE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load the sample data (${res.status}).`);
    const { contacts } = normalizeRows(await res.json());
    assignColors(contacts);
    state.contacts = contacts;
    state.total = contacts.length;
    state.mode = 'preview';
    state.status = 'ready';
    state.error = '';
    state.loadedAt = new Date();
    recomputeVisible();
  } catch (err) {
    state.status = 'error';
    state.mode = 'preview';
    state.error = location.protocol === 'file:'
      ? 'Open this dashboard through a web address — browsers block file access. Any static host works.'
      : (err.message || 'Something went wrong loading the data.');
    state.contacts = [];
    state.visible = [];
  }
}

/* ---------- writes (live only) ---------- */

const PREVIEW = { ok: false, preview: true, error: 'Preview mode — the database is not connected.' };

export async function createContact(fields) {
  if (!isLive()) return PREVIEW;
  try {
    const { contact } = await api('/api/contacts', { method: 'POST', body: JSON.stringify(fields) });
    const normalised = normalizeContact(contact);
    ensureColours(normalised);
    state.contacts.unshift(normalised);
    state.total += 1;
    recomputeVisible();
    emit();
    return { ok: true, contact: normalised };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Edit one contact. Optimistic by default: the change shows immediately, then the
 * server confirms (or we roll back on failure). `patch` may be one field (quick
 * inline edits) or many (the full edit form).
 */
export async function updateContact(id, patch, { optimistic = true } = {}) {
  if (!isLive()) return PREVIEW;
  const index = state.contacts.findIndex((c) => c.id === id);
  const previous = index >= 0 ? state.contacts[index] : null;

  if (optimistic && previous) {
    const merged = normalizeContact({ ...toFieldObject(previous), ...patch, id, updatedAt: new Date().toISOString() });
    ensureColours(merged);
    state.contacts[index] = merged;
    recomputeVisible();
    emit();
  }

  try {
    const { contact } = await api(`/api/contacts/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    const confirmed = normalizeContact(contact);
    ensureColours(confirmed);
    const at = state.contacts.findIndex((c) => c.id === id);
    if (at >= 0) state.contacts[at] = confirmed;
    recomputeVisible();
    emit();
    return { ok: true, contact: confirmed };
  } catch (err) {
    if (optimistic && previous) {           // roll back
      const at = state.contacts.findIndex((c) => c.id === id);
      if (at >= 0) state.contacts[at] = previous;
      recomputeVisible();
      emit();
    }
    return { ok: false, error: err.message };
  }
}

export async function deleteContact(id) {
  if (!isLive()) return PREVIEW;
  try {
    await api(`/api/contacts/${id}`, { method: 'DELETE' });
    state.contacts = state.contacts.filter((c) => c.id !== id);
    state.total = Math.max(0, state.total - 1);
    recomputeVisible();
    emit();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function getContactDetail(id) {
  if (!isLive()) return { ok: false, preview: true, activities: [] };
  try {
    const data = await api(`/api/contacts/${id}`);
    return { ok: true, contact: normalizeContact(data.contact), activities: data.activities || [] };
  } catch (err) {
    return { ok: false, error: err.message, activities: [] };
  }
}

export async function logActivity(id, activity) {
  if (!isLive()) return PREVIEW;
  try {
    const { activity: saved } = await api(`/api/contacts/${id}/activities`, { method: 'POST', body: JSON.stringify(activity) });
    return { ok: true, activity: saved };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Bulk upsert by email. `rows` are already field-shaped (mapped from a sheet). */
export async function importContacts(rows) {
  if (!isLive()) return PREVIEW;
  try {
    const result = await api('/api/import', { method: 'POST', body: JSON.stringify({ contacts: rows }) });
    await reload();
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export const exportUrl = () => '/api/export';

/* Keep only the writable/id fields when turning a normalised contact back into a
   plain payload for an optimistic re-normalise. */
function toFieldObject(contact) {
  const out = { id: contact.id };
  for (const key of ['fullName', 'entityType', 'role', 'organisation', 'designation', 'email', 'phone',
    'whatsapp', 'whatsappOptIn', 'country', 'city', 'vehicle', 'stage', 'referredBy',
    'lastContact', 'nextAction', 'nextActionDate', 'relationshipOwner', 'source', 'notes']) {
    out[key] = contact[key];
  }
  return out;
}
