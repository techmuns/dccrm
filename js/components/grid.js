/**
 * components/grid.js — an Excel-style editable grid for the Contacts tab.
 *
 * One row per contact, one <input>/<select>/date editor per cell. It is deliberately
 * NOT virtualised: keeping every row in the DOM is what makes sticky columns, cell-to-
 * cell keyboard movement, copy/paste and fill-down simple and correct. It stays smooth
 * well past the couple-hundred rows this CRM edits at a time.
 *
 * The grid is decoupled from the store: the tab passes save/create/delete callbacks, so
 * every write goes through the SAME endpoints the Add/Edit form and drawer already use.
 * Saves are per-cell and never rebuild the whole grid — only the edited row repaints.
 *
 * columns: [{
 *   key, label, width,                      // width in px (fixed; the grid scrolls sideways)
 *   type = 'text'|'email'|'enum'|'date',
 *   sticky,                                 // pin this column to the left (the first one)
 *   required,                               // block create/blank-out when empty (Full Name)
 *   options: () => string[],                // enum choices
 *   datalist: () => string[],               // free-text suggestions (a dropdown you can type past)
 *   colorDim,                               // draw a coloured dot from this colour dimension
 *   validate: (value) => string | null,     // e.g. email; returns an error message or null
 * }]
 */
import { h, icon, refreshIcons, toast } from '../ui.js';
import { colorOf } from '../colors.js';
import { formatDate, parseDate, tidy } from '../util.js';

const SAVE_DEBOUNCE = 450;
const GUTTER_W = 46;            // left status/delete gutter width, in px
const FILL_CONFIRM_OVER = 20;   // ask before a fill-down / block-paste touches more than this many rows

export function mountGrid(container, {
  columns,
  title = 'Contacts',
  subtitle = '',
  iconName = 'table',
  accent = '#a83a5b',
  actions = null,
  onSaveCell,          // async (contact, patch) -> { ok, contact?, error? }
  onCreate,            // async (fields)          -> { ok, contact?, error? }
  onDelete,            // async (contact)         -> { ok, error? }
  emptyMessage = 'No contacts match these filters.',
}) {
  let rows = [];
  const rowEls = [];   // parallel to rows: { contact, el, statusEl, cells: Map(colKey -> cellEl) }
  let addRow = null;   // the trailing blank "add a contact" row element
  let openEditor = null;   // { cell, input, ri, ci, col, contact, original, commit, cancel }
  let active = { ri: 0, ci: 0 };
  let clipboard = '';  // internal fallback when the system clipboard is unavailable

  /* ---------- shell ---------- */
  const countPill = h('span', { class: 'pill pill--brand', text: '' });
  const addBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' },
    [icon('plus', 'size-3.5'), h('span', { class: 'hidden sm:inline', text: 'Add contact' })]);
  addBtn.addEventListener('click', () => focusAddRow());

  const top = h('div', { class: 'dt-top' }, [
    h('span', { class: 'card-icon', style: `--accent:${accent}` }, [icon(iconName, 'size-[18px]')]),
    h('div', { class: 'min-w-0 flex-1' }, [
      h('h2', { class: 't-title truncate', text: title }),
      subtitle ? h('p', { class: 't-caption mt-0.5 truncate', text: subtitle }) : null,
    ]),
    countPill, addBtn, actions,
  ]);

  const headRow = h('div', { class: 'grid-headrow' });
  const body = h('div', { class: 'grid-body' });
  const overlay = h('div', { class: 'card-overlay' });
  const scroll = h('div', { class: 'grid-scroll' }, [headRow, body, overlay]);
  const dataLists = h('div', { style: 'display:none' });   // <datalist>s for free-text suggestion columns
  const el = h('section', { class: 'card grid-card' }, [top, scroll, dataLists]);
  container.append(el);

  buildHeader();
  refreshIcons(el);

  /* ---------- header + sticky offsets ---------- */
  function leftOffset(ci) {
    // sticky columns pin left in document order, each after the ones before it
    let x = GUTTER_W;
    for (let i = 0; i < ci; i += 1) if (columns[i].sticky) x += columns[i].width;
    return x;
  }
  function cellStyle(col, ci) {
    let s = `width:${col.width}px;flex:0 0 ${col.width}px;`;
    if (col.sticky) s += `position:sticky;left:${leftOffset(ci)}px;z-index:6;`;
    return s;
  }

  function buildHeader() {
    const cells = [h('div', { class: 'grid-cell grid-gutter grid-hcell', style: `width:${GUTTER_W}px;flex:0 0 ${GUTTER_W}px;position:sticky;left:0;z-index:7` })];
    columns.forEach((col, ci) => {
      cells.push(h('div', {
        class: `grid-cell grid-hcell${col.sticky ? ' is-sticky' : ''}`,
        style: cellStyle(col, ci) + (col.sticky ? 'z-index:8;' : ''),
        title: col.label,
      }, [h('span', { class: 'truncate', text: col.label })]));
    });
    headRow.replaceChildren(...cells);
  }

  /* ---------- datalists for free-text suggestion columns ---------- */
  function refreshDataLists() {
    const lists = [];
    for (const col of columns) {
      if (!col.datalist) continue;
      const values = col.datalist();
      lists.push(h('datalist', { id: `grid-dl-${col.key}` }, values.map((v) => h('option', { value: v }))));
    }
    dataLists.replaceChildren(...lists);
  }

  /* ---------- cell display ---------- */
  function displayValue(contact, col) {
    const raw = contact[col.key];
    if (col.type === 'date') { const d = parseDate(raw); return d ? formatDate(d) : ''; }
    return tidy(raw);
  }

  function paintCell(cell, contact, col) {
    const text = displayValue(contact, col);
    const kids = [];
    if (col.colorDim && tidy(contact[col.key])) {
      kids.push(h('span', { class: 'grid-dot', style: `background:${colorOf(col.colorDim, tidy(contact[col.key]))}` }));
    }
    kids.push(text
      ? h('span', { class: 'grid-val truncate', text })
      : h('span', { class: 'grid-empty', text: '—' }));
    cell.replaceChildren(...kids);
    // an unsaved invalid entry (bad email) stays flagged until fixed
    const err = cell._invalid;
    cell.classList.toggle('is-invalid', !!err);
    cell.title = err || '';
  }

  /* ---------- rows ---------- */
  function makeCell(contact, col, ri, ci) {
    const cell = h('div', {
      class: `grid-cell grid-data${col.sticky ? ' is-sticky' : ''}`,
      style: cellStyle(col, ci), tabindex: '-1',
      dataset: { ri: String(ri), ci: String(ci) },
    });
    paintCell(cell, contact, col);
    cell.addEventListener('mousedown', (e) => {
      // open the editor on click; mousedown (not click) so focus lands cleanly
      if (openEditor && openEditor.cell === cell) return;
      e.preventDefault();
      beginEdit(ri, ci);
    });
    return cell;
  }

  function makeRow(contact, ri) {
    const status = h('span', { class: 'grid-status' });
    const del = h('button', { class: 'grid-del', type: 'button', 'aria-label': `Delete ${contact.fullName || 'contact'}`, title: 'Delete contact' },
      [icon('trash-2', 'size-3.5')]);
    del.addEventListener('mousedown', (e) => e.stopPropagation());
    del.addEventListener('click', (e) => { e.stopPropagation(); confirmDelete(contact); });
    const gutter = h('div', { class: 'grid-cell grid-gutter', style: `width:${GUTTER_W}px;flex:0 0 ${GUTTER_W}px;position:sticky;left:0;z-index:5` }, [status, del]);

    const cells = new Map();
    const cellEls = columns.map((col, ci) => { const c = makeCell(contact, col, ri, ci); cells.set(col.key, c); return c; });
    const rowEl = h('div', { class: 'grid-row' }, [gutter, ...cellEls]);
    rowEls[ri] = { contact, el: rowEl, statusEl: status, cells };
    return rowEl;
  }

  function makeAddRow() {
    const gutter = h('div', { class: 'grid-cell grid-gutter', style: `width:${GUTTER_W}px;flex:0 0 ${GUTTER_W}px;position:sticky;left:0;z-index:5` },
      [icon('plus', 'size-3.5 text-slate-300')]);
    const cells = columns.map((col, ci) => {
      const first = ci === 0;
      const cell = h('div', {
        class: `grid-cell grid-data grid-addcell${col.sticky ? ' is-sticky' : ''}`,
        style: cellStyle(col, ci), tabindex: '-1',
        dataset: { ri: String(rows.length), ci: String(ci) },
      }, [first ? h('span', { class: 'grid-empty', text: 'Type a name to add…' }) : h('span', { class: 'grid-empty', text: '' })]);
      cell.addEventListener('mousedown', (e) => {
        e.preventDefault();
        beginEdit(rows.length, first ? 0 : 0);   // any click on the add-row edits the required Name cell first
      });
      return cell;
    });
    addRow = h('div', { class: 'grid-row grid-row--add' }, [gutter, ...cells]);
    return addRow;
  }

  function renderBody() {
    rowEls.length = 0;
    const frag = document.createDocumentFragment();
    rows.forEach((c, ri) => frag.append(makeRow(c, ri)));
    frag.append(makeAddRow());
    body.replaceChildren(frag);
    refreshIcons(body);
  }

  /* ---------- editing ---------- */
  function optionList(col, current) {
    const opts = col.options ? col.options() : [];
    const out = [];
    const seen = new Set();
    if (current && !opts.includes(current)) out.push(current);
    for (const o of [...out, ...opts]) { if (!seen.has(o)) { seen.add(o); } }
    return [...seen];
  }

  function makeEditor(col, value) {
    if (col.type === 'enum') {
      const sel = h('select', { class: 'grid-input' }, [
        h('option', { value: '', text: '—' }),
        ...optionList(col, value).map((o) => h('option', { value: o, text: o, selected: o === value ? '' : null })),
      ]);
      sel.value = value || '';
      return sel;
    }
    if (col.type === 'date') return h('input', { class: 'grid-input', type: 'date', value: value || '' });
    const input = h('input', {
      class: 'grid-input', type: col.type === 'email' ? 'email' : 'text', value: value || '',
      ...(col.datalist ? { list: `grid-dl-${col.key}`, autocomplete: 'off' } : {}),
    });
    return input;
  }

  function cellAt(ri, ci) {
    if (ri >= rows.length) return addRow?.querySelectorAll('.grid-data')[ci] || null;
    return rowEls[ri]?.cells.get(columns[ci].key) || null;
  }

  function beginEdit(ri, ci) {
    if (openEditor) openEditor.commit(false);
    active = { ri, ci };
    const isAdd = ri >= rows.length;
    if (isAdd) ci = 0;                    // the add-row only edits the required first column
    const col = columns[ci];
    const cell = cellAt(ri, ci);
    if (!cell) return;
    const contact = isAdd ? null : rows[ri];
    const original = isAdd ? '' : (contact[col.key] ?? '');
    const input = makeEditor(col, cell._invalid != null ? cell._pending : original);
    cell.classList.add('is-editing');
    cell.replaceChildren(input);
    input.focus();
    if (input.select) try { input.select(); } catch { /* selects are fine */ }

    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      openEditor = null;
      cell.classList.remove('is-editing');
      const value = String(input.value ?? '').trim();
      if (!save) { cell._invalid = null; paintCell(cell, contact || blankContact(), col); if (isAdd) restoreAddCell(cell, ci); return; }
      if (isAdd) { commitAdd(value); paintCell(cell, blankContact(), col); restoreAddCell(cell, ci); return; }
      commitEdit(contact, col, cell, value, original);
    };
    const editor = {
      cell, input, ri, ci, col, contact,
      commit: (save = true) => finish(save),
      cancel: () => finish(false),
      value: () => String(input.value ?? ''),
    };
    openEditor = editor;

    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); move(e.shiftKey ? -1 : 1, 0); }
      else if (e.key === 'Tab') { e.preventDefault(); finish(true); move(0, e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); cell.focus(); }
    };
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', () => finish(true));
    if (col.type === 'enum' || col.type === 'date') input.addEventListener('change', () => finish(true));
  }

  const blankContact = () => ({});
  function restoreAddCell(cell, ci) {
    cell.replaceChildren(h('span', { class: 'grid-empty', text: ci === 0 ? 'Type a name to add…' : '' }));
  }

  /* validate + save one edited cell (never rebuilds the grid) */
  function commitEdit(contact, col, cell, value, original) {
    if (value === (original ?? '')) { cell._invalid = null; paintCell(cell, contact, col); return; }
    if (col.validate) {
      const err = value ? col.validate(value) : null;
      if (err) { cell._invalid = err; cell._pending = value; cell.replaceChildren(h('span', { class: 'grid-val truncate', text: value }), h('span', { class: 'grid-empty', text: '' })); cell.classList.add('is-invalid'); cell.title = err; return; }
    }
    if (col.required && !value) {
      cell._invalid = `${col.label} can't be empty.`; cell._pending = value;
      cell.classList.add('is-invalid'); cell.title = cell._invalid; toast(cell._invalid, 'warn'); return;
    }
    cell._invalid = null;
    contact[col.key] = value;               // optimistic local update; the row repaints from this
    paintCell(cell, contact, col);
    saveDebounced(contact, col, cell, { [col.key]: value }, original);
  }

  const timers = new Map();
  function saveDebounced(contact, col, cell, patch, original) {
    setStatus(contact, 'saving');
    const key = `${contact.id}:${col.key}`;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      const res = await onSaveCell(contact, patch);
      if (!res.ok) {
        contact[col.key] = original;         // roll back
        paintCell(cell, contact, col);
        setStatus(contact, 'error', res.error);
        toast(res.error || 'Could not save that change.', 'error');
        return;
      }
      if (res.contact) syncRow(contact, res.contact);   // adopt server-normalised values
      setStatus(contact, 'saved');
    }, SAVE_DEBOUNCE));
  }

  /* copy the confirmed server contact back onto the in-place row + repaint its cells */
  function syncRow(contact, confirmed) {
    Object.assign(contact, confirmed);
    const entry = rowEls.find((r) => r && r.contact === contact);
    if (!entry) return;
    for (const col of columns) { const c = entry.cells.get(col.key); if (c && !c.classList.contains('is-editing')) paintCell(c, contact, col); }
  }

  function setStatus(contact, kind, msg = '') {
    const entry = rowEls.find((r) => r && r.contact === contact);
    if (!entry) return;
    const s = entry.statusEl;
    s.className = `grid-status is-${kind}`;
    s.title = msg || '';
    s.replaceChildren(
      kind === 'saving' ? icon('loader-circle', 'size-3.5 animate-spin')
        : kind === 'saved' ? icon('check', 'size-3.5')
          : kind === 'error' ? icon('circle-alert', 'size-3.5') : '',
    );
    refreshIcons(s);
    if (kind === 'saved') setTimeout(() => { if (s.classList.contains('is-saved')) { s.className = 'grid-status'; s.replaceChildren(); } }, 1300);
  }

  /* ---------- add a row ---------- */
  async function commitAdd(name) {
    const value = name.trim();
    if (!value) return;                     // Full Name required
    const res = await onCreate({ [columns[0].key]: value });
    if (!res.ok) { toast(res.error || 'Could not add contact.', 'error'); return; }
    // turn the blank row into a real one, drop a fresh blank row underneath, keep editing across →
    rows.push(res.contact);
    const ri = rows.length - 1;
    const realRow = makeRow(res.contact, ri);
    body.insertBefore(realRow, addRow);
    setStatus(res.contact, 'saved');
    renumberAddRow();
    requestAnimationFrame(() => beginEdit(ri, 1));   // jump to Organisation for fast entry
  }

  function focusAddRow() { beginEdit(rows.length, 0); scroll.scrollTop = scroll.scrollHeight; }
  function renumberAddRow() {
    addRow?.querySelectorAll('.grid-data').forEach((c) => { c.dataset.ri = String(rows.length); });
  }

  /* ---------- delete a row ---------- */
  async function confirmDelete(contact) {
    if (!confirm(`Delete ${contact.fullName || 'this contact'}? This cannot be undone.`)) return;
    const res = await onDelete(contact);
    if (!res.ok) { toast(res.error || 'Could not delete.', 'error'); return; }
    const idx = rows.indexOf(contact);
    if (idx >= 0) { rows.splice(idx, 1); }
    const entry = rowEls.find((r) => r && r.contact === contact);
    entry?.el.remove();
    // rebuild indices so keyboard nav + add-row stay correct
    reindex();
    toast('Contact deleted.', 'good');
  }

  function reindex() {
    const present = rowEls.filter((r) => r && document.contains(r.el));
    rowEls.length = 0;
    present.forEach((entry, ri) => {
      rowEls[ri] = entry;
      let ci = 0;
      for (const col of columns) { const c = entry.cells.get(col.key); if (c) { c.dataset.ri = String(ri); c.dataset.ci = String(ci); } ci += 1; }
    });
    renumberAddRow();
  }

  /* ---------- keyboard movement between cells ---------- */
  function move(dRow, dCol) {
    let { ri, ci } = active;
    const lastRi = rows.length;            // the add-row
    if (dCol) {
      ci += dCol;
      if (ci < 0) { ci = columns.length - 1; ri = Math.max(0, ri - 1); }
      else if (ci > columns.length - 1) { ci = 0; ri = Math.min(lastRi, ri + 1); }
    }
    if (dRow) ri = Math.max(0, Math.min(lastRi, ri + dRow));
    // don't auto-open the add-row unless we're on its first column
    if (ri >= rows.length) ci = 0;
    requestAnimationFrame(() => beginEdit(ri, ci));
  }

  /* ---------- copy / paste / fill-down ---------- */
  function activeContactCol() {
    if (active.ri >= rows.length) return null;
    return { contact: rows[active.ri], col: columns[active.ci], cell: cellAt(active.ri, active.ci) };
  }

  async function readClipboard() {
    try { const t = await navigator.clipboard.readText(); if (t != null) return t; } catch { /* fall through */ }
    return clipboard;
  }
  async function writeClipboard(text) {
    clipboard = text;
    try { await navigator.clipboard.writeText(text); } catch { /* internal fallback already set */ }
  }

  function onGridKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'c') {
      const a = activeContactCol(); if (!a) return;
      e.preventDefault();
      writeClipboard(openEditor ? openEditor.value() : (a.contact[a.col.key] ?? ''));
    } else if (k === 'd') {
      e.preventDefault(); fillDown();
    } else if (k === 'v') {
      // let a normal paste into an open text editor work; only intercept block pastes / non-editing paste
      if (openEditor && openEditor.col.type !== 'enum') return;
      e.preventDefault(); doPaste();
    }
  }

  function fillDown() {
    const a = activeContactCol(); if (!a) return;
    if (a.col.validate || a.col.required) { toast('Fill-down isn’t available on this column.', 'warn'); return; }
    if (openEditor) openEditor.commit(true);
    const value = a.contact[a.col.key] ?? '';
    const targets = rows.slice(active.ri + 1);
    if (!targets.length) return;
    if (targets.length > FILL_CONFIRM_OVER && !confirm(`Fill “${value || '—'}” down into ${targets.length} rows?`)) return;
    for (const contact of targets) {
      const prev = contact[a.col.key] ?? '';
      if (prev === value) continue;
      contact[a.col.key] = value;
      const entry = rowEls.find((r) => r && r.contact === contact);
      const cell = entry?.cells.get(a.col.key);
      if (cell) { cell._invalid = null; paintCell(cell, contact, a.col); }
      saveDebounced(contact, a.col, cell, { [a.col.key]: value }, prev);
    }
    toast(`Filled ${targets.length} rows.`, 'good');
  }

  async function doPaste() {
    const a = activeContactCol(); if (!a) return;
    const text = await readClipboard();
    if (text == null || text === '') return;
    const block = text.replace(/\r/g, '').replace(/\n$/, '');
    const grid = block.split('\n').map((line) => line.split('\t'));
    const isBlock = grid.length > 1 || grid[0].length > 1;
    if (!isBlock) { pasteOne(a, grid[0][0]); return; }
    await pasteBlock(grid);
  }

  function pasteOne(a, value) {
    const v = String(value).trim();
    if (a.col.validate && v && a.col.validate(v)) { toast('That value isn’t valid for this column.', 'warn'); return; }
    const prev = a.contact[a.col.key] ?? '';
    if (v === prev) return;
    a.contact[a.col.key] = v;
    a.cell._invalid = null;
    paintCell(a.cell, a.contact, a.col);
    saveDebounced(a.contact, a.col, a.cell, { [a.col.key]: v }, prev);
  }

  /* Paste an Excel block starting at the active cell: left-to-right into the visible
     columns, top-to-bottom into existing rows (extra rows are created). Best-effort:
     enum/date cells take the raw text; validated cells (email) skip a bad value. */
  async function pasteBlock(grid) {
    const startRi = active.ri; const startCi = active.ci;
    const spanCols = Math.min(grid[0].length, columns.length - startCi);
    const newRowsNeeded = Math.max(0, (startRi + grid.length) - rows.length);
    const total = grid.length * spanCols;
    if (!confirm(`Paste ${grid.length} × ${spanCols} block${newRowsNeeded ? ` (creates ${newRowsNeeded} new rows)` : ''}? ${total} cells.`)) return;

    for (let r = 0; r < grid.length; r += 1) {
      const ri = startRi + r;
      let contact = rows[ri];
      if (!contact) {
        // create a new row from the first (name) column value if present, else skip
        const nameCi = columns.findIndex((c) => c.required);
        const nameVal = (grid[r][nameCi - startCi] || '').trim();
        if (!nameVal) continue;
        const res = await onCreate({ [columns[Math.max(0, nameCi)].key]: nameVal });
        if (!res.ok) { toast(res.error || 'Could not add a pasted row.', 'error'); continue; }
        rows.push(res.contact);
        const newRow = makeRow(res.contact, rows.length - 1);
        body.insertBefore(newRow, addRow);
        contact = res.contact;
      }
      for (let c = 0; c < spanCols; c += 1) {
        const col = columns[startCi + c];
        if (col.required) continue;                 // name already handled on create
        const v = String(grid[r][c] ?? '').trim();
        if (col.validate && v && col.validate(v)) continue;   // skip invalid (e.g. bad email)
        const prev = contact[col.key] ?? '';
        if (v === prev) continue;
        contact[col.key] = v;
        const entry = rowEls.find((x) => x && x.contact === contact);
        const cell = entry?.cells.get(col.key);
        if (cell) { cell._invalid = null; paintCell(cell, contact, col); }
        saveDebounced(contact, col, cell, { [col.key]: v }, prev);
      }
    }
    renumberAddRow();
    toast('Pasted from clipboard.', 'good');
  }

  scroll.addEventListener('keydown', onGridKey, true);

  /* ---------- overlay states ---------- */
  function setOverlay(kind, message) {
    overlay.replaceChildren();
    if (kind === 'empty') {
      overlay.append(h('div', { class: 'state-block' }, [
        h('span', { class: 'state-icon state-icon--empty' }, [icon('search-x', 'size-5')]),
        h('p', { class: 't-body font-medium text-slate-600', text: message || emptyMessage }),
        h('p', { class: 't-caption', text: 'Add a contact below, or clear a filter.' }),
      ]));
    }
    overlay.style.display = kind === 'ready' ? 'none' : 'flex';
    refreshIcons(overlay);
  }

  /* ---------- public API ---------- */
  function setRows(next) {
    if (openEditor) openEditor.commit(false);
    rows = Array.isArray(next) ? next.slice() : [];
    countPill.textContent = `${rows.length.toLocaleString()} ${rows.length === 1 ? 'contact' : 'contacts'}`;
    refreshDataLists();
    renderBody();
    setOverlay('ready');            // the add-row always shows, so never a bare empty state
    if (!rows.length) { /* body still holds the add-row */ }
  }

  function setState(kind, opts = {}) {
    if (kind === 'ready') setOverlay('ready');
    else { body.replaceChildren(); setOverlay(kind === 'loading' ? 'empty' : kind, opts.message || (kind === 'loading' ? 'Loading…' : '')); }
  }

  return {
    el,
    setRows,
    setState,
    destroy() { for (const t of timers.values()) clearTimeout(t); el.remove(); },
  };
}
