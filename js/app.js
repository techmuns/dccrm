/**
 * app.js — start-up and the header controls.
 *
 * Wires the header (search, upload, data status) to the store, registers the tabs,
 * and lets the router take it from there. Adding a tab later means one import and
 * one registerTab call in this file.
 */
import { TABS } from './config.js';
import * as store from './store.js';
import { registerTab, mountTabs, pushState } from './router.js';
import { render as renderOverview } from './tabs/overview.js';
import { render as renderContacts } from './tabs/contacts.js';
import { render as renderFollowups } from './tabs/followups.js';
import { render as renderCampaigns } from './tabs/campaigns.js';
import { render as renderInsights } from './tabs/insights.js';
import { campaignsSource } from './campaigns.js';
import { insightsSource } from './ai-insights.js';
import { parseSpreadsheet } from './upload.js';
import { normalizeRows } from './data.js';
import { openNewContact } from './components/drawer.js';
import { h, icon, refreshIcons, toast } from './ui.js';
import { debounce, formatDate, formatNumber } from './util.js';

const el = {
  search: document.getElementById('search-input'),
  uploadBtn: document.getElementById('upload-btn'),
  fileInput: document.getElementById('file-input'),
  chip: document.getElementById('data-chip'),
  nav: document.getElementById('tab-nav'),
  view: document.querySelector('#view > div'),
  drop: document.getElementById('drop-overlay'),
  addBtn: document.getElementById('add-btn'),
  exportBtn: document.getElementById('export-btn'),
  previewBanner: document.getElementById('preview-banner'),
};

/* ---------- tabs ---------- */

registerTab('overview', { render: renderOverview });
registerTab('contacts', { render: renderContacts });
registerTab('followups', { render: renderFollowups });
registerTab('campaigns', { render: renderCampaigns });
registerTab('insights', { render: renderInsights });

/* Campaigns and AI Insights run on their own sample sources (a live feed replaces
   them later); warm them at boot so a tab opens with data already in hand. */
campaignsSource.init();
insightsSource.init();

/* ---------- data status chip ---------- */

function renderChip(state) {
  el.chip.replaceChildren();
  const preview = state.mode === 'preview';
  const ready = state.status === 'ready';

  // preview mode: show the banner, turn off the write controls
  el.previewBanner.hidden = !(preview && ready);
  el.addBtn.disabled = preview;
  el.uploadBtn.style.display = preview ? 'none' : '';
  el.exportBtn.style.display = preview ? 'none' : '';
  refreshIcons(el.previewBanner);

  if (state.status === 'loading') {
    el.chip.append(h('span', { class: 'chip chip--sample' }, [
      icon('loader-circle', 'size-3.5 animate-spin'), h('span', { text: 'Connecting…' }),
    ]));
  } else if (state.status === 'error') {
    el.chip.append(h('span', { class: 'chip chip--warn' }, [
      icon('triangle-alert', 'size-3.5'), h('span', { text: "Couldn't load contacts" }),
    ]));
  } else if (preview) {
    el.chip.append(h('span', { class: 'chip chip--warn' }, [
      icon('database', 'size-3.5'),
      h('span', { text: 'Preview mode' }),
      h('span', { class: 'hidden sm:inline', text: '· sample data, read-only' }),
    ]));
  } else {
    el.chip.append(h('span', { class: 'chip chip--upload' }, [
      icon('database', 'size-3.5'),
      h('span', { text: 'Live database' }),
      h('span', { class: 'hidden sm:inline', text: `· ${formatNumber(state.contacts.length)} contacts` }),
    ]));
    el.chip.append(h('span', { class: 'chip chip--user', title: state.user === 'Team' ? 'Turn on Cloudflare Access to sign in your team' : `Signed in as ${state.user}` }, [
      icon('user-round', 'size-3.5'),
      h('span', { class: 'hidden md:inline', text: 'Signed in as ' }),
      h('span', { class: 'chip-name', text: state.user }),
    ]));
  }
  refreshIcons(el.chip);
}

/* ---------- upload ---------- */

let busy = false;

async function handleFile(file) {
  if (busy || !file) return;
  if (!store.isLive()) { toast('Connect the database to import — preview mode is read-only.', 'warn'); return; }
  busy = true;
  el.uploadBtn.disabled = true;
  try {
    const { rows, sheetName } = await parseSpreadsheet(file);
    const { contacts } = normalizeRows(rows);            // map headers → fields, validate
    const res = await store.importContacts(contacts);
    if (!res.ok) { toast(res.error || "We couldn't import that file.", 'error'); return; }
    toast(
      `Imported “${sheetName}” — ${formatNumber(res.added)} added · ${formatNumber(res.updated)} updated` +
      (res.skipped ? ` · ${formatNumber(res.skipped)} skipped` : '') + '.',
      'good',
    );
  } catch (err) {
    toast(err.message || "We couldn't read that file.", 'error');
  } finally {
    busy = false;
    el.uploadBtn.disabled = false;
    el.fileInput.value = '';
  }
}

el.uploadBtn.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', (event) => handleFile(event.target.files?.[0]));

el.addBtn.addEventListener('click', () => {
  if (store.isLive()) openNewContact();
  else toast('Connect the database to add contacts.', 'warn');
});

/* drag a sheet anywhere onto the page */
let dragDepth = 0;
const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');

window.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  dragDepth += 1;
  el.drop.classList.add('is-active');
});
window.addEventListener('dragover', (event) => { if (hasFiles(event)) event.preventDefault(); });
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el.drop.classList.remove('is-active');
});
window.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  el.drop.classList.remove('is-active');
  handleFile(event.dataTransfer.files?.[0]);
});

/* ---------- search ---------- */

const clearButton = h('button', {
  class: 'search-clear hidden', type: 'button', 'aria-label': 'Clear search',
  onClick: () => { el.search.value = ''; store.setQuery(''); el.search.focus(); },
}, [icon('x', 'size-3.5')]);
el.search.parentElement.append(clearButton);

const pushQuery = debounce((value) => store.setQuery(value), 160);
el.search.addEventListener('input', (event) => {
  clearButton.classList.toggle('hidden', !event.target.value);
  pushQuery(event.target.value);
});
el.search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { el.search.value = ''; clearButton.classList.add('hidden'); store.setQuery(''); }
});

/* "/" focuses search, the way every tool the team already uses does */
window.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  event.preventDefault();
  el.search.focus();
  el.search.select();
});

/* ---------- go ---------- */

store.subscribe((state) => {
  renderChip(state);
  pushState(state);
});

mountTabs({ nav: el.nav, view: el.view, initial: 'overview' });
refreshIcons(document);
store.init();
