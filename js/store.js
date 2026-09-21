/**
 * store.js — the one place that holds "what data are we looking at right now".
 *
 * Tabs never read files or localStorage themselves. They subscribe here, get a
 * snapshot, and re-render. That is what keeps later tabs from rewriting any of this.
 */
import { STORAGE_KEY, SAMPLE_URL } from './config.js';
import { normalizeRows, assignColors, applySearch } from './data.js';

const listeners = new Set();

const state = {
  status: 'loading',    // loading | ready | error
  error: '',
  contacts: [],         // every normalised contact
  visible: [],          // contacts after the header search box
  query: '',
  source: 'sample',     // sample | upload
  fileName: '',
  loadedAt: null,
  persisted: true,      // false when an upload was too big for localStorage
  notice: '',           // a non-fatal message to show once (e.g. partial column match)
};

export const getState = () => state;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener(state);
}

function recomputeVisible() {
  state.visible = applySearch(state.contacts, state.query);
}

/** Swap in a fresh dataset. Colours are re-assigned from the full set, once. */
function adopt(rawRows, meta) {
  const { contacts, unmatchedHeaders } = normalizeRows(rawRows);
  assignColors(contacts);
  state.contacts = contacts;
  state.source = meta.source;
  state.fileName = meta.fileName || '';
  state.loadedAt = meta.loadedAt || new Date();
  state.status = 'ready';
  state.error = '';
  state.notice = unmatchedHeaders.length
    ? `${unmatchedHeaders.length} column${unmatchedHeaders.length > 1 ? 's were' : ' was'} not recognised and ${unmatchedHeaders.length > 1 ? 'were' : 'was'} skipped: ${unmatchedHeaders.slice(0, 4).join(', ')}${unmatchedHeaders.length > 4 ? '…' : ''}`
    : '';
  recomputeVisible();
}

export function setQuery(query) {
  state.query = query;
  recomputeVisible();
  emit();
}

/* ---------- loading ---------- */

async function fetchSample() {
  const response = await fetch(SAMPLE_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load the sample data (${response.status}).`);
  return response.json();
}

export async function loadSample({ silent = false } = {}) {
  if (!silent) {
    state.status = 'loading';
    emit();
  }
  try {
    const rows = await fetchSample();
    adopt(rows, { source: 'sample', loadedAt: new Date() });
  } catch (err) {
    state.status = 'error';
    state.error = location.protocol === 'file:'
      ? 'Open this dashboard through a web address rather than a file — browsers block file access for security. Any static host, or "npx serve" locally, works.'
      : (err.message || 'Something went wrong loading the data.');
    state.contacts = [];
    state.visible = [];
  }
  emit();
}

/** Adopt rows parsed from a user's file, and remember them for next time. */
export function adoptUpload(rawRows, fileName) {
  adopt(rawRows, { source: 'upload', fileName, loadedAt: new Date() });
  state.persisted = persist(rawRows, fileName, state.loadedAt);
  emit();
}

export async function resetToSample() {
  clearStored();
  state.persisted = true;
  await loadSample();
}

/* ---------- localStorage ---------- */

/** Raw rows are stored, not normalised ones, so restoring uses the same code path. */
function persist(rawRows, fileName, loadedAt) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1, fileName, loadedAt: loadedAt.toISOString(), rows: rawRows,
    }));
    return true;
  } catch {
    // Usually the 5MB quota on a very large sheet. The data still works for this
    // session; it just won't survive a refresh, and the chip says so.
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return false;
  }
}

function clearStored() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.rows) && parsed.rows.length ? parsed : null;
  } catch {
    clearStored();
    return null;
  }
}

/** Boot: a previous upload if there is one, otherwise the sample. */
export async function init() {
  const stored = readStored();
  if (stored) {
    try {
      adopt(stored.rows, {
        source: 'upload',
        fileName: stored.fileName,
        loadedAt: new Date(stored.loadedAt),
      });
      emit();
      return;
    } catch {
      clearStored(); // stored data no longer parses — fall through to the sample
    }
  }
  await loadSample();
}
