/**
 * tabs/contacts.js — the contact universe with live filtering.
 *
 * The point of this screen: narrow the base by any dimension and instantly see how
 * that group splits across the pipeline — who's in active conversation, who was
 * contacted but never replied, who's never been reached. Filters + summary stay
 * fixed at the top; only the table scrolls.
 *
 * Everything here is composed from shared pieces: the FilterBar, the DataTable, the
 * DetailDrawer, the chart-card helper, and the Phase 1 data + colour layers.
 */
import { PALETTE, STAGE_ORDER, STAGE_DORMANT, ALL_STAGES } from '../config.js';
import { h, icon, refreshIcons, toast } from '../ui.js';
import { colorOf } from '../colors.js';
import { countBy, formatNumber, formatPercent, tidy } from '../util.js';
import { series } from '../data.js';
import { contactsToCsv } from '../filters.js';
import { createFilterBar } from '../components/filterbar.js';
import { mountDataTable } from '../components/datatable.js';
import { mountGrid } from '../components/grid.js';
import { createChartCard } from '../components/chartcard.js';
import { openDrawer } from '../components/drawer.js';
import { openAskModal } from '../ai/askbox.js';
import { openModal } from '../components/modal.js';
import { needsOutreachIds } from '../ai/priorities.js';
import { exportContactsXlsx, sendListParts, exportSendListXlsx, exportSendListCsv, sendListTsv, copyToClipboard } from '../exports.js';
import { nameCell, chipCell, textCell, dateCell } from '../components/cells.js';
import { segmentedBarOption, donutOption, hbarOption } from '../charts.js';
import { takeContactsPreset } from '../nav.js';
import * as store from '../store.js';

/** Stage-split items covering EVERYONE in the selection, in pipeline order. */
function stageSplitItems(contacts) {
  const counts = countBy(contacts, 'stage');
  // Funnel order, then Hot + Dormant, then any other stage value the data contains.
  const order = [...ALL_STAGES, ...[...counts.keys()].filter((s) => !ALL_STAGES.includes(s))];
  return order
    .filter((name) => counts.get(name))
    .map((name) => ({ name, value: counts.get(name), color: colorOf('stage', name) }));
}

/** Push a single-field change to the database, optimistically. */
async function quickEdit(contact, patch) {
  const res = await store.updateContact(contact.id, patch);
  if (!res.ok) toast(res.error || 'Could not save that change.', 'warn');
}

/** A compact <select> chip for Stage, coloured to match the stage. */
function stageEditor(contact) {
  const sel = h('select', {
    class: 'cell-edit stage-edit', 'aria-label': 'Stage',
    style: `--c:${colorOf('stage', contact.stage)}`,
  }, ALL_STAGES.map((st) => h('option', { value: st, text: st, selected: st === contact.stage ? '' : null })));
  if (!contact.stage) sel.prepend(h('option', { value: '', text: '—', selected: '' }));
  stopBubbling(sel);
  sel.addEventListener('change', () => {
    sel.style.setProperty('--c', colorOf('stage', sel.value));
    quickEdit(contact, { stage: sel.value });
  });
  return sel;
}

/** A compact <select> for the Relationship owner, options drawn from the data. */
function ownerEditor(contact) {
  const owners = new Set(store.getState().contacts.map((c) => tidy(c.relationshipOwner)).filter(Boolean));
  if (contact.relationshipOwner) owners.add(contact.relationshipOwner);
  const sel = h('select', { class: 'cell-edit owner-edit', 'aria-label': 'Relationship owner' }, [
    h('option', { value: '', text: '—', selected: contact.relationshipOwner ? null : '' }),
    ...[...owners].sort((a, b) => a.localeCompare(b)).map((o) =>
      h('option', { value: o, text: o, selected: o === contact.relationshipOwner ? '' : null })),
  ]);
  stopBubbling(sel);
  sel.addEventListener('change', () => quickEdit(contact, { relationshipOwner: sel.value }));
  return sel;
}

/** A date input for Next action date; turns red when overdue. */
function nextDateEditor(contact) {
  const overdue = contact.nextActionAt && contact.nextActionAt < startOfToday();
  const input = h('input', {
    class: `cell-edit date-edit${overdue ? ' is-overdue' : ''}`, type: 'date',
    value: contact.nextActionDate || '', 'aria-label': 'Next action date',
  });
  stopBubbling(input);
  input.addEventListener('change', () => quickEdit(contact, { nextActionDate: input.value }));
  return input;
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/* keep clicks on an inline editor from opening the row's drawer */
function stopBubbling(el) {
  for (const type of ['click', 'mousedown', 'keydown']) el.addEventListener(type, (e) => e.stopPropagation());
}

export function render(container) {
  container.classList.add('tab-panel--fill');
  container.parentElement?.classList.add('view--fill');

  const filterBar = createFilterBar({
    dimensions: [
      { field: 'entityType',        label: 'Type',    icon: 'building-2' },
      { field: 'stage',             label: 'Stage',   icon: 'git-branch' },
      { field: 'country',           label: 'Country', icon: 'globe' },
      { field: 'vehicle',           label: 'Vehicle', icon: 'briefcase' },
      { field: 'source',            label: 'Source',  icon: 'route' },
      { field: 'relationshipOwner', label: 'Owner',   icon: 'user-round' },
      { field: 'tag', label: 'Tag', icon: 'tag',
        options: () => (store.getState().tags || []).map((t) => ({ value: t.name, count: t.count ?? 0, color: t.colour })),
        test: (c, set) => (c.tags || []).some((t) => set.has(t.name)) },
    ],
    toggles: [
      { key: 'whatsappOptIn', label: 'WhatsApp opt-in only', icon: 'message-circle',
        predicate: (c) => c.whatsappOptIn === 'Yes' },
    ],
    onChange: () => refresh(),
  });

  /* summary widgets */
  const split = createChartCard({
    title: 'How this selection splits by stage',
    subtitle: 'Showing all contacts',
    iconName: 'align-horizontal-distribute-center', accent: PALETTE[0], chartClass: 'chart--split',
  });
  const donut = createChartCard({
    title: 'By type', subtitle: 'The current selection.',
    iconName: 'chart-pie', accent: PALETTE[5], chartClass: 'chart--mini-donut',
  });
  const countries = createChartCard({
    title: 'Top countries', subtitle: 'The current selection.',
    iconName: 'globe', accent: PALETTE[2], chartClass: 'chart--mini-hbar',
  });

  const summary = h('div', { class: 'grid grid-cols-1 lg:grid-cols-12 gap-4' }, [
    h('div', { class: 'lg:col-span-6 flex' }, [split.el]),
    h('div', { class: 'lg:col-span-3 flex' }, [donut.el]),
    h('div', { class: 'lg:col-span-3 flex' }, [countries.el]),
  ]);

  /* table */
  const exportBtn = h('button', { class: 'btn btn-quiet', type: 'button', title: 'Export the current list to CSV' }, [icon('download', 'size-4'), h('span', { class: 'hidden lg:inline', text: 'CSV' })]);
  exportBtn.addEventListener('click', exportCsv);
  const excelBtn = h('button', { class: 'btn btn-quiet', type: 'button', title: 'Download as the “Final Output” Excel (re-imports cleanly)' }, [icon('sheet', 'size-4'), h('span', { class: 'hidden md:inline', text: 'Excel' })]);
  excelBtn.addEventListener('click', exportExcel);
  const sendListBtn = h('button', { class: 'btn btn-quiet', type: 'button', title: 'Export a Zoho Campaigns send-list' }, [icon('send', 'size-4'), h('span', { class: 'hidden md:inline', text: 'Send list' })]);
  sendListBtn.addEventListener('click', () => openSendList(exportScope()));
  const tableActions = h('div', { class: 'flex items-center gap-1.5' }, [sendListBtn, excelBtn, exportBtn]);

  const columns = [
    { key: 'fullName', label: 'Name', cellClass: 'col-name dt-name', defaultSortDir: 'asc',
      sortValue: (r) => r.fullName?.toLowerCase(), render: nameCell },
    { key: 'entityType', label: 'Type', cellClass: 'col-type',
      sortValue: (r) => r.entityType, render: (r) => chipCell('entityType', r.entityType) },
    { key: 'designation', label: 'Designation', cellClass: 'col-desig',
      sortValue: (r) => r.designation?.toLowerCase(), render: (r) => textCell(r.designation) },
    { key: 'country', label: 'Country', cellClass: 'col-country',
      sortValue: (r) => r.country?.toLowerCase(), render: (r) => textCell(r.country) },
    { key: 'stage', label: 'Stage', cellClass: 'col-stage',
      sortValue: (r) => { const i = ALL_STAGES.indexOf(r.stage); return i < 0 ? 99 : i; },
      render: (r) => (store.isLive() ? stageEditor(r) : chipCell('stage', r.stage)) },
    { key: 'relationshipOwner', label: 'Owner', cellClass: 'col-owner',
      sortValue: (r) => r.relationshipOwner?.toLowerCase(),
      render: (r) => (store.isLive() ? ownerEditor(r) : textCell(r.relationshipOwner)) },
    { key: 'lastContact', label: 'Last contact', cellClass: 'col-last', defaultSortDir: 'desc',
      sortValue: (r) => r.lastContactAt, render: (r) => dateCell(r.lastContactAt) },
    { key: 'nextActionDate', label: 'Next action', cellClass: 'col-next', defaultSortDir: 'asc',
      sortValue: (r) => r.nextActionAt,
      render: (r) => (store.isLive() ? nextDateEditor(r) : dateCell(r.nextActionAt, { markOverdue: true })) },
  ];

  const tableHost = h('div', { class: 'flex flex-1 min-h-0' });
  const table = mountDataTable(tableHost, {
    columns,
    onRowClick: openDrawer,
    title: 'Contacts',
    subtitle: 'Click anyone to see their full profile.',
    iconName: 'users',
    accent: PALETTE[0],
    actions: tableActions,
    defaultSort: { key: 'lastContact', dir: 'desc' },
    emptyMessage: 'No contacts match these filters.',
    selectable: store.isLive(),
    onSelection: (ids) => { selectedIds = ids; renderBulkBar(); },
  });

  /* saved segments (quick chips) + a "save this view" control */
  const segmentsRow = h('div', { class: 'segments-row' });
  /* bulk-action bar (shown only when rows are selected) */
  const bulkBar = h('div', { class: 'bulk-bar', hidden: true });

  /* ---------- View ⇄ Edit (grid) mode ---------- */
  const MODE_KEY = 'dccrm.contacts.mode';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let mode = 'view';
  try { if (localStorage.getItem(MODE_KEY) === 'edit') mode = 'edit'; } catch { /* ignore */ }

  const uniqVals = (field) =>
    [...new Set(store.getState().contacts.map((c) => tidy(c[field])).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const withBase = (base, field) => { const set = new Set(base); for (const v of uniqVals(field)) set.add(v); return [...set]; };

  /* The 22 editable columns, in the requested order. Enum columns get dropdowns from the
     same option lists the rest of the app uses; dates get date inputs; email is validated. */
  const gridColumns = [
    { key: 'fullName', label: 'Full Name', width: 190, type: 'text', sticky: true, required: true },
    { key: 'organisation', label: 'Organisation', width: 175, type: 'text', datalist: () => uniqVals('organisation') },
    { key: 'entityType', label: 'Entity Type', width: 150, type: 'enum', colorDim: 'entityType', options: () => uniqVals('entityType') },
    { key: 'role', label: 'Role', width: 120, type: 'text' },
    { key: 'designation', label: 'Designation', width: 150, type: 'text' },
    { key: 'email', label: 'Email', width: 210, type: 'email', validate: (v) => (EMAIL_RE.test(v) ? null : 'That doesn’t look like an email address.') },
    { key: 'phone', label: 'Phone', width: 140, type: 'text' },
    { key: 'whatsapp', label: 'WhatsApp', width: 140, type: 'text' },
    { key: 'country', label: 'Country', width: 130, type: 'text', datalist: () => uniqVals('country') },
    { key: 'city', label: 'City', width: 130, type: 'text', datalist: () => uniqVals('city') },
    { key: 'vehicle', label: 'Vehicle', width: 175, type: 'enum', options: () => uniqVals('vehicle') },
    { key: 'stage', label: 'Stage', width: 145, type: 'enum', colorDim: 'stage', options: () => [...ALL_STAGES] },
    { key: 'tier', label: 'Tier', width: 80, type: 'enum', options: () => withBase(['A', 'B', 'C'], 'tier') },
    { key: 'priority', label: 'Priority', width: 105, type: 'enum', options: () => withBase(['High', 'Medium', 'Low'], 'priority') },
    { key: 'referredBy', label: 'Referred By', width: 150, type: 'text', datalist: () => uniqVals('referredBy') },
    { key: 'relationshipOwner', label: 'Relationship Owner', width: 165, type: 'text', datalist: () => uniqVals('relationshipOwner') },
    { key: 'lastContact', label: 'Last Contact', width: 135, type: 'date' },
    { key: 'nextAction', label: 'Next Action', width: 185, type: 'text' },
    { key: 'nextActionDate', label: 'Next Action Date', width: 150, type: 'date' },
    { key: 'source', label: 'Source', width: 150, type: 'text', datalist: () => uniqVals('source') },
    { key: 'signal', label: 'Signal / Tags', width: 160, type: 'text' },
    { key: 'notes', label: 'Notes', width: 260, type: 'text' },
  ];

  const gridHost = h('div', { class: 'flex flex-1 min-h-0 hidden' });
  const grid = mountGrid(gridHost, {
    columns: gridColumns,
    title: 'Contacts — grid edit',
    subtitle: 'Click a cell to edit · Enter / Tab to move · changes save automatically.',
    iconName: 'sheet',
    accent: PALETTE[0],
    onSaveCell: (contact, patch) => store.updateContact(contact.id, patch, { optimistic: false, silent: true }),
    onCreate: (fields) => store.createContact(fields, { silent: true }),
    onDelete: (contact) => store.deleteContact(contact.id, { silent: true }),
  });

  const viewBtn = h('button', { type: 'button', 'aria-pressed': 'true' }, [icon('table-2', 'size-3.5'), h('span', { text: 'View' })]);
  const editBtn = h('button', { type: 'button', 'aria-pressed': 'false' }, [icon('sheet', 'size-3.5'), h('span', { text: 'Edit (grid)' })]);
  viewBtn.addEventListener('click', () => setMode('view'));
  editBtn.addEventListener('click', () => setMode('edit'));
  const modeToggle = h('div', { class: 'mode-toggle' }, [viewBtn, editBtn]);
  const gridHint = h('div', { class: 'grid-hint hidden' }, [
    icon('info', 'size-3.5'),
    h('span', { text: 'Enter / Tab to move · Esc to cancel · Ctrl/⌘+C copy · V paste · D fill down' }),
  ]);
  const askBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => openAskModal() },
    [icon('sparkles', 'size-3.5'), h('span', { text: 'Ask AI' })]);
  const needsBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button', title: 'Select everyone the priorities panel flags', onClick: selectNeedsOutreach },
    [icon('list-checks', 'size-3.5'), h('span', { text: 'Needs outreach' })]);
  const modeBar = h('div', { class: 'flex items-center gap-3 flex-wrap' }, [modeToggle, gridHint, h('div', { class: 'ml-auto flex items-center gap-2' }, [needsBtn, askBtn])]);

  function applyModeDom() {
    if (mode === 'edit' && !store.isLive()) mode = 'view';
    const editing = mode === 'edit';
    viewBtn.setAttribute('aria-pressed', String(!editing));
    editBtn.setAttribute('aria-pressed', String(editing));
    editBtn.disabled = !store.isLive();
    editBtn.title = store.isLive() ? 'Edit contacts in a spreadsheet grid' : 'Connect the database to edit inline';
    summary.classList.toggle('hidden', editing);
    tableHost.classList.toggle('hidden', editing);
    gridHost.classList.toggle('hidden', !editing);
    gridHint.classList.toggle('hidden', !editing);
    if (editing) bulkBar.hidden = true;
  }

  function setMode(next) {
    if (next === 'edit' && !store.isLive()) { toast('Connect the database to edit contacts inline.', 'warn'); return; }
    const leavingEdit = mode === 'edit' && next !== 'edit';
    mode = next;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
    if (leavingEdit) table.clearSelection?.();
    applyModeDom();
    if (leavingEdit && store.isLive()) store.resync();   // flush silent grid edits to every other tab
    refresh();
  }

  container.append(modeBar, filterBar.el, segmentsRow, filterBar.chipsEl, summary, bulkBar, tableHost, gridHost);
  refreshIcons(container);

  let currentState = null;
  let filtered = [];
  let selectedIds = new Set();

  /* ---------- saved segments ---------- */
  function renderSegments() {
    const segs = (currentState && currentState.segments) || [];
    const children = segs.map((seg) => {
      const chip = h('span', { class: 'segment-chip' }, [
        h('button', { class: 'seg-apply', type: 'button', title: 'Apply this saved view',
          onClick: () => { try { filterBar.setSelections(JSON.parse(seg.filtersJson || '{}')); } catch { /* ignore */ } } },
          [icon('bookmark', 'size-3.5'), h('span', { text: seg.name })]),
        store.isLive() ? h('button', { class: 'seg-del', type: 'button', 'aria-label': `Delete ${seg.name}`,
          onClick: async () => { const r = await store.deleteSegment(seg.id); if (!r.ok) toast(r.error || 'Could not delete.', 'warn'); } }, [icon('x', 'size-3')]) : null,
      ]);
      return chip;
    });
    if (store.isLive()) {
      children.push(h('button', { class: 'seg-save', type: 'button', title: 'Save the current filters as a segment',
        onClick: saveSegment }, [icon('bookmark-plus', 'size-3.5'), h('span', { text: 'Save view' })]));
    }
    segmentsRow.replaceChildren(...children);
    segmentsRow.hidden = !children.length;
    refreshIcons(segmentsRow);
  }

  async function saveSegment() {
    if (!filterBar.isActive()) { toast('Set some filters first, then save the view.', 'warn'); return; }
    const name = (prompt('Name this segment:') || '').trim();
    if (!name) return;
    const res = await store.createSegment(name, filterBar.getFilterState());
    if (!res.ok) { toast(res.error || 'Could not save.', 'error'); return; }
    toast(`Saved segment “${name}”.`, 'good');
  }

  /* ---------- bulk actions ---------- */
  async function doBulk(payload, label) {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const res = await store.bulkAction({ ...payload, ids });
    if (!res.ok) { toast(res.error || 'Bulk action failed.', 'error'); return; }
    toast(`${label} — ${formatNumber(res.affected || ids.length)} ${res.affected === 1 ? 'contact' : 'contacts'}.`, 'good');
    table.clearSelection();
  }

  function exportSelected() {
    const rows = (currentState?.contacts || []).filter((c) => selectedIds.has(c.id));
    if (!rows.length) return;
    const blob = new Blob(['﻿' + contactsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `dhamma-contacts-selected-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${formatNumber(rows.length)} selected contacts.`, 'good');
  }

  function renderBulkBar() {
    const n = selectedIds.size;
    bulkBar.hidden = n === 0;
    if (!n) { bulkBar.replaceChildren(); return; }

    const stageSel = h('select', { class: 'field-input bulk-select' }, [h('option', { value: '', text: 'Change stage…' }),
      ...ALL_STAGES.map((s) => h('option', { value: s, text: s }))]);
    stageSel.addEventListener('change', () => { if (stageSel.value) doBulk({ action: 'stage', value: stageSel.value }, `Stage → ${stageSel.value}`); });

    const owners = [...new Set((currentState?.contacts || []).map((c) => tidy(c.relationshipOwner)).filter(Boolean))].sort();
    const ownerSel = h('select', { class: 'field-input bulk-select' }, [h('option', { value: '', text: 'Assign owner…' }),
      ...owners.map((o) => h('option', { value: o, text: o }))]);
    ownerSel.addEventListener('change', () => { if (ownerSel.value) doBulk({ action: 'owner', value: ownerSel.value }, `Owner → ${ownerSel.value}`); });

    const tagInput = h('input', { class: 'field-input bulk-tag', type: 'text', placeholder: 'Add tag…', list: 'bulk-tag-list' });
    const tagList = h('datalist', { id: 'bulk-tag-list' }, (currentState?.tags || []).map((t) => h('option', { value: t.name })));
    const tagGo = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('tag', 'size-3.5'), 'Add']);
    const addTag = () => { const name = tagInput.value.trim(); if (name) { doBulk({ action: 'tag', name }, `Tagged “${name}”`); tagInput.value = ''; } };
    tagGo.addEventListener('click', addTag);
    tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });

    bulkBar.replaceChildren(
      h('span', { class: 'bulk-count' }, [h('b', { text: formatNumber(n) }), ' selected']),
      stageSel, ownerSel,
      h('div', { class: 'flex items-center gap-1' }, [tagInput, tagList, tagGo]),
      h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: exportSelected }, [icon('download', 'size-3.5'), 'Export']),
      h('button', { class: 'btn btn-danger btn-sm', type: 'button', onClick: () => {
        if (confirm(`Delete ${n} selected contact${n === 1 ? '' : 's'}? This cannot be undone.`)) doBulk({ action: 'delete' }, 'Deleted');
      } }, [icon('trash-2', 'size-3.5'), 'Delete']),
      h('button', { class: 'bulk-clear', type: 'button', text: 'Clear', onClick: () => table.clearSelection() }),
    );
    refreshIcons(bulkBar);
  }

  function exportCsv() {
    if (!filtered.length) { toast('Nothing to export with these filters.', 'warn'); return; }
    const csv = contactsToCsv(filtered);
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `dhamma-contacts-${stamp}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${formatNumber(filtered.length)} contacts to CSV.`, 'good');
  }

  /* ---------- Phase 4 exports ---------- */

  /** What an export acts on: the ticked selection if any, else the current filtered view. */
  function exportScope() {
    const all = currentState?.contacts || [];
    if (selectedIds.size) return all.filter((c) => selectedIds.has(c.id));
    return filtered;
  }

  function exportExcel() {
    const rows = exportScope();
    if (!rows.length) { toast('Nothing to export with these filters.', 'warn'); return; }
    try {
      exportContactsXlsx(rows);
      toast(`Exported ${formatNumber(rows.length)} contacts to Excel (Final Output).`, 'good');
    } catch (err) { toast(err.message || 'Could not export.', 'error'); }
  }

  /** Select everyone the priorities panel flags (selection lives in the View table). */
  function selectNeedsOutreach() {
    if (!store.isLive()) { toast('Connect the database to select contacts.', 'warn'); return; }
    if (mode === 'edit') setMode('view');
    const ids = needsOutreachIds(currentState?.contacts || []);
    const present = new Set((filtered || []).map((c) => c.id));
    const pickable = ids.filter((id) => present.has(id));
    if (!pickable.length) {
      toast(ids.length ? 'Those contacts are hidden by the current filters.' : 'Nothing needs outreach right now — you’re on top of it.', ids.length ? 'warn' : 'good');
      return;
    }
    table.selectIds(pickable);
    toast(`Selected ${formatNumber(pickable.length)} who need outreach.`, 'good');
  }

  /** The Zoho send-list dialog: X-of-Y note, a small preview, copy + download. */
  function openSendList(contacts) {
    if (!contacts.length) { toast('Select or filter some contacts first.', 'warn'); return; }
    const { withEmail, total } = sendListParts(contacts);
    const m = openModal({ title: 'Export send list', iconName: 'send', subtitle: 'For Zoho Campaigns — Full Name, Email, Organisation, Stage.' });

    const note = h('p', { class: 'sendlist-note' }, [
      icon('mail', 'size-4'),
      h('span', { html: `<b>${formatNumber(withEmail.length)}</b> of ${formatNumber(total)} have an email address${withEmail.length < total ? ' — the rest are skipped' : ''}.` }),
    ]);
    let previewEl;
    if (withEmail.length) {
      const rows = withEmail.slice(0, 8).map((c) => h('tr', {}, [
        h('td', { text: c.fullName || '—' }), h('td', { text: c.email }),
      ]));
      previewEl = h('div', { class: 'sendlist-prev' }, [
        h('table', { class: 'ask-table' }, [
          h('thead', {}, [h('tr', {}, [h('th', { text: 'Full Name' }), h('th', { text: 'Email' })])]),
          h('tbody', {}, rows),
        ]),
        withEmail.length > 8 ? h('p', { class: 't-caption mt-1', text: `…and ${formatNumber(withEmail.length - 8)} more.` }) : null,
      ]);
    } else {
      previewEl = h('p', { class: 't-caption', text: 'None of these contacts has an email address, so there is nothing to send.' });
    }

    const copyBtn = h('button', { class: 'btn btn-primary', type: 'button' }, [icon('clipboard-copy', 'size-4'), h('span', { text: 'Copy to clipboard' })]);
    const xlsxBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, [icon('sheet', 'size-4'), h('span', { text: '.xlsx' })]);
    const csvBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, [icon('download', 'size-4'), h('span', { text: '.csv' })]);
    copyBtn.addEventListener('click', async () => {
      const okc = await copyToClipboard(sendListTsv(contacts));
      toast(okc ? `Copied ${formatNumber(withEmail.length)} contacts — paste into Zoho or a sheet.` : 'Could not copy to clipboard.', okc ? 'good' : 'warn');
    });
    xlsxBtn.addEventListener('click', () => { try { exportSendListXlsx(contacts); toast(`Downloaded ${formatNumber(withEmail.length)} contacts.`, 'good'); } catch (err) { toast(err.message || 'Could not export.', 'error'); } });
    csvBtn.addEventListener('click', () => { exportSendListCsv(contacts); toast(`Downloaded ${formatNumber(withEmail.length)} contacts.`, 'good'); });
    if (!withEmail.length) { copyBtn.disabled = xlsxBtn.disabled = csvBtn.disabled = true; }

    m.body.replaceChildren(note, previewEl);
    m.foot.replaceChildren(h('button', { class: 'btn btn-quiet', type: 'button', text: 'Close', onClick: m.close }), csvBtn, xlsxBtn, copyBtn);
    m.refresh();
  }

  /** Re-apply the filters to the current data and redraw everything. */
  function refresh() {
    if (!currentState || currentState.status !== 'ready') return;
    renderSegments();
    const base = currentState.visible;              // already respects the global search
    filtered = filterBar.apply(base);

    // Edit (grid) mode: the same filtered set, editable. Per-cell saves don't re-enter
    // here (they're silent), so the grid is only rebuilt on a real filter/search change.
    if (mode === 'edit' && store.isLive()) { grid.setRows(filtered); return; }

    const total = currentState.contacts.length;
    split.setSubtitle(`Showing ${formatNumber(filtered.length)} of ${formatNumber(total)} contacts`);

    if (!filtered.length) {
      const msg = 'No contacts match these filters.';
      split.setState('empty', { message: msg });
      donut.setState('empty', { message: msg });
      countries.setState('empty', { message: msg });
      table.setRows([]);
      return;
    }

    /* stage split — the centrepiece */
    const splitItems = stageSplitItems(filtered);
    split.draw(segmentedBarOption(splitItems), splitItems, { segmented: true, showShare: true, valueLabel: 'people' });

    /* reactive donut + countries */
    const byType = series(filtered, 'entityType', { foldOther: true });
    donut.draw(donutOption(byType.data, { centerValue: formatNumber(filtered.length), centerLabel: 'selected' }), byType.data, { showShare: true, valueLabel: 'Investors' });

    const byCountry = series(filtered, 'country', { limit: 7 });
    countries.draw(hbarOption(byCountry.data, { valueLabel: 'People' }), byCountry.data, { valueLabel: 'People', showLegendValue: false });
    countries.note(byCountry.hiddenCount ? `+${byCountry.hiddenCount} more ${byCountry.hiddenCount === 1 ? 'country' : 'countries'}` : '');

    /* table */
    table.setRows(filtered);
  }

  function update(state) {
    currentState = state;
    if (state.status === 'loading') {
      split.setState('loading'); donut.setState('loading'); countries.setState('loading');
      table.setState('loading');
      return;
    }
    if (state.status === 'error') {
      split.setState('error', { message: state.error });
      donut.setState('error', { message: state.error });
      countries.setState('error', { message: state.error });
      table.setState('error', { message: state.error });
      return;
    }
    filterBar.setData(state.contacts);
    const preset = takeContactsPreset();
    if (preset) filterBar.setSelections(preset);   // arrives from a cross-tab jump
    applyModeDom();
    refresh();
  }

  return {
    update,
    destroy() {
      container.parentElement?.classList.remove('view--fill');
      split.destroy(); donut.destroy(); countries.destroy();
      table.destroy(); grid.destroy();
    },
  };
}
