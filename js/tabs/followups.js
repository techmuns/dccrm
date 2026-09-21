/**
 * tabs/followups.js — what to do next, who's due, and who's gone quiet.
 *
 * Built from Next Action, Next Action Date, Last Contact and Stage. Clickable
 * urgency buckets across the top filter the list; a "Needs a nudge" toggle surfaces
 * active-stage contacts we haven't spoken to in 30+ days. Reuses the same FilterBar,
 * DataTable and DetailDrawer as the Contacts tab.
 */
import { PALETTE } from '../config.js';
import { card, h, icon, refreshIcons, toast } from '../ui.js';
import { formatNumber, formatDate, tidy } from '../util.js';
import * as store from '../store.js';
import { createFilterBar } from '../components/filterbar.js';
import { mountDataTable } from '../components/datatable.js';
import { createChartCard } from '../components/chartcard.js';
import { openDrawer } from '../components/drawer.js';
import { nameCell, chipCell, textCell, dateCell } from '../components/cells.js';
import { barOption } from '../charts.js';
import { BUCKETS, bucketOf, bucketCounts, dueByWeek, needsNudge, countNudge } from '../filters.js';

export function render(container) {
  container.classList.add('tab-panel--fill');
  container.parentElement?.classList.add('view--fill');

  let activeBucket = null;
  let nudgeOn = false;

  /* ---- urgency buckets ---- */
  const bucketEls = new Map();
  const bucketRow = h('div', { class: 'bucket-row' }, BUCKETS.map((b) => {
    const nEl = h('div', { class: 'b-n', text: '0' });
    const btn = h('button', {
      class: 'bucket', type: 'button', 'aria-pressed': 'false',
      style: `--c:${b.color}`, title: `Show ${b.label.toLowerCase()}`,
    }, [
      h('span', { class: 'bucket-ico', style: `--c:${b.color}` }, [icon(b.icon, 'size-[18px]')]),
      nEl,
      h('span', { class: 'b-l', text: b.label }),
    ]);
    btn.addEventListener('click', () => {
      activeBucket = activeBucket === b.id ? null : b.id;
      for (const [id, el] of bucketEls) el.btn.setAttribute('aria-pressed', String(id === activeBucket));
      refresh();
    });
    bucketEls.set(b.id, { btn, nEl });
    return btn;
  }));

  /* ---- filters (owner / type / stage) + needs-a-nudge toggle ---- */
  const filterBar = createFilterBar({
    dimensions: [
      { field: 'relationshipOwner', label: 'Owner', icon: 'user-round' },
      { field: 'entityType',        label: 'Type',  icon: 'building-2' },
      { field: 'stage',             label: 'Stage', icon: 'git-branch' },
    ],
    onChange: () => refresh(),
  });

  const nudgeInput = h('input', { type: 'checkbox', role: 'switch' });
  const nudgeCount = h('span', { class: 'pill pill--warn', text: '0' });
  nudgeInput.addEventListener('change', () => { nudgeOn = nudgeInput.checked; refresh(); });
  const nudge = h('label', { class: 'fb-switch', title: 'Active-stage contacts not spoken to in 30+ days' }, [
    nudgeInput, h('span', { class: 'fb-track' }), icon('bell-ring', 'size-4 text-amber-500'),
    h('span', { text: 'Needs a nudge' }), nudgeCount,
  ]);

  const controls = h('div', { class: 'flex flex-wrap items-center gap-3' }, [
    h('div', { class: 'w-full lg:flex-1 lg:w-auto min-w-0' }, [filterBar.el]),
    nudge,
  ]);

  /* ---- weekly chart ---- */
  const weeks = createChartCard({
    title: 'Follow-ups coming up',
    subtitle: 'How many are due each week for the next six weeks.',
    iconName: 'calendar-days', accent: PALETTE[3], chartClass: 'chart--weeks',
  });

  /* ---- table ---- */
  const columns = [
    { key: 'fullName', label: 'Name', cellClass: 'col-name dt-name', defaultSortDir: 'asc',
      sortValue: (r) => r.fullName?.toLowerCase(), render: nameCell },
    { key: 'stage', label: 'Stage', cellClass: 'col-stage',
      sortValue: (r) => r.stage, render: (r) => chipCell('stage', r.stage) },
    { key: 'nextAction', label: 'Next action', cellClass: 'col-action',
      sortValue: (r) => r.nextAction?.toLowerCase(), render: (r) => textCell(r.nextAction) },
    { key: 'nextActionDate', label: 'Due', cellClass: 'col-next', defaultSortDir: 'asc',
      sortValue: (r) => r.nextActionAt, render: (r) => dateCell(r.nextActionAt, { markOverdue: true }) },
    { key: 'lastContact', label: 'Last contact', cellClass: 'col-last', defaultSortDir: 'desc',
      sortValue: (r) => r.lastContactAt, render: (r) => dateCell(r.lastContactAt) },
    { key: 'relationshipOwner', label: 'Owner', cellClass: 'col-owner',
      sortValue: (r) => r.relationshipOwner?.toLowerCase(), render: (r) => textCell(r.relationshipOwner) },
  ];

  const tableHost = h('div', { class: 'flex flex-1 min-h-0' });
  const table = mountDataTable(tableHost, {
    columns,
    onRowClick: openDrawer,
    title: 'Follow-up list',
    subtitle: 'Soonest first. Overdue dates are shown in red.',
    iconName: 'list-checks',
    accent: PALETTE[3],
    defaultSort: { key: 'nextActionDate', dir: 'asc' },
    emptyMessage: 'Nothing to follow up here.',
  });

  /* Open tasks card (live only) — reminders alongside the Next-Action list */
  const tasksCard = card({ title: 'Open tasks', subtitle: 'Reminders across the team, soonest due first.', iconName: 'list-checks', accent: PALETTE[2] });
  const tasksHost = h('div', {});
  tasksCard.content.append(tasksHost);

  const topGrid = store.isLive()
    ? h('div', { class: 'grid grid-cols-1 lg:grid-cols-12 gap-4' }, [
        h('div', { class: 'lg:col-span-7 flex' }, [weeks.el]),
        h('div', { class: 'lg:col-span-5 flex' }, [tasksCard.el]),
      ])
    : h('div', { class: 'grid grid-cols-1 gap-4' }, [weeks.el]);

  container.append(bucketRow, controls, filterBar.chipsEl, topGrid, tableHost);
  refreshIcons(container);

  let currentState = null;

  function refresh() {
    if (!currentState || currentState.status !== 'ready') return;
    const base = currentState.visible;
    let scoped = filterBar.apply(base);
    if (nudgeOn) scoped = scoped.filter((c) => needsNudge(c));

    /* bucket counts reflect the current owner/type/stage/nudge scope */
    const counts = bucketCounts(scoped);
    for (const b of BUCKETS) bucketEls.get(b.id).nEl.textContent = formatNumber(counts[b.id]);
    nudgeCount.textContent = formatNumber(countNudge(filterBar.apply(base)));

    /* weekly chart on the scoped set */
    const wk = dueByWeek(scoped, 6).map((w) => ({ ...w, color: PALETTE[3] }));
    if (wk.some((w) => w.value > 0)) {
      weeks.draw(barOption(wk, { valueLabel: 'Follow-ups' }), wk, { valueLabel: 'Follow-ups', showLegendValue: true });
    } else {
      weeks.setState('empty', { message: 'No follow-ups scheduled in the next six weeks.' });
    }

    /* the list: scoped, then the chosen bucket */
    const list = activeBucket ? scoped.filter((c) => bucketOf(c) === activeBucket) : scoped;
    const bucketLabel = activeBucket ? BUCKETS.find((b) => b.id === activeBucket).label.toLowerCase() : null;
    table.setRows(list);
    return bucketLabel;
  }

  async function loadTasks() {
    if (!store.isLive()) return;
    tasksCard.setState('ready');
    const res = await store.listTasks('?open=1');
    const tasks = res.tasks || [];
    tasksCard.head.querySelector('.t-caption').textContent = tasks.length
      ? `${tasks.length} open ${tasks.length === 1 ? 'task' : 'tasks'}, soonest due first.` : 'No open tasks — all clear.';
    if (!tasks.length) {
      tasksHost.replaceChildren(h('p', { class: 't-caption py-3 text-center text-slate-400', text: 'Nothing on the list. Add tasks from a contact.' }));
      return;
    }
    tasksHost.replaceChildren(h('ul', { class: 'task-list' }, tasks.map((t) => {
      const overdue = t.dueDate && new Date(t.dueDate) < startOfToday();
      const box = h('input', { type: 'checkbox' });
      box.addEventListener('change', async () => {
        const r = await store.updateTask(t.id, { done: true });
        if (!r.ok) { toast(r.error || 'Could not update.', 'warn'); box.checked = false; return; }
        loadTasks();
      });
      return h('li', { class: 'task-row' }, [
        box,
        h('div', { class: 'min-w-0 flex-1' }, [
          h('div', { class: 'task-title', text: t.title }),
          h('div', { class: 'task-meta' }, [
            t.dueDate ? h('span', { class: overdue ? 'dt-date-overdue' : '', text: formatDate(new Date(t.dueDate)) }) : h('span', { class: 'dt-muted', text: 'No date' }),
            t.contactName ? h('span', { text: ` · ${t.contactName}` }) : null,
            t.owner ? h('span', { class: 'dt-muted', text: ` · ${t.owner}` }) : null,
          ]),
        ]),
      ]);
    })));
    refreshIcons(tasksHost);
  }

  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  function update(state) {
    currentState = state;
    if (state.status === 'loading') { weeks.setState('loading'); table.setState('loading'); return; }
    if (state.status === 'error') {
      weeks.setState('error', { message: state.error });
      table.setState('error', { message: state.error });
      return;
    }
    filterBar.setData(state.contacts);
    refresh();
    loadTasks();
  }

  return {
    update,
    destroy() {
      container.parentElement?.classList.remove('view--fill');
      weeks.destroy();
      table.destroy();
    },
  };
}
