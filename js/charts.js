/**
 * charts.js — every chart in the app is built here.
 *
 * House rules, applied by these helpers so no tab has to remember them:
 *  · no axis clutter — no axis lines, no ticks, hairline gridlines at most
 *  · rounded marks, with a 2px surface gap between neighbouring fills
 *  · a rich hover card on every mark
 *  · a legend always, rendered as HTML by ui.js so every value is readable as text
 *  · colours come from the registry, so a category looks the same on every chart
 *
 * The SVG renderer is used on purpose: the text becomes real DOM, so it inherits
 * the page's tabular figures and stays crisp on every screen.
 */
import { SURFACE } from './config.js';
import { withAlpha } from './colors.js';
import { formatNumber, formatPercent, escapeHtml } from './util.js';

const INK = '#475569';
const INK_SOFT = '#94a3b8';
const GRID = '#f1f5f9';
const FONT = "'Inter', system-ui, sans-serif";

const baseText = { fontFamily: FONT, fontSize: 12, color: INK };

/** The hover card. One shape for every chart so hovering always feels the same. */
function hoverCard({ color, title, rows }) {
  const body = rows
    .filter(Boolean)
    .map(({ label, value }) =>
      `<div class="tip-row"><span class="tip-key">${escapeHtml(label)}</span><span class="tip-val">${escapeHtml(String(value))}</span></div>`)
    .join('');
  return (
    `<div class="tip" style="--tip-accent:${color}">` +
      `<div class="tip-head"><span class="tip-dot"></span><span class="tip-title">${escapeHtml(title)}</span></div>` +
      `<div class="tip-rows">${body}</div>` +
    `</div>`
  );
}

const tooltipBase = {
  trigger: 'item',
  appendToBody: true,
  backgroundColor: 'transparent',
  borderWidth: 0,
  padding: 0,
  extraCssText: 'box-shadow:none;',
  textStyle: baseText,
};

/**
 * Put a chart in a container and keep it the right size.
 * Returns { setOption, highlight, clear, dispose, instance }.
 */
export function mountChart(container) {
  const instance = window.echarts.init(container, null, { renderer: 'svg' });
  let nameToIndex = new Map();
  let lastHighlighted = null;

  const observer = new ResizeObserver(() => instance.resize());
  observer.observe(container);

  return {
    instance,
    setOption(option, { names = [] } = {}) {
      nameToIndex = new Map(names.map((name, index) => [name, index]));
      instance.setOption(option, { notMerge: true });
    },
    /** Light up one mark from outside the chart (used by the legend). */
    highlight(name, on) {
      const dataIndex = nameToIndex.get(name);
      if (dataIndex == null) return;
      const series = (instance.getOption().series || []).map((_, index) => index);
      if (on && lastHighlighted != null && lastHighlighted !== dataIndex) {
        instance.dispatchAction({ type: 'downplay', seriesIndex: series, dataIndex: lastHighlighted });
      }
      instance.dispatchAction({ type: on ? 'highlight' : 'downplay', seriesIndex: series, dataIndex });
      lastHighlighted = on ? dataIndex : null;
    },
    /** Tell the page which mark the pointer is on, so the legend can follow along. */
    onHover(handler) {
      instance.on('mouseover', (params) => handler(params.name, true));
      instance.on('mouseout', (params) => handler(params.name, false));
    },
    dispose() {
      observer.disconnect();
      instance.dispose();
    },
  };
}

/* ---------- chart shapes ---------- */

/**
 * Pipeline funnel.
 *
 * Drawn as centred bars rather than ECharts' default trapezoids. A trapezoid
 * interpolates its width between one stage's count and the next, so each stage
 * ends up with two different widths and neither one is the number — it reads as a
 * zigzag the moment the pipeline is not perfectly tapering. One flat bar per
 * stage, centred, keeps the funnel silhouette while every width means exactly one
 * count. Stages stay in pipeline order, because the order is the story.
 *
 * Built from two mirrored halves of one bar; the tooltip is bound to the row, so
 * the whole width of the card is a hover target.
 */
export function funnelOption(items) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const max = Math.max(1, ...items.map((item) => item.value));
  const names = items.map((item) => item.name);

  // A visible floor so a nearly-empty stage can still be seen and hovered. The
  // exact count sits on the bar and in the legend, so the floor hides nothing.
  const halfWidth = (value) => (value > 0 ? Math.max(value, max * 0.05) / 2 : 0);
  const bound = max * 0.58; // symmetric, with room for labels that sit outside

  const labelBase = { fontFamily: FONT, fontSize: 12.5, fontWeight: 600 };

  return {
    animationDuration: 600,
    animationEasing: 'cubicOut',
    grid: { left: 6, right: 6, top: 4, bottom: 4 },
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'none' },
      formatter: (params) => {
        const index = names.indexOf(params[0].axisValue);
        const item = items[index];
        if (!item) return '';
        return hoverCard({
          color: item.color,
          title: item.name,
          rows: [
            { label: 'People', value: formatNumber(item.value) },
            { label: 'Share of everyone', value: formatPercent(item.value, total) },
            { label: 'Step', value: `${index + 1} of ${items.length}` },
          ],
        });
      },
    },
    xAxis: { type: 'value', min: -bound, max: bound, show: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: {
      type: 'category',
      data: names,
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
    },
    series: ['left', 'right'].map((side) => ({
      name: side,
      type: 'bar',
      stack: 'stage',
      barWidth: '58%',
      barMaxWidth: 46,
      itemStyle: { borderRadius: side === 'left' ? [8, 0, 0, 8] : [0, 8, 8, 0] },
      emphasis: { itemStyle: { shadowBlur: 14, shadowColor: 'rgba(15,23,42,.2)' } },
      data: items.map((item) => {
        const roomy = item.value / max >= 0.34;
        return {
          value: side === 'left' ? -halfWidth(item.value) : halfWidth(item.value),
          itemStyle: { color: item.color },
          label: roomy
            // Wide enough: the name ends at the centre line, the count starts there.
            ? side === 'left'
              ? { show: true, position: 'insideRight', distance: 7, color: '#fff', ...labelBase, formatter: item.name }
              : { show: true, position: 'insideLeft', distance: 7, color: 'rgba(255,255,255,.84)', ...labelBase, formatter: formatNumber(item.value) }
            // Too narrow to hold text: both move outside, so nothing is ever clipped.
            : side === 'left'
              ? { show: false }
              : { show: true, position: 'right', distance: 9, color: INK, ...labelBase, formatter: `${item.name}  ${formatNumber(item.value)}` },
        };
      }),
    })),
  };
}

/** Donut for part-to-whole. No slice labels — the legend below carries every value. */
export function donutOption(items, { centerValue, centerLabel } = {}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return {
    animationDuration: 600,
    animationEasing: 'cubicOut',
    tooltip: {
      ...tooltipBase,
      formatter: (p) => hoverCard({
        color: p.color,
        title: p.name,
        rows: [
          { label: 'Investors', value: formatNumber(p.value) },
          { label: 'Share', value: formatPercent(p.value, total) },
          p.data.members?.length ? { label: 'Includes', value: p.data.members.join(', ') } : null,
        ],
      }),
    },
    graphic: centerValue == null ? [] : [{
      type: 'group',
      left: 'center',
      top: 'middle',
      children: [
        { type: 'text', style: { text: String(centerValue), fill: '#0f172a', font: `700 26px ${FONT}`, textAlign: 'center', textVerticalAlign: 'middle' }, top: -10, left: 'center' },
        { type: 'text', style: { text: centerLabel || '', fill: INK_SOFT, font: `500 11px ${FONT}`, textAlign: 'center', textVerticalAlign: 'middle' }, top: 12, left: 'center' },
      ],
    }],
    series: [{
      type: 'pie',
      radius: ['62%', '90%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: false,
      label: { show: false },
      labelLine: { show: false },
      // A 2px ring in the surface colour is the gap between slices, not a border.
      itemStyle: { borderColor: SURFACE, borderWidth: 2, borderRadius: 4 },
      emphasis: {
        scaleSize: 6,
        itemStyle: { shadowBlur: 16, shadowColor: 'rgba(15,23,42,.2)' },
      },
      data: items.map((item) => ({
        name: item.name,
        value: item.value,
        members: item.members || null,
        itemStyle: { color: item.color },
      })),
    }],
  };
}

/** Horizontal bars — the right shape for long category names like country names. */
export function hbarOption(items, { valueLabel = 'People' } = {}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const names = items.map((item) => item.name);
  const max = Math.max(1, ...items.map((item) => item.value));

  return {
    animationDuration: 600,
    animationEasing: 'cubicOut',
    grid: { left: 4, right: 40, top: 4, bottom: 4, containLabel: true },
    // Bound to the row rather than the bar, so the hover target is the full width
    // of the card instead of a 15px-tall mark.
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(148,163,184,.10)' } },
      formatter: (params) => {
        const index = names.indexOf(params[0].axisValue);
        const item = items[index];
        if (!item) return '';
        return hoverCard({
          color: item.color,
          title: item.name,
          rows: [
            { label: valueLabel, value: formatNumber(item.value) },
            { label: 'Share', value: formatPercent(item.value, total) },
            { label: 'Rank', value: `#${index + 1}` },
          ],
        });
      },
    },
    xAxis: {
      type: 'value',
      max: Math.ceil(max * 1.08),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: names,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: INK, fontFamily: FONT, fontSize: 12, width: 132, overflow: 'truncate' },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 15,
      barCategoryGap: '34%',
      itemStyle: { borderRadius: [4, 6, 6, 4] },
      emphasis: { itemStyle: { shadowBlur: 12, shadowColor: 'rgba(15,23,42,.18)' } },
      label: {
        show: true,
        position: 'right',
        distance: 8,
        color: INK,
        fontFamily: FONT,
        fontSize: 12,
        fontWeight: 600,
        formatter: (p) => formatNumber(p.value),
      },
      data: items.map((item) => ({ value: item.value, itemStyle: { color: item.color } })),
    }],
  };
}

/** Vertical rounded bars. Used where there are only a handful of short labels. */
export function barOption(items, { valueLabel = 'People' } = {}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const names = items.map((item) => item.name);

  return {
    animationDuration: 600,
    animationEasing: 'cubicOut',
    grid: { left: 2, right: 2, top: 26, bottom: 2, containLabel: true },
    // Bound to the column, so anywhere above a bar is a hover target.
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(148,163,184,.10)' } },
      formatter: (params) => {
        const index = names.indexOf(params[0].axisValue);
        const item = items[index];
        if (!item) return '';
        return hoverCard({
          color: item.color,
          title: item.name,
          rows: [
            { label: valueLabel, value: formatNumber(item.value) },
            { label: 'Share', value: formatPercent(item.value, total) },
          ],
        });
      },
    },
    xAxis: {
      type: 'category',
      data: names,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: INK,
        fontFamily: FONT,
        fontSize: 11.5,
        interval: 0,
        hideOverlap: true,
        width: 84,
        overflow: 'truncate',
      },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      // The only gridlines in the app: a hairline one shade off the card.
      splitLine: { lineStyle: { color: GRID, width: 1 } },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 46,
      barCategoryGap: '38%',
      itemStyle: { borderRadius: [7, 7, 0, 0] },
      emphasis: { itemStyle: { shadowBlur: 12, shadowColor: 'rgba(15,23,42,.16)' } },
      label: {
        show: true,
        position: 'top',
        distance: 6,
        color: INK,
        fontFamily: FONT,
        fontSize: 12,
        fontWeight: 600,
        formatter: (p) => formatNumber(p.value),
      },
      data: items.map((item) => ({
        value: item.value,
        itemStyle: { color: item.color },
        emphasis: { itemStyle: { color: item.color, shadowColor: withAlpha(item.color, 0.45), shadowBlur: 14 } },
      })),
    }],
  };
}

/**
 * Segmented horizontal bar — one row split into coloured segments (the stage-split
 * centrepiece on the Contacts tab). Each stage is its own stacked series so its
 * colour stays consistent and each segment carries its own hover card. A 2px
 * surface ring between segments reads as a gap, not a border.
 */
export function segmentedBarOption(items) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;

  return {
    animationDuration: 550,
    animationEasing: 'cubicOut',
    grid: { left: 0, right: 0, top: 6, bottom: 6, containLabel: false },
    tooltip: {
      ...tooltipBase,
      formatter: (p) => hoverCard({
        color: p.color,
        title: p.seriesName,
        rows: [
          { label: 'People', value: formatNumber(p.value) },
          { label: 'Share of selection', value: formatPercent(p.value, total) },
        ],
      }),
    },
    xAxis: { type: 'value', max: total, show: false },
    yAxis: { type: 'category', data: [''], show: false },
    series: items.map((item) => ({
      name: item.name,
      type: 'bar',
      stack: 'split',
      barWidth: 34,
      itemStyle: { color: item.color, borderColor: SURFACE, borderWidth: 2, borderRadius: 4 },
      emphasis: { focus: 'series', itemStyle: { shadowBlur: 12, shadowColor: 'rgba(15,23,42,.22)' } },
      label: {
        show: item.value / total >= 0.09,
        position: 'inside',
        formatter: () => formatNumber(item.value),
        color: '#fff',
        fontFamily: FONT,
        fontSize: 12,
        fontWeight: 700,
      },
      data: [item.value],
    })),
  };
}
