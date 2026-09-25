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
  user: 'Team',
  tags: [],        // all tags {id,name,colour,count}
  segments: [],    // saved filter sets {id,name,filtersJson}
  aiMeta: null,    // { analyzedAt, count, scored, withReplies } from the last insights fetch
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
    await loadAux();
  } catch {
    await loadSampleFallback();
  }
  emit();
}

/** Load tags + saved segments (live only). */
async function loadAux() {
  try {
    const [tagsRes, segRes] = await Promise.all([api('/api/tags'), api('/api/segments')]);
    state.tags = tagsRes.tags || [];
    state.segments = segRes.segments || [];
  } catch { /* non-fatal */ }
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
  state.user = data.user || 'Team';
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

export async function createContact(fields, { silent = false } = {}) {
  if (!isLive()) return PREVIEW;
  try {
    const { contact } = await api('/api/contacts', { method: 'POST', body: JSON.stringify(fields) });
    const normalised = normalizeContact(contact);
    ensureColours(normalised);
    state.contacts.unshift(normalised);
    state.total += 1;
    recomputeVisible();
    if (!silent) emit();   // silent: the caller (grid) updates its own DOM without a full re-render
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
export async function updateContact(id, patch, { optimistic = true, silent = false, source = 'Manual' } = {}) {
  if (!isLive()) return PREVIEW;
  const index = state.contacts.findIndex((c) => c.id === id);
  const previous = index >= 0 ? state.contacts[index] : null;

  if (optimistic && previous) {
    const merged = normalizeContact({ ...toFieldObject(previous), ...patch, id, updatedAt: new Date().toISOString() });
    ensureColours(merged);
    state.contacts[index] = merged;
    recomputeVisible();
    if (!silent) emit();
  }

  try {
    // `x-change-source` tags any resulting stage-change activity with where the edit came
    // from (Grid edit / Prompt box / Manual). The move itself is detected + logged server-
    // side (in the contacts PUT), so it is recorded no matter how a caller mutates its copy.
    const { contact } = await api(`/api/contacts/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-change-source': source || 'Manual' },
      body: JSON.stringify(patch),
    });
    const confirmed = normalizeContact(contact);
    ensureColours(confirmed);
    const at = state.contacts.findIndex((c) => c.id === id);
    if (at >= 0) state.contacts[at] = confirmed;
    recomputeVisible();
    if (!silent) emit();     // silent: the grid patches only the edited row, no full re-render
    return { ok: true, contact: confirmed };
  } catch (err) {
    if (optimistic && previous) {           // roll back
      const at = state.contacts.findIndex((c) => c.id === id);
      if (at >= 0) state.contacts[at] = previous;
      recomputeVisible();
      if (!silent) emit();
    }
    return { ok: false, error: err.message };
  }
}

export async function deleteContact(id, { silent = false } = {}) {
  if (!isLive()) return PREVIEW;
  try {
    await api(`/api/contacts/${id}`, { method: 'DELETE' });
    state.contacts = state.contacts.filter((c) => c.id !== id);
    state.total = Math.max(0, state.total - 1);
    recomputeVisible();
    if (!silent) emit();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Recompute the search view and notify subscribers — call once after a run of silent
 *  writes (e.g. leaving the grid edit session) so every tab catches up in one paint. */
export function resync() { recomputeVisible(); emit(); }

export async function getContactDetail(id) {
  if (!isLive()) return { ok: false, preview: true, activities: [] };
  try {
    const data = await api(`/api/contacts/${id}`);
    return { ok: true, contact: normalizeContact(data.contact), activities: data.activities || [], tasks: data.tasks || [], tags: data.tags || [], replies: data.replies || [] };
  } catch (err) {
    return { ok: false, error: err.message, activities: [], replies: [] };
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

/**
 * Bulk import. `rows` are already field-shaped (mapped from a sheet).
 * mode 'merge' (default) updates/adds; 'replace' wipes the CRM first.
 */
export async function importContacts(rows, mode = 'merge') {
  if (!isLive()) return PREVIEW;
  try {
    const result = await api('/api/import', { method: 'POST', body: JSON.stringify({ contacts: rows, mode }) });
    await reload();
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export const exportUrl = () => '/api/export';

/* ---------- tasks ---------- */
export async function listTasks(params = '') {
  if (!isLive()) return { ok: false, tasks: [] };
  try { const d = await api(`/api/tasks${params}`); return { ok: true, tasks: d.tasks || [] }; }
  catch (err) { return { ok: false, error: err.message, tasks: [] }; }
}
export async function createTask(task) {
  if (!isLive()) return PREVIEW;
  try { const d = await api('/api/tasks', { method: 'POST', body: JSON.stringify(task) }); return { ok: true, task: d.task }; }
  catch (err) { return { ok: false, error: err.message }; }
}
export async function updateTask(id, patch) {
  if (!isLive()) return PREVIEW;
  try { const d = await api(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }); return { ok: true, task: d.task }; }
  catch (err) { return { ok: false, error: err.message }; }
}
export async function deleteTask(id) {
  if (!isLive()) return PREVIEW;
  try { await api(`/api/tasks/${id}`, { method: 'DELETE' }); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
}

/* ---------- tags ---------- */
async function refreshTags() { try { state.tags = (await api('/api/tags')).tags || []; } catch { /* ignore */ } }

export async function createTag(name, colour) {
  if (!isLive()) return PREVIEW;
  try { const d = await api('/api/tags', { method: 'POST', body: JSON.stringify({ name, colour }) }); await refreshTags(); emit(); return { ok: true, tag: d.tag }; }
  catch (err) { return { ok: false, error: err.message }; }
}
export async function deleteTag(id) {
  if (!isLive()) return PREVIEW;
  try {
    await api(`/api/tags/${id}`, { method: 'DELETE' });
    for (const c of state.contacts) c.tags = (c.tags || []).filter((t) => t.id !== id);
    await refreshTags();
    recomputeVisible(); emit();
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}
/** Add a tag to one contact (by id or new name); updates local state. */
export async function addTagToContact(contactId, { tagId, name } = {}) {
  if (!isLive()) return PREVIEW;
  try {
    const d = await api(`/api/contacts/${contactId}/tags`, { method: 'POST', body: JSON.stringify({ tagId, name }) });
    const c = state.contacts.find((x) => x.id === contactId);
    if (c) { c.tags = c.tags || []; if (!c.tags.some((t) => t.id === d.tag.id)) c.tags.push(d.tag); }
    await refreshTags();
    recomputeVisible(); emit();
    return { ok: true, tag: d.tag };
  } catch (err) { return { ok: false, error: err.message }; }
}
export async function removeTagFromContact(contactId, tagId) {
  if (!isLive()) return PREVIEW;
  try {
    await api(`/api/contacts/${contactId}/tags?tagId=${tagId}`, { method: 'DELETE' });
    const c = state.contacts.find((x) => x.id === contactId);
    if (c) c.tags = (c.tags || []).filter((t) => t.id !== tagId);
    await refreshTags();
    recomputeVisible(); emit();
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

/* ---------- segments ---------- */
export async function createSegment(name, filters) {
  if (!isLive()) return PREVIEW;
  try { const d = await api('/api/segments', { method: 'POST', body: JSON.stringify({ name, filters }) }); state.segments.unshift(d.segment); emit(); return { ok: true, segment: d.segment }; }
  catch (err) { return { ok: false, error: err.message }; }
}
export async function deleteSegment(id) {
  if (!isLive()) return PREVIEW;
  try { await api(`/api/segments/${id}`, { method: 'DELETE' }); state.segments = state.segments.filter((s2) => s2.id !== id); emit(); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
}

/* ---------- bulk ---------- */
export async function bulkAction(payload) {
  if (!isLive()) return PREVIEW;
  try { const d = await api('/api/bulk', { method: 'POST', body: JSON.stringify(payload) }); await reload(); await loadAux(); emit(); return { ok: true, ...d }; }
  catch (err) { return { ok: false, error: err.message }; }
}


/* ---------- AI relationship enrichment (Feature 1) ---------- */

/** Score ONE contact on demand (direct Bedrock call); update local state. */
export async function enrichContact(id) {
  if (!isLive()) return PREVIEW;
  try {
    const d = await api(`/api/contacts/${id}/enrich`, { method: 'POST' });
    const confirmed = normalizeContact(d.contact);
    ensureColours(confirmed);
    const at = state.contacts.findIndex((c) => c.id === id);
    if (at >= 0) state.contacts[at] = confirmed;
    recomputeVisible(); emit();
    return { ok: true, contact: confirmed, ai: d.ai };
  } catch (err) { return { ok: false, error: err.message, code: err.code }; }
}

/** Kick off the BULK enrichment run on GitHub Actions (patient, no Worker timeout). */
export async function refreshAllAi(scope = 'all') {
  if (!isLive()) return PREVIEW;
  try { const d = await api('/api/ai/refresh-all', { method: 'POST', body: JSON.stringify({ scope }) }); return { ok: true, ...d }; }
  catch (err) { return { ok: false, error: err.message, code: err.code }; }
}

/** The AI Insights feed (enrichment + latest replies), keyed by email. Caches meta. */
export async function getInsights() {
  if (!isLive()) return { insights: {}, analyzedAt: null };
  try {
    const d = await api('/api/insights');
    state.aiMeta = { analyzedAt: d.analyzedAt, count: d.count, scored: d.scored, withReplies: d.withReplies };
    return d;
  } catch { return { insights: {}, analyzedAt: null }; }
}

/** Analysed email replies (Feature 2). qs e.g. '?contactId=5' or '?needsResponse=1'. */
export async function listReplies(qs = '') {
  if (!isLive()) return { replies: [] };
  try { return await api(`/api/replies${qs}`); }
  catch (err) { return { replies: [], error: err.message }; }
}

/* ---------- Phase 3 — prompt intelligence (input · read · output) ---------- */

/** "Update with AI": send pasted notes, get back a validated preview list. Writes nothing. */
export async function aiUpdate(text, hint = '') {
  if (!isLive()) return PREVIEW;
  try { const d = await api('/api/ai/update', { method: 'POST', body: JSON.stringify({ text, hint }) }); return { ok: true, ...d }; }
  catch (err) { return { ok: false, error: err.message, code: err.code }; }
}

/** "Ask": plain-English question → { answer, contactIds, columns }, grounded in the real book. */
export async function aiAsk(question) {
  if (!isLive()) return PREVIEW;
  try { const d = await api('/api/ai/ask', { method: 'POST', body: JSON.stringify({ question }) }); return { ok: true, ...d }; }
  catch (err) { return { ok: false, error: err.message, code: err.code }; }
}

/** Draft an outreach message for one contact (editable, never sent anywhere). */
export async function draftMessage(id, intent, channel) {
  if (!isLive()) return PREVIEW;
  try { const d = await api(`/api/contacts/${id}/draft`, { method: 'POST', body: JSON.stringify({ intent, channel }) }); return { ok: true, ...d }; }
  catch (err) { return { ok: false, error: err.message, code: err.code }; }
}

/** Optional AI "why now" lines for the priorities panel. Returns { whys:{} } on any failure. */
export async function aiWhy(items) {
  if (!isLive()) return { whys: {} };
  try { return await api('/api/ai/why', { method: 'POST', body: JSON.stringify({ items }) }); }
  catch { return { whys: {} }; }
}

/* ---------- campaigns (Feature 3) ---------- */
export async function listCampaigns() {
  if (!isLive()) return [];
  try { const d = await api('/api/campaigns'); return d.campaigns || []; }
  catch { return []; }
}
export async function importCampaigns(rows) {
  if (!isLive()) return { ok: false, error: 'Connect the database to import campaigns.' };
  try { const d = await api('/api/campaigns/import', { method: 'POST', body: JSON.stringify({ campaigns: rows }) }); return { ok: true, ...d }; }
  catch (err) { return { ok: false, error: err.message }; }
}
export async function deleteCampaign(id) {
  if (!isLive()) return PREVIEW;
  try { await api(`/api/campaigns/${id}`, { method: 'DELETE' }); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
}

/* Keep only the writable/id fields when turning a normalised contact back into a
   plain payload for an optimistic re-normalise. */
function toFieldObject(contact) {
  const out = { id: contact.id };
  for (const key of ['fullName', 'entityType', 'role', 'organisation', 'designation', 'email', 'phone', 'altPhone',
    'whatsapp', 'whatsappOptIn', 'country', 'city', 'vehicle', 'stage', 'tier', 'priority', 'referredBy',
    'lastContact', 'nextAction', 'nextActionDate', 'relationshipOwner', 'source', 'signal', 'notes', 'roughNotes',
    // carry AI + tags so an optimistic inline edit doesn't momentarily drop them
    'aiScore', 'aiBand', 'aiSummary', 'aiNextStep', 'aiAnalyzedAt', 'aiModel']) {
    out[key] = contact[key];
  }
  out.tags = contact.tags;
  return out;
}
