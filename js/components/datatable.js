/**
 * components/datatable.js — one reusable, sortable table for both tabs.
 *
 * Handles large lists (10k+ rows) with simple windowed rendering: only the rows in
 * view (plus a small overscan) are ever in the DOM, so scrolling stays smooth.
 * Rows are a fixed height, which keeps the maths trivial and the columns aligned
 * with the sticky header. Columns are passed in, so the same table serves the
 * Contacts and Follow-ups tabs without duplication.
 */
import { h, icon, refreshIcons } from '../ui.js';

const ROW_HEIGHT = 60;
const OVERSCAN = 6;

/**
 * columns: [{
 *   key, label, cellClass,           // cellClass sets width + responsive hiding
 *   align,                           // 'left' | 'right'
 *   sortable = true,
 *   sortValue(row) -> string|number|Date|null,
 *   render(row) -> Node|string,
 * }]
 */
export function mountDataTable(container, {
  columns,
  onRowClick,
  title,
  subtitle,
  iconName = 'table',
  accent = '#4f46e5',
  actions = null,
  defaultSort,          // { key, dir }
  emptyMessage = 'No matching contacts.',
}) {
  let rows = [];
  let sort = defaultSort || { key: columns.find((c) => c.sortable !== false)?.key, dir: 'desc' };
  let state = 'loading';

  /* header */
  const headEl = h('div', { class: 'dt-head', role: 'row' });
  const viewport = h('div', { class: 'dt-viewport' });
  const topSpacer = h('div', { class: 'dt-spacer' });
  const bottomSpacer = h('div', { class: 'dt-spacer' });
  const rowsHost = h('div', {});
  const overlay = h('div', { class: 'card-overlay' });
  // The header lives INSIDE the scroll viewport (sticky) so it scrolls
  // horizontally in lock-step with the rows and stays aligned at any width.
  viewport.append(headEl, topSpacer, rowsHost, bottomSpacer, overlay);

  const countPill = h('span', { class: 'pill pill--brand', text: '' });

  const top = h('div', { class: 'dt-top' }, [
    h('span', { class: 'card-icon', style: `--accent:${accent}` }, [icon(iconName, 'size-[18px]')]),
    h('div', { class: 'min-w-0 flex-1' }, [
      h('h2', { class: 't-title truncate', text: title }),
      subtitle ? h('p', { class: 't-caption mt-0.5 truncate', text: subtitle }) : null,
    ]),
    countPill,
    actions,
  ]);

  const el = h('section', { class: 'card dt-card' }, [top, viewport]);
  container.append(el);

  buildHeader();
  refreshIcons(el);

  /* ---------- header ---------- */
  function buildHeader() {
    headEl.replaceChildren(...columns.map((col) => {
      const sorted = sort.key === col.key;
      const cell = h('div', {
        class: `dt-cell ${col.cellClass || ''} dt-h ${col.sortable !== false ? 'sortable' : ''} ${sorted ? 'sorted ' + sort.dir : ''}`,
        role: 'columnheader',
        style: col.align === 'right' ? 'justify-content:flex-end;text-align:right' : '',
      }, [
        h('span', { text: col.label }),
        col.sortable !== false ? icon('chevron-down', 'size-3.5 sort-ind') : null,
      ]);
      if (col.sortable !== false) {
        cell.addEventListener('click', () => {
          if (sort.key === col.key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
          else sort = { key: col.key, dir: col.defaultSortDir || 'asc' };
          applySort();
          buildHeader();
          viewport.scrollTop = 0;
          renderWindow();
        });
      }
      return cell;
    }));
    refreshIcons(headEl);
  }

  /* ---------- sorting ---------- */
  function applySort() {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return;
    const getVal = col.sortValue || ((row) => row[col.key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let va = getVal(a); let vb = getVal(b);
      va = va instanceof Date ? va.getTime() : va;
      vb = vb instanceof Date ? vb.getTime() : vb;
      const aEmpty = va == null || va === '';
      const bEmpty = vb == null || vb === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;   // blanks always sink to the bottom, both directions
      if (bEmpty) return -1;
      if (typeof va === 'string' && typeof vb === 'string') {
        return va.localeCompare(vb, undefined, { sensitivity: 'base' }) * dir;
      }
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }

  /* ---------- windowed rendering ---------- */
  function renderRow(row) {
    const node = h('div', { class: 'dt-row', role: 'row', tabindex: '0' },
      columns.map((col) => {
        const content = col.render ? col.render(row) : (row[col.key] ?? '');
        return h('div', {
          class: `dt-cell ${col.cellClass || ''} ${col.align === 'right' ? 'num' : ''}`,
          style: col.align === 'right' ? 'text-align:right' : '',
        }, [content]);
      }));
    const open = () => onRowClick?.(row);
    node.addEventListener('click', open);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    return node;
  }

  function renderWindow() {
    if (state !== 'ready') return;
    const total = rows.length;
    const vh = viewport.clientHeight || 480;
    const start = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const count = Math.ceil(vh / ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(total, start + count);

    topSpacer.style.height = `${start * ROW_HEIGHT}px`;
    bottomSpacer.style.height = `${Math.max(0, (total - end)) * ROW_HEIGHT}px`;

    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i += 1) frag.append(renderRow(rows[i]));
    rowsHost.replaceChildren(frag);
    refreshIcons(rowsHost);
  }

  viewport.addEventListener('scroll', () => {
    // Re-window on scroll; cheap because only ~30 rows are ever rebuilt.
    window.requestAnimationFrame(renderWindow);
  }, { passive: true });

  const resizeObserver = new ResizeObserver(() => renderWindow());
  resizeObserver.observe(viewport);

  /* ---------- states ---------- */
  function setOverlay(kind, message) {
    overlay.replaceChildren();
    if (kind === 'loading') overlay.append(skeletonRows());
    else if (kind === 'empty') overlay.append(emptyBlock(message || emptyMessage));
    overlay.style.display = kind === 'ready' ? 'none' : 'flex';
    refreshIcons(overlay);
  }

  function setRows(next) {
    rows = Array.isArray(next) ? next.slice() : [];
    countPill.textContent = `${rows.length.toLocaleString()} ${rows.length === 1 ? 'contact' : 'contacts'}`;
    if (!rows.length) {
      state = 'empty';
      topSpacer.style.height = bottomSpacer.style.height = '0px';
      rowsHost.replaceChildren();
      setOverlay('empty');
      return;
    }
    state = 'ready';
    setOverlay('ready');
    applySort();
    // Preserve scroll position across data refreshes (e.g. an inline edit) — only
    // clamp it to the new content height so the view never ends up past the end.
    const maxScroll = Math.max(0, rows.length * ROW_HEIGHT - viewport.clientHeight);
    if (viewport.scrollTop > maxScroll) viewport.scrollTop = maxScroll;
    renderWindow();
  }

  function setState(kind, opts = {}) {
    state = kind;
    if (kind === 'ready') { setOverlay('ready'); renderWindow(); }
    else { rowsHost.replaceChildren(); topSpacer.style.height = bottomSpacer.style.height = '0px'; setOverlay(kind, opts.message); }
  }

  setOverlay('loading');

  return {
    el,
    setRows,
    setState,
    getRows: () => rows.slice(),
    getSort: () => ({ ...sort }),
    destroy() { resizeObserver.disconnect(); el.remove(); },
  };
}

/* ---------- little state blocks ---------- */
function skeletonRows() {
  return h('div', { class: 'w-full' }, Array.from({ length: 8 }, () =>
    h('div', { class: 'flex items-center gap-3 px-4', style: 'height:60px' }, [
      h('div', { class: 'shimmer h-8 w-8 rounded-full' }),
      h('div', { class: 'flex-1 space-y-1.5' }, [
        h('div', { class: 'shimmer h-3 w-40 rounded-full' }),
        h('div', { class: 'shimmer h-2.5 w-24 rounded-full' }),
      ]),
      h('div', { class: 'shimmer h-5 w-20 rounded-full' }),
      h('div', { class: 'shimmer h-5 w-16 rounded-full hidden sm:block' }),
    ])));
}

function emptyBlock(message) {
  return h('div', { class: 'state-block' }, [
    h('span', { class: 'state-icon state-icon--empty' }, [icon('search-x', 'size-5')]),
    h('p', { class: 't-body font-medium text-slate-600', text: message }),
    h('p', { class: 't-caption', text: 'Try removing a filter or clearing the search.' }),
  ]);
}
