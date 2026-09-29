/**
 * ai/needs.js — the dashboard "Needs attention" list (Phase 10, soft-required rules).
 *
 * Active records (not closed, not dormant) missing an Owner or a Next step. These are
 * FLAGGED, never blocked — imported rows are sparse — so this is a grounded nudge list
 * computed straight from real data. Every row opens the real contact to fix it.
 */
import { h, icon, refreshIcons, card } from '../ui.js';
import { openDrawer } from '../components/drawer.js';
import { needsAttention, needsAttentionReasons } from '../data.js';

const CAP = 12;

export function createNeedsPanel() {
  const widget = card({
    title: 'Needs attention',
    subtitle: 'Active records missing an Owner or a Next step — fill these in to keep the pipeline clean.',
    iconName: 'triangle-alert', accent: '#c0392b',
  });
  const host = h('div', { class: 'needs-host' });
  widget.content.append(host);

  function render(list) {
    const head = h('p', { class: 't-caption needs-count', text: `${list.length} active ${list.length === 1 ? 'record needs' : 'records need'} an owner or a next step.` });
    const rows = list.slice(0, CAP).map((c) => {
      const missing = needsAttentionReasons(c);
      return h('button', { class: 'needs-row', type: 'button', title: 'Open profile', onClick: () => openDrawer(c) }, [
        h('div', { class: 'needs-main' }, [
          h('span', { class: 'nm', text: c.fullName || 'Unnamed' }),
          h('span', { class: 'sub', text: [c.organisation, c.stage].filter(Boolean).join(' · ') || '—' }),
        ]),
        h('div', { class: 'needs-tags' }, missing.map((m) => h('span', { class: 'needs-tag' }, [icon('triangle-alert', 'size-3'), h('span', { text: m })]))),
      ]);
    });
    const more = list.length > CAP ? h('p', { class: 't-caption needs-more', text: `+ ${list.length - CAP} more not shown` }) : null;
    host.replaceChildren(...[head, ...rows, more].filter(Boolean));
    refreshIcons(host);
  }

  function update(state) {
    if (!state || state.status === 'loading') { widget.setState('loading'); return; }
    if (state.status === 'error') { widget.setState('error', { message: state.error }); return; }
    if (state.mode === 'preview') { widget.el.classList.add('hidden'); return; }
    widget.el.classList.remove('hidden');
    const list = needsAttention(state.contacts || []);
    if (!list.length) {
      widget.setState('empty', { message: 'Every active record has an owner and a next step — nicely kept.' });
      return;
    }
    widget.setState('ready');
    render(list);
  }

  return { el: widget.el, update };
}
