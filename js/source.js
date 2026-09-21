/**
 * source.js — a small generic data source, mirroring the Phase 1 store's
 * sample-vs-upload pattern but reusable for any tab that has its own dataset.
 *
 * Campaigns and AI Insights each create one of these. Today they load a sample
 * JSON from /data; when the live source is connected later, only the `parse`
 * function (or the loader) changes — subscribers and the UI stay the same.
 */
export function createSource({ storageKey, sampleUrl, parse }) {
  const listeners = new Set();
  const state = {
    status: 'loading',       // loading | ready | error
    origin: 'sample',        // sample | upload
    data: null,
    fileName: '',
    loadedAt: null,
    error: '',
    persisted: true,
  };

  const emit = () => { for (const fn of listeners) fn(state); };

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  async function loadSample({ silent = false } = {}) {
    if (!silent) { state.status = 'loading'; emit(); }
    try {
      const res = await fetch(sampleUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not load the sample data (${res.status}).`);
      const raw = await res.json();
      state.data = parse(raw);
      state.origin = 'sample';
      state.fileName = '';
      state.loadedAt = new Date();
      state.status = 'ready';
      state.error = '';
    } catch (err) {
      state.status = 'error';
      state.data = null;
      state.error = location.protocol === 'file:'
        ? 'Open this dashboard through a web address rather than a file — browsers block file access.'
        : (err.message || 'Something went wrong loading the data.');
    }
    emit();
  }

  /** Replace with a parsed dataset (from a file), and remember it. */
  function replace(raw, fileName) {
    state.data = parse(raw);          // throws on a bad shape — caller catches
    state.origin = 'upload';
    state.fileName = fileName || '';
    state.loadedAt = new Date();
    state.status = 'ready';
    state.error = '';
    state.persisted = persist(raw, fileName, state.loadedAt);
    emit();
  }

  function persist(raw, fileName, loadedAt) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, fileName, loadedAt: loadedAt.toISOString(), raw }));
      return true;
    } catch {
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
      return false;
    }
  }

  function readStored() {
    try {
      const rawStr = localStorage.getItem(storageKey);
      if (!rawStr) return null;
      const parsed = JSON.parse(rawStr);
      return parsed?.raw != null ? parsed : null;
    } catch { return null; }
  }

  async function reset() {
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    state.persisted = true;
    await loadSample();
  }

  async function init() {
    const stored = readStored();
    if (stored) {
      try {
        state.data = parse(stored.raw);
        state.origin = 'upload';
        state.fileName = stored.fileName || '';
        state.loadedAt = new Date(stored.loadedAt);
        state.status = 'ready';
        emit();
        return;
      } catch {
        try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
      }
    }
    await loadSample();
  }

  return { state, subscribe, init, replace, reset, loadSample, getStored: readStored };
}
