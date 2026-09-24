/**
 * ai/askbox.js — the plain-English "Ask" box (Phase 3, the read side).
 *
 * The user asks a question in normal words. We send it with the compact book to
 * Bedrock, which returns a short answer plus the ids of the matching contacts. We then
 * render the answer and a REAL table built from the store by id — never from the model's
 * text — so every row shown is a genuine D1 contact you can click through to.
 */
import { h, icon, refreshIcons, toast } from '../ui.js';
import { FIELD_LABELS } from '../config.js';
import { tidy, formatDate, parseDate, formatNumber } from '../util.js';
import { openDrawer } from '../components/drawer.js';
import { openModal } from '../components/modal.js';
import * as store from '../store.js';

const EXAMPLES = [
  'Which family offices in Dubai are hot?',
  'Who is in diligence and not contacted in 30 days?',
  'How many committed, by country?',
  'Show FPIs at the Qualified stage',
];
const label = (f) => FIELD_LABELS[f] || f;
const byId = (id) => store.getState().contacts.find((c) => c.id === id);

function cellText(field, value) {
  if (!tidy(value)) return '—';
  if (field === 'lastContact' || field === 'nextActionDate') { const d = parseDate(value); return d ? formatDate(d) : tidy(value); }
  return tidy(value);
}

/** The reusable Ask panel. Placed inline on Overview / AI Insights, and inside a modal on Contacts. */
export function createAskPanel() {
  const input = h('input', { class: 'field-input ask-input', type: 'text', placeholder: 'Ask about your investors in plain English…' });
  const go = h('button', { class: 'btn btn-primary', type: 'button' }, [icon('sparkles', 'size-4'), h('span', { text: 'Ask' })]);
  const chips = h('div', { class: 'ask-chips' }, EXAMPLES.map((q) => {
    const b = h('button', { class: 'ask-chip', type: 'button', text: q });
    b.addEventListener('click', () => { input.value = q; ask(); });
    return b;
  }));
  const result = h('div', { class: 'ask-result' });
  const el = h('div', { class: 'ask-panel' }, [h('div', { class: 'ask-bar' }, [input, go]), chips, result]);

  go.addEventListener('click', ask);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });

  async function ask() {
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    if (!store.isLive()) { toast('Connect the database to ask questions.', 'warn'); return; }
    result.replaceChildren(h('div', { class: 'ask-loading' }, [icon('loader-circle', 'size-4 animate-spin'), h('span', { text: 'Thinking…' })]));
    refreshIcons(result);
    const res = await store.aiAsk(q);
    if (!res.ok) {
      result.replaceChildren(h('p', { class: 't-caption text-slate-500', text: res.code === 'no-bedrock' ? 'Turn on AI (set BEDROCK_API_KEY) to ask questions.' : (res.error || 'Could not answer that.') }));
      return;
    }
    renderAnswer(res);
  }

  function renderAnswer(res) {
    const contacts = res.contactIds.map(byId).filter(Boolean);
    const kids = [];
    if (res.answer) kids.push(h('p', { class: 'ask-answer', text: res.answer }));
    if (contacts.length) {
      const cols = (res.columns && res.columns.length ? [...res.columns] : ['fullName', 'entityType', 'stage', 'country', 'lastContact']);
      if (!cols.includes('fullName')) cols.unshift('fullName');
      kids.push(buildTable(contacts, cols));
    } else {
      kids.push(h('p', { class: 't-caption text-slate-400', text: 'No investors matched — try rephrasing, or check a name or city.' }));
    }
    result.replaceChildren(...kids);
    refreshIcons(result);
  }

  function buildTable(contacts, cols) {
    const head = h('tr', {}, cols.map((c) => h('th', { text: label(c) })));
    const rows = contacts.slice(0, 300).map((c) => {
      const tr = h('tr', { class: 'ask-row', tabindex: '0' }, cols.map((f) => h('td', { text: cellText(f, c[f]) })));
      tr.addEventListener('click', () => openDrawer(c));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDrawer(c); });
      return tr;
    });
    return h('div', { class: 'ask-table-wrap' }, [
      h('div', { class: 'ask-count', text: `${formatNumber(contacts.length)} ${contacts.length === 1 ? 'match' : 'matches'} · click a row to open` }),
      h('table', { class: 'ask-table' }, [h('thead', {}, [head]), h('tbody', {}, rows)]),
    ]);
  }

  return {
    el,
    focus: () => input.focus(),
    setQuestion(q, run = false) { input.value = q; if (run) ask(); },
  };
}

/** Open the Ask panel in a modal (from the Contacts tab). */
export function openAskModal(prefill = '') {
  const m = openModal({ title: 'Ask about your investors', iconName: 'sparkles', wide: true });
  const panel = createAskPanel();
  m.body.replaceChildren(panel.el);
  m.foot.replaceChildren(h('button', { class: 'btn btn-quiet', type: 'button', text: 'Close', onClick: m.close }));
  m.refresh();
  if (prefill) panel.setQuestion(prefill, true);
  requestAnimationFrame(() => panel.focus());
}
