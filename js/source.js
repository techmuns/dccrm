/**
 * source.js — a small generic data source, mirroring the Phase 1 store's
 * sample-vs-upload pattern but reusable for any tab that has its own dataset.
 *
 * Campaigns and AI Insights each create one of these. When a `live` adapter is given
 * AND it reports the database is connected, the source loads from the live API
 * (Campaigns from D1, AI Insights from the enrichment feed) and an upload is routed
 * into the database; otherwise it behaves exactly as before — a bundled sample JSON,
 * with an optional in-browser upload. Either way subscribers and the tab UI are the
 * same, so nothing downstream changes.
 *
 * `live` = { isLive(): bool, load(): Promise<raw>, onReplace?(raw, fileName): Promise,
 *            fallbackWhenEmpty?: bool }  — all optional.
 */
export function createSource({ storageKey, sampleUrl, parse, live = null }) {
  const listeners = new Set();
  const state = {
    status: 'loading',       // loading | ready | error
    origin: 'sample',        // sample | upload | live
    data: null,
    fileName: '',
    loadedAt: null,
    error: '',
    persisted: true,
    meta: null,              // live loaders may stash extra info here (e.g. analyzedAt)
  };

  const emit = () => { for (const fn of listeners) fn(state); };
  const isLive = () => !!(live && typeof live.isLive === 'function' && live.isLive());

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

  /** Load from the live API. Empty + fallbackWhenEmpty → show the sample; any error → sample. */
  async function loadLive({ silent = false } = {}) {
    if (!silent) { state.status = 'loading'; emit(); }
    try {
      const raw = await live.load();
      const empty = raw == null || (Array.isArray(raw) ? raw.length === 0 : Object.keys(raw).length === 0);
      if (empty && live.fallbackWhenEmpty) return loadSample({ silent });
      state.data = empty ? (Array.isArray(raw) ? [] : {}) : parse(raw);
      state.origin = 'live';
      state.fileName = '';
      state.loadedAt = new Date();
      state.status = 'ready';
      state.error = '';
      emit();
    } catch {
      // live fetch/parse failed → fall back to the sample so the tab still renders
      await loadSample({ silent });
    }
  }

  /** Replace with a parsed dataset (from a file). Live → route into the database. */
  async function replace(raw, fileName) {
    if (isLive() && typeof live.onReplace === 'function') {
      const res = await live.onReplace(raw, fileName);   // may throw, or return {ok:false,error}
      if (res && res.ok === false) throw new Error(res.error || 'That import failed.');
      await loadLive();
      return res || { ok: true };
    }
    state.data = parse(raw);          // throws on a bad shape — caller catches
    state.origin = 'upload';
    state.fileName = fileName || '';
    state.loadedAt = new Date();
    state.status = 'ready';
    state.error = '';
    state.persisted = persist(raw, fileName, state.loadedAt);
    emit();
    return { ok: true };
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
    if (isLive()) return loadLive();
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    state.persisted = true;
    await loadSample();
  }

  /** Re-fetch the current source (live or sample). Used after a write. */
  async function reload({ silent = false } = {}) {
    if (isLive()) return loadLive({ silent });
    return loadSample({ silent });
  }

  async function init() {
    if (isLive()) return loadLive();
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

  return { state, subscribe, init, replace, reset, reload, loadSample, isLive, getStored: readStored };
}
