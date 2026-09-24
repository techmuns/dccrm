/**
 * tabs/overview.js — the Overview tab.
 *
 * Four honest numbers, then four charts. Nothing here knows where the data came
 * from; it reads the store's snapshot and draws. Written as a normal tab module so
 * Contacts, Follow-ups, Campaigns and AI Insights can follow the same shape.
 */
import { PALETTE, STAGE_DORMANT } from '../config.js';
import { card, statTile, legend, footnote, h, icon, refreshIcons } from '../ui.js';
import { mountChart, funnelOption, donutOption, hbarOption, barOption } from '../charts.js';
import { headlineNumbers, pipelineStages, series } from '../data.js';
import { formatNumber, formatPercent, escapeHtml } from '../util.js';
import { setQuery } from '../store.js';
import { createUpdatePanel } from '../ai/updatebox.js';
import { createAskPanel } from '../ai/askbox.js';
import { createPrioritiesPanel } from '../ai/priorities.js';

/** One chart card: a card, a chart that fills the space, and a legend under it. */
function chartCard({ title, subtitle, iconName, accent, chartClass = '' }) {
  const plot = h('div', { class: `chart ${chartClass}` });
  const legendHost = h('div', { class: 'legend-host' });
  const noteHost = h('div');

  const widget = card({ title, subtitle, iconName, accent });
  widget.content.append(plot, legendHost, noteHost);

  let chart = null;
  const ensureChart = () => (chart ||= mountChart(plot));

  return {
    el: widget.el,
    setState: widget.setState,
    /** Draw the chart and its legend together, so the two never disagree. */
    draw(option, items, { showShare = false, valueLabel } = {}) {
      widget.setState('ready');
      const instance = ensureChart();
      instance.setOption(option, { names: items.map((item) => item.name) });

      const entries = items.map((item) => ({
        name: item.name,
        value: item.value,
        color: item.color,
        shareLabel: showShare ? formatPercent(item.value, items.reduce((s, i) => s + i.value, 0)) : '',
        hint: item.members?.length
          ? `${item.name}: ${formatNumber(item.value)} — ${item.members.join(', ')}`
          : `${item.name}: ${formatNumber(item.value)}${valueLabel ? ' ' + valueLabel.toLowerCase() : ''}`,
      }));

      const list = legend(entries, {
        showShare,
        onHover: (name, on) => {
          instance.highlight(name, on);
          markLegend(list, name, on);
        },
      });
      legendHost.replaceChildren(list);
      instance.onHover((name, on) => markLegend(list, name, on));
      instance.instance.resize();
    },
    note(html) {
      noteHost.replaceChildren(...(html ? [footnote(html)] : []));
    },
    destroy() {
      chart?.dispose();
      chart = null;
    },
  };
}

function markLegend(list, name, on) {
  for (const item of list.children) {
    if (item.dataset.name === name) item.classList.toggle('legend-item--active', on);
  }
}

export function render(container) {
  /* ---- filter bar (only appears while a search is running) ---- */
  const filterBar = h('div', { class: 'filter-bar hidden' });

  /* ---- the four numbers ---- */
  const tiles = {
    total: statTile({
      label: 'Total contacts',
      hint: 'Everyone in the list, including people we have not reached out to yet.',
      iconName: 'users', accent: PALETTE[0],
    }),
    active: statTile({
      label: 'In active conversation',
      hint: 'People at Network, Qualified, In Diligence, Committed or Hot.',
      iconName: 'messages-square', accent: PALETTE[1],
    }),
    funded: statTile({
      label: 'Funded investors',
      hint: 'People at the Funded stage — money is in.',
      iconName: 'circle-check-big', accent: PALETTE[2],
    }),
    due: statTile({
      label: 'Follow-ups due this week',
      hint: 'Contacts whose next action date falls within the next 7 days.',
      iconName: 'calendar-clock', accent: PALETTE[3],
    }),
  };

  const tileRow = h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4' },
    Object.values(tiles).map((tile) => tile.el));

  /* ---- the four charts ---- */
  const funnel = chartCard({
    title: 'Where everyone is in the pipeline',
    subtitle: 'From people we have not contacted yet, through to investors who are on board.',
    iconName: 'filter', accent: PALETTE[0], chartClass: 'chart--funnel',
  });

  const types = chartCard({
    title: 'What kind of investors these are',
    subtitle: 'Each slice is a type of institution or individual.',
    iconName: 'chart-pie', accent: PALETTE[5], chartClass: 'chart--donut',
  });

  const countries = chartCard({
    title: 'Where they are based',
    subtitle: 'The ten countries with the most contacts.',
    iconName: 'globe', accent: PALETTE[2], chartClass: 'chart--hbar',
  });

  const sources = chartCard({
    title: 'How we first found them',
    subtitle: 'The channel each relationship started through.',
    iconName: 'route', accent: PALETTE[3], chartClass: 'chart--bar',
  });

  const grid = h('div', { class: 'grid grid-cols-1 lg:grid-cols-12 gap-4' }, [
    h('div', { class: 'lg:col-span-7 flex' }, [funnel.el]),
    h('div', { class: 'lg:col-span-5 flex' }, [types.el]),
    h('div', { class: 'lg:col-span-7 flex' }, [countries.el]),
    h('div', { class: 'lg:col-span-5 flex' }, [sources.el]),
  ]);

  /* ---- the intelligence layer (Phase 3): update box, ask box, priorities ---- */
  const updatePanel = createUpdatePanel();
  const askPanel = createAskPanel();
  const askCard = h('section', { class: 'card' }, [
    h('div', { class: 'card-head' }, [
      h('span', { class: 'card-icon', style: '--accent:#8b5cf6' }, [icon('sparkles', 'size-[18px]')]),
      h('div', { class: 'min-w-0 flex-1' }, [
        h('h2', { class: 't-title', text: 'Ask' }),
        h('p', { class: 't-caption mt-0.5', text: 'Plain-English questions about your investors.' }),
      ]),
    ]),
    h('div', { class: 'card-body' }, [askPanel.el]),
  ]);
  const aiTop = h('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-4' }, [updatePanel.el, askCard]);
  const priorities = createPrioritiesPanel();

  container.append(filterBar, aiTop, tileRow, grid, priorities.el);
  refreshIcons(container);

  const widgets = [funnel, types, countries, sources];
  const allTiles = Object.values(tiles);

  /* ---- states ---- */

  function showFilterBar(state) {
    if (!state.query || state.status !== 'ready') {
      filterBar.classList.add('hidden');
      filterBar.replaceChildren();
      return;
    }
    filterBar.classList.remove('hidden');
    filterBar.replaceChildren(
      icon('search', 'size-4 text-indigo-500 shrink-0'),
      h('p', {
        class: 't-body text-slate-600',
        html: `Showing <b class="text-slate-900">${formatNumber(state.visible.length)}</b> of ${formatNumber(state.contacts.length)} people matching <b class="text-slate-900">&ldquo;${escapeHtml(state.query)}&rdquo;</b>`,
      }),
      h('button', {
        class: 'filter-clear', type: 'button', text: 'Clear search',
        onClick: () => setQuery(''),
      }),
    );
    refreshIcons(filterBar);
  }

  function setAll(state, options) {
    for (const tile of allTiles) tile.setState(state === 'ready' ? 'ready' : state);
    for (const widget of widgets) {
      widget.setState(state, options);
      widget.note('');
    }
  }

  function update(state) {
    showFilterBar(state);
    priorities.update(state);
    aiTop.classList.toggle('hidden', state.mode === 'preview');   // AI needs the live database

    if (state.status === 'loading') return setAll('loading');
    if (state.status === 'error') return setAll('error', { message: state.error });

    const rows = state.visible;
    if (!rows.length) {
      const message = state.query
        ? `No one matches “${state.query}”. Try a different name, city or stage.`
        : 'No data yet — upload your sheet';
      for (const tile of allTiles) tile.set(0);
      for (const widget of widgets) {
        widget.setState('empty', { message });
        widget.note('');
      }
      return;
    }

    /* numbers */
    const numbers = headlineNumbers(rows);
    tiles.total.set(numbers.total, state.query ? 'Matching your search' : 'Everyone on the list');
    tiles.active.set(numbers.active, `${formatPercent(numbers.active, numbers.total)} of everyone`);
    tiles.funded.set(numbers.funded, `${formatPercent(numbers.funded, numbers.total)} of everyone`);
    tiles.due.set(
      numbers.dueThisWeek,
      numbers.overdue ? `${formatNumber(numbers.overdue)} more are already past due` : 'Nothing is past due',
    );

    /* pipeline funnel */
    const pipeline = pipelineStages(rows);
    const stagesWithPeople = pipeline.stages.filter((stage) => stage.value > 0);
    if (!stagesWithPeople.length) {
      funnel.setState('empty', { message: 'No stages are filled in for these contacts yet.' });
    } else {
      funnel.draw(funnelOption(pipeline.stages), pipeline.stages, { valueLabel: 'People' });
      const outParts = [];
      if (pipeline.hot) outParts.push(`${formatNumber(pipeline.hot)} Hot (priority)`);
      if (pipeline.dormant) outParts.push(`${formatNumber(pipeline.dormant)} Dormant (parked)`);
      if (pipeline.otherTotal) outParts.push(`${formatNumber(pipeline.otherTotal)} in ${escapeHtml(pipeline.otherNames.join(', '))}`);
      funnel.note(outParts.length ? `Outside the funnel: ${outParts.join(' · ')}.` : '');
    }

    /* investors by type */
    const byType = series(rows, 'entityType', { foldOther: true });
    if (!byType.data.length) {
      types.setState('empty', { message: 'No investor types are filled in for these contacts.' });
    } else {
      types.draw(
        donutOption(byType.data, { centerValue: formatNumber(byType.total), centerLabel: 'contacts' }),
        byType.data,
        { showShare: true, valueLabel: 'Investors' },
      );
      const other = byType.data.find((item) => item.name === 'Other');
      types.note(other ? `“Other” groups the ${other.members.length} smallest types: ${escapeHtml(other.members.join(', '))}.` : '');
    }

    /* top countries */
    const byCountry = series(rows, 'country', { limit: 10 });
    if (!byCountry.data.length) {
      countries.setState('empty', { message: 'No countries are filled in for these contacts.' });
    } else {
      countries.draw(hbarOption(byCountry.data, { valueLabel: 'People' }), byCountry.data, { valueLabel: 'People' });
      countries.note(byCountry.hiddenCount
        ? `${formatNumber(byCountry.hiddenCount)} smaller ${byCountry.hiddenCount === 1 ? 'country is' : 'countries are'} not shown.`
        : '');
    }

    /* by source */
    const bySource = series(rows, 'source', { limit: 10 });
    if (!bySource.data.length) {
      sources.setState('empty', { message: 'No sources are filled in for these contacts.' });
    } else {
      sources.draw(barOption(bySource.data, { valueLabel: 'People' }), bySource.data, { valueLabel: 'People' });
      sources.note(bySource.hiddenCount ? `${formatNumber(bySource.hiddenCount)} smaller channels are not shown.` : '');
    }

    refreshIcons(container);
  }

  return {
    update,
    destroy() {
      for (const widget of widgets) widget.destroy();
    },
  };
}
