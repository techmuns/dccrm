/**
 * tabs/lpbook.js — the LP book (Phase 11).
 *
 * A reporting module over the FUNDED LPs, separate from the sales pipeline. One row per LP
 * (a person with a base Invested record), aggregating their base investment plus any top-ups
 * that also reached Invested. Reporting status, top-up potential and redemption risk are
 * editable here; each row can open the LP or start a top-up. Nothing here feeds the funnel.
 */
import { h, icon, refreshIcons, toast } from '../ui.js';
import { REPORTING_STATUSES, TOPUP_POTENTIAL, REDEMPTION_RISK, LP_COLORS } from '../config.js';
import { lpBook, formatAmount } from '../data.js';
import { formatDate, formatNumber } from '../util.js';
import { openDrawer } from '../components/drawer.js';
import { openTopUpDialog } from '../components/topupdialog.js';
import * as store from '../store.js';

function cardShell({ title, subtitle, iconName, accent }) {
  const caption = h('p', { class: 't-caption mt-0.5', text: subtitle || '' });
  const body = h('div', { class: 'card-body' });
  const head = h('div', { class: 'card-head' }, [
    h('span', { class: 'card-icon', style: `--accent:${accent}` }, [icon(iconName, 'size-[18px]')]),
    h('div', { class: 'min-w-0 flex-1' }, [h('h2', { class: 't-title', text: title }), caption]),
  ]);
  return { el: h('section', { class: 'card' }, [head, body]), body, caption };
}

/** A coloured, editable signal <select> (reporting / potential / risk). */
function sigSelect(dim, value, options, onChange) {
  const sel = h('select', { class: 'cell-edit lp-sig', style: `--c:${LP_COLORS[dim]?.[value] || '#9a9aa0'}` }, [
    h('option', { value: '', text: '—', selected: value ? null : '' }),
    ...options.map((o) => h('option', { value: o, text: o, selected: o === value ? '' : null })),
  ]);
  sel.addEventListener('change', () => {
    sel.style.setProperty('--c', LP_COLORS[dim]?.[sel.value] || '#9a9aa0');
    onChange(sel.value);
  });
  return sel;
}

export function render(container) {
  const shell = cardShell({
    title: 'LP book',
    subtitle: 'Funded LPs — reporting, top-up potential, redemption risk. Separate from the sales pipeline.',
    iconName: 'landmark', accent: '#2e8b74',
  });
  const host = h('div', { class: 'lp-host' });
  shell.body.append(host);
  container.append(shell.el);
  refreshIcons(container);

  let currentState = null;

  async function save(lpId, patch) {
    const r = await store.updateContact(lpId, patch, { optimistic: true, source: 'LP book' });
    if (!r.ok) toast(r.error || 'Could not save that change.', 'warn');
  }

  function rowFor(r) {
    const lp = r.lp;
    const name = h('button', { class: 'lp-name', type: 'button', title: 'Open LP', onClick: () => openDrawer(lp) }, [
      h('span', { class: 'nm', text: lp.fullName || 'Unnamed' }),
      h('span', { class: 'sub', text: [lp.organisation, lp.country].filter(Boolean).join(' · ') || '—' }),
    ]);
    const inv = h('div', { class: 'lp-inv' }, [
      h('span', { class: 'lp-total', text: formatAmount(r.totalInvested) }),
      h('span', { class: 'lp-count', text: `${r.count} investment${r.count === 1 ? '' : 's'}${r.openTopUps ? ` · ${r.openTopUps} in progress` : ''}` }),
    ]);
    const topupBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button', title: 'Add a top-up',
      onClick: () => openTopUpDialog(lp) }, [icon('copy-plus', 'size-3.5'), h('span', { class: 'hidden lg:inline', text: 'Top-up' })]);
    const openBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button', title: 'Open LP', onClick: () => openDrawer(lp) }, [icon('user-round', 'size-3.5')]);
    return h('div', { class: 'lp-row' }, [
      h('div', { class: 'lp-c lp-c-name' }, [name]),
      h('div', { class: 'lp-c lp-c-inv' }, [inv]),
      h('div', { class: 'lp-c lp-c-rep' }, [sigSelect('reportingStatus', r.reportingStatus, REPORTING_STATUSES, (v) => save(lp.id, { reportingStatus: v }))]),
      h('div', { class: 'lp-c lp-c-pot' }, [sigSelect('topUpPotential', r.topUpPotential, TOPUP_POTENTIAL, (v) => save(lp.id, { topUpPotential: v }))]),
      h('div', { class: 'lp-c lp-c-risk' }, [sigSelect('redemptionRisk', r.redemptionRisk, REDEMPTION_RISK, (v) => save(lp.id, { redemptionRisk: v }))]),
      h('div', { class: 'lp-c lp-c-last', text: r.lastActivityAt ? formatDate(r.lastActivityAt) : '—' }),
      h('div', { class: 'lp-c lp-c-act' }, [topupBtn, openBtn]),
    ]);
  }

  function paint() {
    if (!store.isLive()) {
      shell.caption.textContent = 'Funded LPs — separate from the sales pipeline.';
      host.replaceChildren(h('p', { class: 't-caption py-8 text-center', text: 'Connect the database to see the LP book.' }));
      return;
    }
    const rows = lpBook(currentState?.contacts || []);
    shell.caption.textContent = rows.length
      ? `${formatNumber(rows.length)} funded ${rows.length === 1 ? 'LP' : 'LPs'} · not part of the pipeline funnel.`
      : 'Funded LPs — separate from the sales pipeline.';
    if (!rows.length) {
      host.replaceChildren(h('div', { class: 'lp-empty' }, [
        icon('landmark', 'size-6'),
        h('p', { class: 'lp-empty-t', text: 'No LPs on the book yet.' }),
        h('p', { class: 't-caption', text: 'When a record reaches Invested, the investor appears here.' }),
      ]));
      return;
    }
    const header = h('div', { class: 'lp-row lp-head' }, [
      h('div', { class: 'lp-c lp-c-name', text: 'LP' }),
      h('div', { class: 'lp-c lp-c-inv', text: 'Total invested' }),
      h('div', { class: 'lp-c lp-c-rep', text: 'Reporting' }),
      h('div', { class: 'lp-c lp-c-pot', text: 'Top-up potential' }),
      h('div', { class: 'lp-c lp-c-risk', text: 'Redemption risk' }),
      h('div', { class: 'lp-c lp-c-last', text: 'Last activity' }),
      h('div', { class: 'lp-c lp-c-act' }),
    ]);
    host.replaceChildren(h('div', { class: 'lp-table' }, [header, ...rows.map(rowFor)]));
    refreshIcons(host);
  }

  function update(state) {
    currentState = state;
    if (state.status === 'loading') { host.replaceChildren(h('p', { class: 't-caption py-8 text-center', text: 'Loading…' })); return; }
    if (state.status === 'error') { host.replaceChildren(h('p', { class: 't-caption py-8 text-center', text: state.error })); return; }
    paint();
  }

  return { update, destroy() { /* nothing persistent */ } };
}
