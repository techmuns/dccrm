/**
 * components/timeline.js — the full relationship history for one contact.
 *
 * Opens a wide modal that unifies everything already stored in D1 for the contact into
 * one vertical timeline: memory / notes and other logged activities, stage changes,
 * completed follow-up tasks, and inbound email replies. It NEVER invents history — every
 * card is a real row from the activities / tasks / replies tables, read through the same
 * store.getContactDetail the drawer already uses. The email (in / out) card + colour are
 * wired here so a future real-email feed drops straight in; nothing fetches email now.
 */
import { h, icon, refreshIcons } from '../ui.js';
import { openModal } from './modal.js';
import { formatDate, relativeDay, parseDate, tidy, formatNumber } from '../util.js';
import * as store from '../store.js';

/* kind → colour + fallback icon + label. Colours follow the app's tokens:
   note = platinum · stage = rose · task = amber · email-in = slate · email-out = jade. */
const KIND = {
  note: { color: '#9a9aa0', icon: 'sticky-note', label: 'Note' },
  stage: { color: '#a83a5b', icon: 'git-branch', label: 'Stage change' },
  task: { color: '#c08a2e', icon: 'circle-check-big', label: 'Task' },
  'email-in': { color: '#4c6ea5', icon: 'mail', label: 'Email in' },
  'email-out': { color: '#2e8b74', icon: 'send', label: 'Email out' },
};

/* per activity-type icon (all of these fall under the "Notes" filter bar the stage/email ones). */
const ACT_ICON = { Note: 'sticky-note', Call: 'phone', Email: 'send', Meeting: 'users', WhatsApp: 'message-circle', 'Stage change': 'git-branch', Other: 'circle-dot' };

/* filter chips → which kinds each one keeps (null = everything). */
const FILTERS = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'notes', label: 'Notes', kinds: ['note'] },
  { key: 'stage', label: 'Stage changes', kinds: ['stage'] },
  { key: 'tasks', label: 'Tasks', kinds: ['task'] },
  { key: 'emails', label: 'Emails', kinds: ['email-in', 'email-out'] },
];

/** A logged activity's kind: stage changes and emails split out; everything else is a "note". */
function kindForActivity(type) {
  if (type === 'Stage change') return 'stage';
  if (type === 'Email') return 'email-out';   // a manually-logged email is an outbound touch
  return 'note';                              // Note · Call · Meeting · WhatsApp · Other
}

/** Turn the raw detail (activities + replies + tasks) into one flat, grounded event list. */
function buildEvents(detail) {
  const events = [];

  for (const a of detail.activities || []) {
    const kind = kindForActivity(a.type);
    let title = a.type || 'Note';
    let body = a.summary || '';
    if (kind === 'stage') { title = 'Stage change'; body = String(a.summary || '').replace(/^Stage:\s*/i, ''); }
    events.push({
      kind,
      when: parseDate(a.occurredAt) || parseDate(a.createdAt),
      iconName: ACT_ICON[a.type] || KIND[kind].icon,
      title, body,
      source: tidy(a.source) || (kind === 'stage' ? 'Manual' : ''),
      isTouch: kind !== 'stage',
    });
  }

  // Inbound email replies (Feature 2) are real received emails already in D1 — surfaced,
  // never fetched here. They render with the email-in colour + icon.
  for (const r of detail.replies || []) {
    events.push({
      kind: 'email-in',
      when: parseDate(r.receivedAt) || parseDate(r.createdAt),
      iconName: 'mail',
      title: r.subject ? `Reply: ${r.subject}` : 'Email reply',
      body: tidy(r.summary),
      source: tidy(r.fromName) || tidy(r.fromEmail) || 'Inbound',
      isTouch: true,
    });
  }

  // Completed follow-up tasks, placed at their real completion date (falling back to the
  // due date, then the created date) so they sit honestly in the history.
  for (const t of detail.tasks || []) {
    if (!t.done) continue;
    events.push({
      kind: 'task',
      when: parseDate(t.completedAt) || parseDate(t.dueDate) || parseDate(t.createdAt),
      iconName: 'circle-check-big',
      title: 'Task completed',
      body: t.title || '',
      source: tidy(t.owner) || 'Follow-up',
      isTouch: false,
    });
  }

  return events;
}

/** Sort events by date. Undated events sink to the bottom in both directions. */
function sortEvents(events, newestFirst) {
  const dir = newestFirst ? -1 : 1;
  return events.slice().sort((a, b) => {
    const ta = a.when ? a.when.getTime() : null;
    const tb = b.when ? b.when.getTime() : null;
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return (ta - tb) * dir;
  });
}

/** Rolling last-12-months touch counts, for the mini bar. */
function monthBuckets(events) {
  const nowD = new Date();
  const base = nowD.getFullYear() * 12 + nowD.getMonth();
  const counts = new Array(12).fill(0);
  const labels = [];
  for (let i = 0; i < 12; i += 1) {
    const m = base - 11 + i;
    labels.push(new Date(Math.floor(m / 12), ((m % 12) + 12) % 12, 1));
  }
  for (const e of events) {
    if (!e.isTouch || !e.when) continue;
    const idx = 11 - (base - (e.when.getFullYear() * 12 + e.when.getMonth()));
    if (idx >= 0 && idx < 12) counts[idx] += 1;
  }
  return { counts, labels };
}

/* ---------- rendering ---------- */

function eventCard(e) {
  const meta = KIND[e.kind] || KIND.note;
  return h('li', { class: 'tlm-item' }, [
    h('span', { class: 'tlm-dot', style: `--c:${meta.color}` }, [icon(e.iconName || meta.icon, 'size-3.5')]),
    h('div', { class: 'tlm-card' }, [
      h('div', { class: 'tlm-top' }, [
        h('span', { class: 'tlm-title', text: e.title || meta.label }),
        e.when ? h('span', { class: 'tlm-when', title: formatDate(e.when), text: relativeDay(e.when) }) : null,
      ]),
      e.body ? h('p', { class: 'tlm-body', text: e.body }) : null,
      h('div', { class: 'tlm-metarow' }, [
        h('span', { class: 'tlm-kind', style: `--c:${meta.color}`, text: meta.label }),
        e.when ? h('span', { class: 'tlm-date', text: formatDate(e.when) }) : null,
        e.source ? h('span', { class: 'tlm-source', text: e.source }) : null,
      ]),
    ]),
  ]);
}

function summaryStrip(events, contact) {
  const touches = events.filter((e) => e.isTouch);
  const lastTouch = touches.map((e) => e.when).filter(Boolean).sort((a, b) => b - a)[0]
    || parseDate(contact.lastContact);

  const { counts, labels } = monthBuckets(events);
  const max = Math.max(1, ...counts);
  const bars = counts.map((n, i) => h('div', { class: 'tlm-barcol', title: `${labels[i].toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}: ${n}` }, [
    h('div', { class: `tlm-bar${n ? '' : ' is-zero'}`, style: `height:${n ? Math.max(3, Math.round((n / max) * 30)) : 2}px` }),
    h('span', { class: 'tlm-barlbl', text: labels[i].toLocaleDateString(undefined, { month: 'narrow' }) }),
  ]));

  return h('div', { class: 'tlm-summary' }, [
    h('div', { class: 'tlm-stat' }, [
      h('div', { class: 'tlm-stat-n', text: formatNumber(touches.length) }),
      h('div', { class: 'tlm-stat-l', text: touches.length === 1 ? 'touch' : 'touches' }),
    ]),
    h('div', { class: 'tlm-stat' }, [
      h('div', { class: 'tlm-stat-n tlm-stat-date', text: lastTouch ? formatDate(lastTouch) : '—' }),
      h('div', { class: 'tlm-stat-l', text: 'last contact' }),
    ]),
    h('div', { class: 'tlm-months' }, [
      h('div', { class: 'tlm-months-lbl', text: 'Interactions · last 12 months' }),
      h('div', { class: 'tlm-bars' }, bars),
    ]),
  ]);
}

/**
 * Open the timeline for one contact.
 * @param {object} contact a normalised contact from the store (must have an id to load history).
 */
export function openTimeline(contact) {
  const m = openModal({
    title: contact.fullName || 'Contact timeline',
    iconName: 'history', wide: true,
    subtitle: 'Everything we have on file — newest first.',
  });

  let events = [];
  let filterKey = 'all';
  let newestFirst = true;

  const chipsRow = h('div', { class: 'tlm-chips' });
  const sortBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' },
    [icon('arrow-up-down', 'size-3.5'), h('span', { class: 'tlm-sort-lbl', text: 'Newest first' })]);
  const listHost = h('div', { class: 'tlm-scroll' }, [h('p', { class: 't-caption p-2', text: 'Loading…' })]);
  const summaryHost = h('div', {});

  const controls = h('div', { class: 'tlm-controls' }, [chipsRow, h('div', { class: 'ml-auto' }, [sortBtn])]);
  m.body.replaceChildren(summaryHost, controls, listHost);

  function counts() {
    const c = {};
    for (const f of FILTERS) c[f.key] = f.kinds ? events.filter((e) => f.kinds.includes(e.kind)).length : events.length;
    return c;
  }

  function renderChips() {
    const c = counts();
    chipsRow.replaceChildren(...FILTERS.map((f) => {
      const btn = h('button', {
        class: `tlm-chip${filterKey === f.key ? ' is-on' : ''}`, type: 'button',
        'aria-pressed': String(filterKey === f.key),
      }, [h('span', { text: f.label }), h('span', { class: 'tlm-chip-n', text: String(c[f.key]) })]);
      btn.addEventListener('click', () => { filterKey = f.key; renderChips(); renderList(); });
      return btn;
    }));
  }

  function renderList() {
    const active = FILTERS.find((f) => f.key === filterKey) || FILTERS[0];
    let shown = active.kinds ? events.filter((e) => active.kinds.includes(e.kind)) : events;
    shown = sortEvents(shown, newestFirst);

    if (!events.length) {
      listHost.replaceChildren(h('div', { class: 'tlm-empty' }, [
        icon('history', 'size-6'),
        h('p', { class: 'tlm-empty-t', text: 'No activity yet — updates will appear here.' }),
        h('p', { class: 't-caption', text: 'Notes, stage changes, tasks and emails will build this history.' }),
      ]));
    } else if (!shown.length) {
      listHost.replaceChildren(h('p', { class: 't-caption p-3 text-center', text: `No ${active.label.toLowerCase()} yet.` }));
    } else {
      listHost.replaceChildren(h('ul', { class: 'tlm-list' }, shown.map(eventCard)));
    }
    refreshIcons(listHost);
  }

  sortBtn.addEventListener('click', () => {
    newestFirst = !newestFirst;
    sortBtn.querySelector('.tlm-sort-lbl').textContent = newestFirst ? 'Newest first' : 'Oldest first';
    renderList();
  });

  async function load() {
    const detail = await store.getContactDetail(contact.id);
    events = buildEvents(detail);
    summaryHost.replaceChildren(summaryStrip(events, contact));
    renderChips();
    renderList();
    m.refresh();
  }

  if (contact.id == null) {
    events = [];
    summaryHost.replaceChildren(summaryStrip(events, contact));
    renderChips();
    renderList();
  } else {
    load();
  }
  m.refresh();
  return m;
}
