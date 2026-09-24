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

/* Campaigns and AI Insights run on their own sources. In live mode they load from the
   database (campaigns from D1, AI Insights from the enrichment feed); in preview they
   fall back to their sample JSON. They are warmed once the store settles which mode
   we're in (see the store subscription below), so "live but not scored yet" shows the
   real empty state rather than the sample. */

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

/**
 * Ask which sheet to import and whether to merge or replace. Resolves to
 * { sheetName, mode } on confirm, or null if the user cancels.
 */
function importDialog({ sheets, defaultSheetName }) {
  return new Promise((resolve) => {
    let mode = 'merge';
    let sheetName = defaultSheetName;
    const countCache = new Map();
    const countFor = (name) => {
      if (!countCache.has(name)) {
        const sheet = sheets.find((s) => s.name === name);
        let n = 0;
        try { n = normalizeRows(sheet.rows).contacts.length; } catch { n = 0; }
        countCache.set(name, n);
      }
      return countCache.get(name);
    };

    const backdrop = h('div', { class: 'modal-backdrop' });
    const summary = h('p', { class: 'modal-sub' });
    const importLabel = h('span', { text: 'Import' });
    const importBtn = h('button', { class: 'btn btn-primary', type: 'button', style: 'min-width:7rem' },
      [icon('download', 'size-4'), importLabel]);
    const cancelBtn = h('button', { class: 'btn btn-quiet', type: 'button', text: 'Cancel' });

    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    function done(value) {
      backdrop.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => backdrop.remove(), 200);
      resolve(value);
    }
    cancelBtn.addEventListener('click', () => done(null));
    importBtn.addEventListener('click', () => { if (!importBtn.disabled) done({ sheetName, mode }); });
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(null); });

    const updateSummary = () => {
      const n = countFor(sheetName);
      summary.textContent = n
        ? `Ready to import ${formatNumber(n)} contact${n === 1 ? '' : 's'} from “${sheetName}”.`
        : `“${sheetName}” has no rows we recognise as contacts.`;
      importBtn.disabled = !n;
    };

    let sheetSection;
    if (sheets.length > 1) {
      const select = h('select', { class: 'field-input' },
        sheets.map((s) => h('option', {
          value: s.name,
          text: `${s.name} — ${formatNumber(s.rows.length)} rows · ${s.score} columns matched`,
          selected: s.name === sheetName ? '' : null,
        })));
      select.addEventListener('change', () => { sheetName = select.value; updateSummary(); });
      sheetSection = h('div', {}, [h('label', { class: 'modal-label', text: 'Which sheet to import?' }), select]);
    } else {
      sheetSection = h('div', {}, [
        h('label', { class: 'modal-label', text: 'Sheet' }), h('p', { class: 't-body', text: sheetName }),
      ]);
    }

    const modeWrap = h('div', {}, [h('label', { class: 'modal-label', text: 'How should we bring these in?' })]);
    const makeOpt = (value, title, desc) => {
      const radio = h('input', { type: 'radio', name: 'import-mode', value });
      radio.checked = value === mode;
      const cardEl = h('label', { class: `opt-card${value === mode ? ' is-sel' : ''}` }, [
        radio,
        h('div', { class: 'min-w-0' }, [
          h('div', { class: 'opt-title', text: title }), h('div', { class: 'opt-desc', text: desc }),
        ]),
      ]);
      radio.addEventListener('change', () => {
        mode = value;
        for (const c of modeWrap.querySelectorAll('.opt-card')) c.classList.toggle('is-sel', c === cardEl);
        importBtn.classList.toggle('btn-danger', mode === 'replace');
        importBtn.classList.toggle('btn-primary', mode !== 'replace');
        importLabel.textContent = mode === 'replace' ? 'Replace all' : 'Import';
      });
      return cardEl;
    };
    modeWrap.append(h('div', { class: 'flex flex-col gap-2' }, [
      makeOpt('merge', 'Merge into existing contacts',
        'Update people already in the CRM and add new ones. Matches by email, or by name + phone when there’s no email.'),
      makeOpt('replace', 'Replace all contacts',
        'Delete every contact in the CRM first, then import this sheet fresh. This cannot be undone.'),
    ]));

    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Import contacts' }, [
      h('div', { class: 'modal-head' }, [
        h('div', { class: 'modal-title' }, [icon('upload', 'size-[18px]'), 'Import contacts']), summary,
      ]),
      h('div', { class: 'modal-body' }, [sheetSection, modeWrap]),
      h('div', { class: 'modal-foot' }, [cancelBtn, importBtn]),
    ]);
    backdrop.append(modal);
    document.body.append(backdrop);
    document.addEventListener('keydown', onKey);
    refreshIcons(backdrop);
    updateSummary();
    requestAnimationFrame(() => backdrop.classList.add('open'));
  });
}

let busy = false;

async function handleFile(file) {
  if (busy || !file) return;
  if (!store.isLive()) { toast('Connect the database to import — preview mode is read-only.', 'warn'); return; }
  busy = true;
  el.uploadBtn.disabled = true;
  try {
    const { sheets, defaultSheetName } = await parseSpreadsheet(file);
    const choice = await importDialog({ sheets, defaultSheetName });
    if (!choice) return;                                  // cancelled

    const sheet = sheets.find((s) => s.name === choice.sheetName);
    const { contacts } = normalizeRows(sheet.rows);       // map headers → fields, validate
    const res = await store.importContacts(contacts, choice.mode);
    if (!res.ok) { toast(res.error || "We couldn't import that file.", 'error'); return; }
    const verb = res.mode === 'replace' ? 'Replaced with' : 'Imported';
    toast(
      `${verb} “${choice.sheetName}” — ${formatNumber(res.added)} added · ${formatNumber(res.updated)} updated` +
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

let sourcesWarmed = false;
store.subscribe((state) => {
  renderChip(state);
  pushState(state);
  // Once we know whether we're live or in preview, warm the tab sources with the
  // correct mode (only once — the tabs re-init themselves on open if still loading).
  if (!sourcesWarmed && state.status === 'ready') {
    sourcesWarmed = true;
    campaignsSource.init();
    insightsSource.init();
  }
});

mountTabs({ nav: el.nav, view: el.view, initial: 'overview' });
refreshIcons(document);
store.init();
