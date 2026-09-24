/**
 * ai/priorities.js — "This week's priorities" (Phase 3, the output side).
 *
 * The LIST is computed purely from real dates in the store, so it is always correct:
 *   • Overdue        — next action date is in the past
 *   • Gone quiet     — in an active stage, last contact older than QUIET_DAYS (or never)
 *   • Hot, no action — stage Hot with no next action date
 *   • High value     — top tier / high priority with no last contact on record
 * Every row is a real contact you can open or draft to. The AI is optional: a button
 * adds a one-line "why now" per row, and the panel works fully without it.
 */
import { h, icon, refreshIcons, toast, card } from '../ui.js';
import { ACTIVE_STAGES, STAGE_HOT, PALETTE } from '../config.js';
import { daysFromToday, formatDate, tidy, formatNumber } from '../util.js';
import { openDrawer } from '../components/drawer.js';
import * as store from '../store.js';

export const QUIET_DAYS = 30;   // "gone quiet" threshold (a single constant, as asked)
const CAP = 15;

const REASON = {
  overdue: { label: 'Overdue', color: '#ef4444', icon: 'alarm-clock-off' },
  hot: { label: 'Hot', color: '#ec4899', icon: 'flame' },
  quiet: { label: 'Gone quiet', color: '#f59e0b', icon: 'clock' },
  high: { label: 'High value', color: '#4f46e5', icon: 'star' },
};

const isHigh = (c) => /^a$/i.test(tidy(c.tier)) || /^(high|p1|1)$/i.test(tidy(c.priority));

/** Build the ranked, de-duplicated priority list from real data. */
function computeItems(contacts) {
  const items = [];
  const seen = new Set();
  const add = (c, reasonType, why, suggest, urgency) => {
    if (seen.has(c.id)) return;                     // one row per contact — most urgent reason wins
    seen.add(c.id);
    items.push({ contact: c, reasonType, why, suggest, urgency });
  };
  for (const c of contacts) {                        // 1. overdue (most overdue first)
    const d = daysFromToday(c.nextActionAt);
    if (d != null && d < 0) add(c, 'overdue', `Overdue by ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'}`, tidy(c.nextAction) || 'Do the next action now', 1000 + Math.abs(d));
  }
  for (const c of contacts) {                        // 2. hot, no next step
    if (c.stage === STAGE_HOT && !tidy(c.nextActionDate)) add(c, 'hot', 'Hot, but no next step set', 'Set a next step — keep the momentum', 900);
  }
  for (const c of contacts) {                        // 3. gone quiet
    if (!ACTIVE_STAGES.includes(c.stage)) continue;
    const since = daysFromToday(c.lastContactAt);
    if (since == null) add(c, 'quiet', `In ${c.stage}, no contact on record`, 'Reach out — re-open the conversation', 700);
    else if (since < -QUIET_DAYS) add(c, 'quiet', `No contact in ${Math.abs(since)} days`, 'Re-engage — it has gone quiet', 700 + Math.min(Math.abs(since), 200));
  }
  for (const c of contacts) {                        // 4. high value, never contacted
    if (isHigh(c) && !tidy(c.lastContact)) add(c, 'high', `${/^a$/i.test(tidy(c.tier)) ? 'Top tier' : 'High priority'}, never contacted`, 'Make first contact', 500);
  }
  items.sort((a, b) => b.urgency - a.urgency);
  return items.slice(0, CAP);
}

export function createPrioritiesPanel() {
  const widget = card({
    title: "This week's priorities",
    subtitle: 'Who needs attention now — straight from your real dates.',
    iconName: 'list-todo', accent: PALETTE[3],
  });
  const host = h('div', { class: 'prio-host' });
  const whyBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('sparkles', 'size-3.5'), h('span', { text: 'Add AI “why now”' })]);
  widget.content.append(host);
  // put the why-now button into the card header actions area
  widget.head.append(h('div', { class: 'ml-auto' }, [whyBtn]));

  let items = [];
  const whyEls = new Map();   // contactId -> the "why now" line element

  whyBtn.addEventListener('click', async () => {
    if (!items.length) return;
    if (!store.isLive()) { toast('Connect the database to use AI.', 'warn'); return; }
    whyBtn.disabled = true;
    whyBtn.replaceChildren(icon('loader-circle', 'size-3.5 animate-spin'), h('span', { text: 'Thinking…' }));
    refreshIcons(whyBtn);
    const payload = items.map((it) => ({
      id: it.contact.id, fullName: it.contact.fullName, stage: it.contact.stage,
      reason: it.why, lastContact: it.contact.lastContact, nextActionDate: it.contact.nextActionDate,
    }));
    const { whys } = await store.aiWhy(payload);
    whyBtn.disabled = false;
    whyBtn.replaceChildren(icon('sparkles', 'size-3.5'), h('span', { text: 'Refresh AI “why now”' }));
    refreshIcons(whyBtn);
    if (!whys || !Object.keys(whys).length) { toast('AI could not add notes right now.', 'warn'); return; }
    for (const [id, line] of Object.entries(whys)) {
      const el = whyEls.get(Number(id));
      if (el) { el.textContent = line; el.classList.remove('hidden'); }
    }
  });

  function render() {
    whyEls.clear();
    const rows = items.map((it) => {
      const c = it.contact;
      const meta = REASON[it.reasonType];
      const whyNow = h('div', { class: 'prio-why-now hidden' });
      whyEls.set(c.id, whyNow);
      const openBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button', title: 'Open profile', onClick: () => openDrawer(c) }, [icon('user-round', 'size-3.5')]);
      const draftBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button', title: 'Draft a message', onClick: () => openDrawer(c, { draft: true }) }, [icon('pen-line', 'size-3.5')]);
      return h('tr', { class: 'prio-row' }, [
        h('td', {}, [
          h('button', { class: 'prio-name', type: 'button', onClick: () => openDrawer(c) }, [
            h('span', { class: 'nm', text: c.fullName || 'Unnamed' }),
            h('span', { class: 'sub', text: c.organisation || c.entityType || '—' }),
          ]),
        ]),
        h('td', {}, [
          h('span', { class: 'prio-chip', style: `--c:${meta.color}` }, [icon(meta.icon, 'size-3'), h('span', { text: meta.label })]),
          h('div', { class: 'prio-why', text: it.why }),
          whyNow,
        ]),
        h('td', { class: 'prio-suggest', text: it.suggest }),
        h('td', { class: 'prio-actions' }, [openBtn, draftBtn]),
      ]);
    });
    host.replaceChildren(h('table', { class: 'prio-table' }, [
      h('thead', {}, [h('tr', {}, ['Contact', 'Why', 'Suggested next step', ''].map((t) => h('th', { text: t })))]),
      h('tbody', {}, rows),
    ]));
    refreshIcons(host);
  }

  function update(state) {
    if (!state || state.status === 'loading') { widget.setState('loading'); return; }
    if (state.status === 'error') { widget.setState('error', { message: state.error }); return; }
    items = computeItems(state.contacts || []);
    whyBtn.style.display = items.length && store.isLive() ? '' : 'none';
    if (!items.length) {
      widget.setState('empty', { message: 'Nothing needs attention right now — you’re on top of it.' });
      return;
    }
    widget.setState('ready');
    render();
  }

  return { el: widget.el, update };
}
