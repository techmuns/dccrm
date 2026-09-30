/**
 * tabs/contacts.js — Investors: the contact universe with live filtering.
 *
 * The point of this screen: narrow the base by any dimension and instantly see the
 * matching people — who's in active conversation, who was contacted but never replied,
 * who's never been reached. Filters stay fixed at the top; only the table scrolls.
 *
 * A section toggle folds the old Follow-ups tab in here (dashboard simplification): the
 * reminders hub renders unchanged in its own section, and a "Follow-ups due" filter narrows
 * the investor list itself. No charts or stats live here — analytics belong to Overview,
 * which is their single home; this screen is purely the list + the follow-ups hub.
 *
 * Everything here is composed from shared pieces: the FilterBar, the DataTable, the
 * DetailDrawer, the follow-ups view, and the Phase 1 data + colour layers.
 */
import { PALETTE, ALL_STAGES, HEAT_VALUES, CLOSED_LABELS } from '../config.js';
import { h, icon, refreshIcons, toast } from '../ui.js';
import { formatNumber, tidy, daysFromToday } from '../util.js';
import { isClosed } from '../data.js';
import { contactsToCsv } from '../filters.js';
import { createFilterBar } from '../components/filterbar.js';
import { mountDataTable } from '../components/datatable.js';
import { mountGrid } from '../components/grid.js';
import { openDrawer } from '../components/drawer.js';
import { openTimeline } from '../components/timeline.js';
import { openAskModal } from '../ai/askbox.js';
import { openModal } from '../components/modal.js';
import { needsOutreachIds } from '../ai/priorities.js';
import { exportContactsXlsx, sendListParts, exportSendListXlsx, exportSendListCsv, sendListTsv, copyToClipboard } from '../exports.js';
import { nameCell, chipCell, textCell, dateCell } from '../components/cells.js';
import { takeContactsPreset, goToCompose, takeInvestorsView } from '../nav.js';
import { render as renderFollowups } from './followups.js';
import * as store from '../store.js';

/* The View table is READ-ONLY. Each field is edited in exactly one place: click a row to open
   the profile (single-contact edits), or switch to Edit (grid) for spreadsheet / bulk edits.
   This removes the scattered inline row editors so there's no confusion over where Stage
   (and every other field) actually changes. */

/** The Stage cell: a Closed chip for closed records, else a read-only stage chip, with a
 *  small Dormant badge appended when the record is parked. Click the row to edit. */
function stageCell(contact) {
  if (isClosed(contact)) {
    return h('span', { class: 'closed-chip', title: 'Closed — open the profile to reopen' },
      [icon('circle-slash', 'size-3'), h('span', { text: CLOSED_LABELS[contact.closedStatus] || 'Closed' })]);
  }
  const el = chipCell('stage', contact.stage);
  if (!contact.dormant) return el;
  return h('div', { class: 'stage-cell' }, [el, h('span', { class: 'dormant-badge', title: 'Dormant', text: 'Zzz' })]);
}

/** A small row-action button that opens the contact's timeline (without opening the drawer). */
function timelineAction(contact) {
  const btn = h('button', { class: 'row-action', type: 'button', title: 'View timeline',
    'aria-label': `View timeline for ${contact.fullName || 'contact'}` }, [icon('history', 'size-4')]);
  // Keep a click / Enter on the action from ALSO opening the row's drawer, but let other keys
  // (notably Escape, which closes the timeline modal) bubble normally.
  btn.addEventListener('mousedown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => { e.stopPropagation(); openTimeline(contact); });
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
  return btn;
}

export function render(container) {
  container.classList.add('tab-panel--fill');
  container.parentElement?.classList.add('view--fill');

  const filterBar = createFilterBar({
    dimensions: [
      { field: 'entityType',        label: 'Type',    icon: 'building-2' },
      { field: 'stage',             label: 'Stage',   icon: 'git-branch' },
      { field: 'heat',              label: 'Heat',    icon: 'flame' },
      { field: 'country',           label: 'Country', icon: 'globe' },
      { field: 'vehicle',           label: 'Vehicle', icon: 'briefcase' },
      { field: 'source',            label: 'Source',  icon: 'route' },
      { field: 'relationshipOwner', label: 'Owner',   icon: 'user-round' },
      { field: 'tag', label: 'Tag', icon: 'tag',
        options: () => (store.getState().tags || []).map((t) => ({ value: t.name, count: t.count ?? 0, color: t.colour })),
        test: (c, set) => (c.tags || []).some((t) => set.has(t.name)) },
    ],
    toggles: [
      { key: 'fudue', label: 'Follow-ups due', icon: 'calendar-clock',
        predicate: (c) => !isClosed(c) && !c.dormant && daysFromToday(c.nextActionAt) != null && daysFromToday(c.nextActionAt) <= 7 },
      { key: 'dormant', label: 'Dormant only', icon: 'moon', predicate: (c) => !!c.dormant },
      { key: 'hideTopups', label: 'Hide top-ups', icon: 'copy-minus', predicate: (c) => !c.isTopUp },
      { key: 'whatsappOptIn', label: 'WhatsApp opt-in only', icon: 'message-circle',
        predicate: (c) => c.whatsappOptIn === 'Yes' },
    ],
    onChange: () => refresh(),
  });

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
      render: (r) => stageCell(r) },
    { key: 'heat', label: 'Heat', cellClass: 'col-heat',
      sortValue: (r) => { const i = HEAT_VALUES.indexOf(r.heat); return i < 0 ? 9 : i; },
      render: (r) => chipCell('heat', r.heat) },
    { key: 'relationshipOwner', label: 'Owner', cellClass: 'col-owner',
      sortValue: (r) => r.relationshipOwner?.toLowerCase(),
      render: (r) => textCell(r.relationshipOwner) },
    { key: 'lastContact', label: 'Last contact', cellClass: 'col-last', defaultSortDir: 'desc',
      sortValue: (r) => r.lastContactAt, render: (r) => dateCell(r.lastContactAt) },
    { key: 'nextActionDate', label: 'Next action', cellClass: 'col-next', defaultSortDir: 'asc',
      sortValue: (r) => r.nextActionAt,
      render: (r) => dateCell(r.nextActionAt, { markOverdue: true }) },
    { key: '_timeline', label: '', cellClass: 'col-actions', sortable: false, render: timelineAction },
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
    { key: 'heat', label: 'Heat', width: 110, type: 'enum', colorDim: 'heat', options: () => [...HEAT_VALUES] },
    { key: 'dormant', label: 'Dormant', width: 95, type: 'bool' },
    { key: 'closedStatus', label: 'Closed', width: 130, type: 'closed' },
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
    onSaveCell: (contact, patch) => store.updateContact(contact.id, patch, { optimistic: false, silent: true, source: 'Grid edit' }),
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

  /* Active pipeline (default) hides Closed; the Closed / All scopes surface them apart. */
  let pipelineScope = 'active';
  const scopeBtns = {};
  const scopeToggle = h('div', { class: 'mode-toggle scope-toggle' }, [['active', 'Active'], ['closed', 'Closed'], ['all', 'All']].map(([k, label]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(k === 'active'),
      title: k === 'active' ? 'Active pipeline (Closed hidden)' : k === 'closed' ? 'Closed records only (Passed / Disqualified)' : 'Everyone, including Closed' },
      [h('span', { text: label })]);
    b.addEventListener('click', () => setScope(k));
    scopeBtns[k] = b;
    return b;
  }));
  function setScope(next) {
    pipelineScope = next;
    for (const [k, b] of Object.entries(scopeBtns)) b.setAttribute('aria-pressed', String(k === next));
    if (mode === 'edit') table.clearSelection?.();
    refresh();
  }

  /* ---------- section toggle: the list (Investors) ⇄ the folded-in Follow-ups hub ---------- */
  const sectionBtns = {};
  const sectionToggle = h('div', { class: 'mode-toggle section-toggle' },
    [['investors', 'Investors', 'users'], ['followups', 'Follow-ups', 'calendar-clock']].map(([k, label, ic]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(k === 'investors') }, [icon(ic, 'size-3.5'), h('span', { text: label })]);
      b.addEventListener('click', () => setSection(k));
      sectionBtns[k] = b;
      return b;
    }));

  const investorControls = h('div', { class: 'flex items-center gap-3 flex-wrap flex-1' }, [modeToggle, scopeToggle, gridHint, h('div', { class: 'ml-auto flex items-center gap-2' }, [needsBtn, askBtn])]);
  const modeBar = h('div', { class: 'flex items-center gap-3 flex-wrap investors-bar' }, [sectionToggle, investorControls]);

  function applyModeDom() {
    if (mode === 'edit' && !store.isLive()) mode = 'view';
    const editing = mode === 'edit';
    viewBtn.setAttribute('aria-pressed', String(!editing));
    editBtn.setAttribute('aria-pressed', String(editing));
    editBtn.disabled = !store.isLive();
    editBtn.title = store.isLive() ? 'Edit contacts in a spreadsheet grid' : 'Connect the database to edit inline';
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

  const investorBody = h('div', { class: 'investors-body flex flex-col flex-1 min-h-0' }, [filterBar.el, segmentsRow, filterBar.chipsEl, bulkBar, tableHost, gridHost]);
  const fuHost = h('div', { class: 'followups-host hidden' });
  container.append(modeBar, investorBody, fuHost);
  refreshIcons(container);

  let currentState = null;
  let filtered = [];
  let selectedIds = new Set();
  let section = 'investors';
  let fuHandle = null;

  /* Switch between the investor list and the folded-in Follow-ups hub. The hub is mounted
     lazily the first time it's shown, then kept in sync on every state update. */
  function setSection(next) {
    if (next === section) return;
    section = next;
    for (const [k, b] of Object.entries(sectionBtns)) b.setAttribute('aria-pressed', String(k === next));
    const onFollowups = next === 'followups';
    investorControls.classList.toggle('hidden', onFollowups);
    investorBody.classList.toggle('hidden', onFollowups);
    fuHost.classList.toggle('hidden', !onFollowups);
    if (onFollowups) {
      if (!fuHandle) fuHandle = renderFollowups(fuHost);
      if (currentState) fuHandle.update(currentState);
    }
  }

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
    // A gated bulk stage-move may move only some rows; res.message explains any that were skipped.
    if (res.message) toast(res.message, res.blocked ? 'warn' : 'good');
    else toast(`${label} — ${formatNumber(res.affected || ids.length)} ${res.affected === 1 ? 'contact' : 'contacts'}.`, 'good');
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
      h('button', { class: 'btn btn-quiet btn-sm', type: 'button', title: 'Compose an email to these contacts with AI', onClick: () => goToCompose(selectedIds) }, [icon('mail-plus', 'size-3.5'), 'Compose']),
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

  /** Re-apply the filters to the current data and redraw the list. */
  function refresh() {
    if (!currentState || currentState.status !== 'ready') return;
    renderSegments();
    const base = currentState.visible;              // already respects the global search
    filtered = filterBar.apply(base);
    // Closed (Passed / Disqualified) sit apart from the active pipeline (Phase 9).
    if (pipelineScope === 'active') filtered = filtered.filter((c) => !isClosed(c));
    else if (pipelineScope === 'closed') filtered = filtered.filter((c) => isClosed(c));

    // Edit (grid) mode: the same filtered set, editable. Per-cell saves don't re-enter
    // here (they're silent), so the grid is only rebuilt on a real filter/search change.
    if (mode === 'edit' && store.isLive()) { grid.setRows(filtered); return; }

    table.setRows(filtered);
  }

  function update(state) {
    currentState = state;
    if (state.status === 'loading') { table.setState('loading'); fuHandle?.update(state); return; }
    if (state.status === 'error') { table.setState('error', { message: state.error }); fuHandle?.update(state); return; }
    filterBar.setData(state.contacts);
    const preset = takeContactsPreset();
    if (preset) filterBar.setSelections(preset);   // arrives from a cross-tab jump
    // A cross-tab jump can ask us to open the folded-in Follow-ups hub (e.g. Overview's summary).
    if (takeInvestorsView() === 'followups') setSection('followups');
    applyModeDom();
    refresh();
    if (section === 'followups') fuHandle?.update(state);
  }

  return {
    update,
    destroy() {
      container.parentElement?.classList.remove('view--fill');
      table.destroy(); grid.destroy();
      fuHandle?.destroy();
    },
  };
}
