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
import { comingSoon } from './tabs/coming-soon.js';
import { parseSpreadsheet } from './upload.js';
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
};

/* ---------- tabs ---------- */

registerTab('overview', { render: renderOverview });
registerTab('contacts', { render: renderContacts });
registerTab('followups', { render: renderFollowups });

const SOON = {
  campaigns: {
    blurb: 'Outreach you have sent, who opened it, and which conversations it started.',
    bullets: ['Email and WhatsApp', 'Who replied', 'What worked'],
  },
  insights: {
    blurb: 'Quiet patterns worth knowing — relationships going cold, types of investor converting best.',
    bullets: ['Going-cold alerts', 'What converts', 'Suggested next steps'],
  },
};

for (const tab of TABS) {
  if (tab.ready) continue;
  registerTab(tab.id, comingSoon({
    label: `${tab.label} is coming next`,
    iconName: tab.icon,
    blurb: SOON[tab.id]?.blurb || '',
    bullets: SOON[tab.id]?.bullets || [],
  }));
}

/* ---------- data status chip ---------- */

function renderChip(state) {
  el.chip.replaceChildren();
  if (state.status === 'loading') {
    el.chip.append(h('span', { class: 'chip chip--sample' }, [
      icon('loader-circle', 'size-3.5 animate-spin'), h('span', { text: 'Loading data…' }),
    ]));
  } else if (state.status === 'error') {
    el.chip.append(h('span', { class: 'chip chip--warn' }, [
      icon('triangle-alert', 'size-3.5'), h('span', { text: 'No data loaded' }),
    ]));
  } else if (state.source === 'upload') {
    el.chip.append(h('span', { class: 'chip chip--upload' }, [
      icon('file-spreadsheet', 'size-3.5'),
      h('span', { text: 'Data: your upload' }),
      h('span', { class: 'chip-name', text: `· ${state.fileName}` }),
      h('span', { text: `· ${formatDate(state.loadedAt)}` }),
      h('button', {
        class: 'chip-action', type: 'button', text: 'Reset to sample',
        onClick: async () => {
          if (!confirm('Go back to the sample data? Your uploaded sheet will be removed from this browser.')) return;
          await store.resetToSample();
          toast('Back on the sample data.', 'good');
        },
      }),
    ]));
    if (!state.persisted) {
      el.chip.append(h('span', { class: 'chip chip--warn ml-2', title: 'This browser could not store a sheet that large.' }, [
        icon('info', 'size-3.5'), h('span', { text: "Too big to remember — you'll need to upload again after a refresh" }),
      ]));
    }
  } else {
    el.chip.append(h('span', { class: 'chip chip--sample' }, [
      icon('sparkles', 'size-3.5'),
      h('span', { text: 'Data: sample' }),
      h('span', { class: 'hidden sm:inline', text: `· ${formatNumber(state.contacts.length)} example contacts` }),
    ]));
  }
  refreshIcons(el.chip);
}

/* ---------- upload ---------- */

let busy = false;

async function handleFile(file) {
  if (busy || !file) return;
  busy = true;
  el.uploadBtn.disabled = true;
  try {
    const { rows, sheetName, matchedColumns } = await parseSpreadsheet(file);
    store.adoptUpload(rows, file.name);
    const loaded = store.getState().contacts.length;
    toast(
      `Loaded ${formatNumber(loaded)} contacts from “${sheetName}” — ${matchedColumns} columns matched.`,
      'good',
    );
    const notice = store.getState().notice;
    if (notice) toast(notice, 'warn');
  } catch (err) {
    // The previous data stays on screen; only the message changes.
    toast(err.message || "We couldn't read that file.", 'error');
  } finally {
    busy = false;
    el.uploadBtn.disabled = false;
    el.fileInput.value = '';
  }
}

el.uploadBtn.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', (event) => handleFile(event.target.files?.[0]));

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
