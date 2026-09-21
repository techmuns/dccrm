/**
 * tabs/campaigns.js — email outreach performance (sample data for now).
 *
 * A list of campaigns (shared DataTable) with an inline funnel per row; selecting
 * one shows its funnel Sent → Replied, a "who replied" split with a jump to the
 * non-repliers in Contacts, and an engagement-over-time line. Reuses the Phase 1/2
 * design system, charts and table; the data comes from campaigns.js so a live
 * source can replace the sample without touching this file.
 */
import { PALETTE } from '../config.js';
import { card, legend, h, icon, refreshIcons } from '../ui.js';
import { mountChart, funnelOption, donutOption, lineOption } from '../charts.js';
import { formatNumber, formatPercent, formatDate } from '../util.js';
import { campaignsSource, trendSeries, segmentColor, FUNNEL_STAGES } from '../campaigns.js';
import { createChartCard } from '../components/chartcard.js';
import { mountDataTable } from '../components/datatable.js';
import { createSourceNote, readTabularFile } from '../components/source-note.js';
import { goToContacts } from '../nav.js';
import { hasOwnColor } from '../colors.js';

/* the compact inline funnel shown in each table row */
function funnelCell(c) {
  const items = [
    { k: 'Deliv', v: c.rates.delivered, color: PALETTE[1] },
    { k: 'Open', v: c.rates.opened, color: PALETTE[5] },
    { k: 'Click', v: c.rates.clicked, color: PALETTE[3], opt: true },
    { k: 'Reply', v: c.rates.replied, color: PALETTE[2] },
  ];
  return h('div', { class: 'cfunnel' }, items.map((it) =>
    h('div', { class: `cfunnel-item${it.opt ? ' opt' : ''}` }, [
      h('div', { class: 'cfunnel-top' }, [
        h('span', { class: 'cfunnel-k', text: it.k }),
        h('span', { class: 'cfunnel-v', text: formatPercent(Math.round(it.v * 100), 100) }),
      ]),
      h('div', { class: 'cfunnel-bar' }, [
        h('div', { class: 'cfunnel-fill', style: `width:${Math.max(3, it.v * 100)}%;background:${it.color}` }),
      ]),
    ])));
}

export function render(container) {
  container.classList.add('tab-panel--fill');
  container.parentElement?.classList.add('view--fill');

  const note = createSourceNote({ source: campaignsSource, accept: '.json,.csv,.xlsx,.xls', readFile: readTabularFile, noun: 'campaigns' });

  /* selected-campaign funnel */
  const funnel = createChartCard({
    title: 'Campaign funnel', subtitle: 'Select a campaign below.',
    iconName: 'filter', accent: PALETTE[0], chartClass: 'chart--mini-donut',
  });

  /* who replied split + jump */
  const splitPlot = h('div', { class: 'chart chart--mini-donut' });
  const splitCounts = h('div', { class: 'mt-1' });
  const seeBtn = h('button', { class: 'btn btn-quiet w-full mt-3', type: 'button' },
    [icon('users', 'size-4'), h('span', { text: 'See the non-repliers' })]);
  const splitCard = card({ title: 'Who replied', subtitle: 'Of everyone we emailed.', iconName: 'reply', accent: PALETTE[2] });
  splitCard.content.append(splitPlot, splitCounts, seeBtn);
  let splitChart = null;

  /* engagement trend */
  const trendPlot = h('div', { class: 'chart chart--weeks' });
  const trendLegend = h('div', { class: 'legend-host' });
  const trendCard = card({ title: 'Engagement over time', subtitle: 'Open rate and reply rate across campaigns.', iconName: 'trending-up', accent: PALETTE[5] });
  trendCard.content.append(trendPlot, trendLegend);
  let trendChart = null;

  const topGrid = h('div', { class: 'grid grid-cols-1 lg:grid-cols-12 gap-4' }, [
    h('div', { class: 'lg:col-span-5 flex' }, [funnel.el]),
    h('div', { class: 'lg:col-span-3 flex' }, [splitCard.el]),
    h('div', { class: 'lg:col-span-4 flex' }, [trendCard.el]),
  ]);

  /* campaign list */
  const columns = [
    { key: 'name', label: 'Campaign', cellClass: 'col-name dt-name', defaultSortDir: 'asc',
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) => h('div', { class: 'min-w-0' }, [
        h('div', { class: 'nm', text: r.name }),
        h('div', { class: 'sub', text: r.sentAt ? formatDate(r.sentAt) : r.sentDate }),
      ]) },
    { key: 'segment', label: 'Segment', cellClass: 'col-type',
      sortValue: (r) => r.segment, render: (r) => h('span', { class: 'cat-chip', style: `--c:${segmentColor(r.segment)}` },
        [h('span', { class: 'dot' }), h('span', { class: 'lbl', text: r.segment })]) },
    { key: 'recipients', label: 'Emailed', cellClass: 'col-owner', align: 'right', defaultSortDir: 'desc',
      sortValue: (r) => r.recipients, render: (r) => h('span', { class: 'num', text: formatNumber(r.recipients) }) },
    { key: 'funnel', label: 'Delivered · Opened · Clicked · Replied', cellClass: 'col-action', sortable: false,
      render: funnelCell },
  ];

  const tableHost = h('div', { class: 'flex flex-1 min-h-0' });
  const table = mountDataTable(tableHost, {
    columns, onRowClick: selectCampaign,
    title: 'Campaigns', subtitle: 'Every email send, newest first. Click one to see its funnel.',
    iconName: 'send', accent: PALETTE[0],
    defaultSort: { key: 'name', dir: 'asc' },
    emptyMessage: 'No campaigns to show.',
  });

  container.append(note.el, topGrid, tableHost);
  refreshIcons(container);

  let campaigns = [];
  let selected = null;

  function selectCampaign(c) {
    selected = c;
    /* funnel */
    funnel.setSubtitle(`${c.name} · ${c.segment}`);
    funnel.draw(funnelOption(c.funnel), c.funnel, { valueLabel: 'people' });

    /* reply split donut */
    splitCard.setState('ready');
    const splitData = [
      { name: 'Replied', value: c.repliedCount, color: PALETTE[2] },
      { name: "Didn't reply", value: c.noReplyCount, color: '#cbd5e1' },
    ];
    splitChart ||= mountChart(splitPlot);
    splitChart.setOption(donutOption(splitData, { centerValue: formatPercent(c.repliedCount, c.recipients), centerLabel: 'replied' }), { names: splitData.map((d) => d.name) });
    splitCounts.replaceChildren(legend(splitData.map((d) => ({ ...d, hint: `${d.name}: ${formatNumber(d.value)}` })), { showValue: true }));
    seeBtn.querySelector('span').textContent = `See the ${formatNumber(c.noReplyCount)} non-repliers`;
    refreshIcons(splitCounts);
  }

  seeBtn.addEventListener('click', () => {
    if (!selected) return;
    // A named segment (FPI, Family Office…) filters Contacts to that type; a broad
    // "All investors" send has no single type, so it opens the whole base.
    const seg = selected.segment;
    goToContacts(hasOwnColor('entityType', seg) ? { entityType: [seg] } : {});
  });

  function drawTrend() {
    const t = trendSeries(campaigns);
    trendChart ||= mountChart(trendPlot);
    const series = [
      { name: 'People who opened', color: PALETTE[5], data: t.opened },
      { name: 'People who replied', color: PALETTE[2], data: t.replied },
    ];
    trendChart.setOption(lineOption(t.categories, series, { asPercent: true }), { names: series.map((s) => s.name) });
    const items = series.map((s, i) => ({ name: s.name, value: (i === 0 ? t.opened : t.replied).at(-1), color: s.color, shareLabel: '%', hint: s.name }));
    const list = legend(items.map((it) => ({ ...it, value: it.value })), {
      showValue: true,
      onHover: (name, on) => trendChart.instance.dispatchAction({ type: on ? 'highlight' : 'downplay', seriesName: name }),
    });
    // show latest % suffix
    for (const li of list.children) {
      const v = li.querySelector('.legend-value');
      if (v) v.textContent = v.textContent + '%';
    }
    trendLegend.replaceChildren(list);
  }

  function update() {
    const s = campaignsSource.state;
    note.refresh();
    if (s.status === 'loading') {
      funnel.setState('loading'); splitCard.setState('loading'); trendCard.setState('loading'); table.setState('loading');
      return;
    }
    if (s.status === 'error') {
      funnel.setState('error', { message: s.error }); splitCard.setState('error', { message: s.error });
      trendCard.setState('error', { message: s.error }); table.setState('error', { message: s.error });
      return;
    }
    campaigns = s.data || [];
    if (!campaigns.length) {
      funnel.setState('empty', { message: 'No campaigns yet.' });
      splitCard.setState('empty', { message: 'No campaigns yet.' });
      trendCard.setState('empty', { message: 'No campaigns yet.' });
      table.setRows([]);
      return;
    }
    trendCard.setState('ready');
    drawTrend();
    table.setRows(campaigns);
    // default selection: the most recent campaign
    const mostRecent = [...campaigns].sort((a, b) => (b.sentAt?.getTime() || 0) - (a.sentAt?.getTime() || 0))[0];
    selectCampaign(selected && campaigns.includes(selected) ? selected : mostRecent);
  }

  const unsub = campaignsSource.subscribe(update);
  update();
  if (campaignsSource.state.status === 'loading') campaignsSource.init();

  return {
    update() { /* driven by its own source, not the global store */ },
    destroy() {
      unsub();
      container.parentElement?.classList.remove('view--fill');
      funnel.destroy(); splitChart?.dispose(); trendChart?.dispose(); table.destroy();
    },
  };
}
