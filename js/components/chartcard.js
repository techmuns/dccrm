/**
 * components/chartcard.js — a card that holds one ECharts chart plus the shared
 * HTML legend, with the two kept in sync (hovering either highlights the other).
 * Extracted so the Contacts and Follow-ups tabs draw charts the same way the
 * Overview tab does, without duplicating the wiring in each tab.
 */
import { card, legend, footnote, h } from '../ui.js';
import { mountChart } from '../charts.js';
import { formatNumber, formatPercent } from '../util.js';

export function createChartCard({ title, subtitle, iconName, accent, chartClass = '', className = '' }) {
  const widget = card({ title, subtitle, iconName, accent, className: `chart-card ${className}` });
  const plot = h('div', { class: `chart ${chartClass}` });
  const legendHost = h('div', { class: 'legend-host' });
  const noteHost = h('div', {});
  widget.content.append(plot, legendHost, noteHost);

  const subEl = widget.head.querySelector('.t-caption');
  let chart = null;
  const ensure = () => (chart ||= mountChart(plot));

  function markLegend(list, name, on) {
    for (const item of list.children) {
      if (item.dataset.name === name) item.classList.toggle('legend-item--active', on);
    }
  }

  return {
    el: widget.el,
    setState: widget.setState,
    setSubtitle(text) { if (subEl) subEl.textContent = text; },
    draw(option, items, { showShare = false, valueLabel = 'People', segmented = false, showLegendValue = true } = {}) {
      widget.setState('ready');
      const inst = ensure();
      const total = items.reduce((s, i) => s + i.value, 0);
      inst.setOption(option, { names: items.map((i) => i.name) });

      const entries = items.map((i) => ({
        name: i.name, value: i.value, color: i.color,
        shareLabel: showShare ? formatPercent(i.value, total) : '',
        hint: i.members?.length
          ? `${i.name}: ${formatNumber(i.value)} — ${i.members.join(', ')}`
          : `${i.name}: ${formatNumber(i.value)} ${valueLabel.toLowerCase()}`,
      }));

      const list = legend(entries, {
        showShare, showValue: showLegendValue,
        onHover: (name, on) => {
          if (segmented) {
            inst.instance.dispatchAction({ type: on ? 'highlight' : 'downplay', seriesName: name });
          } else {
            inst.highlight(name, on);
          }
          markLegend(list, name, on);
        },
      });
      legendHost.replaceChildren(list);
      if (segmented) {
        inst.instance.on('mouseover', (p) => markLegend(list, p.seriesName, true));
        inst.instance.on('mouseout', (p) => markLegend(list, p.seriesName, false));
      } else {
        inst.onHover((name, on) => markLegend(list, name, on));
      }
      inst.instance.resize();
    },
    note(html) { noteHost.replaceChildren(...(html ? [footnote(html)] : [])); },
    destroy() { chart?.dispose(); chart = null; },
  };
}
