/**
 * tabs/followups.js — the follow-up reminders hub: never lose a lead.
 *
 * Lists real reminders (tasks) grouped by urgency — Overdue · Due today · This week ·
 * Upcoming — each with quick actions (✓ done, reschedule, open, AI draft). Below that,
 * SUGGESTED follow-ups computed from real dates (gone quiet / hot with no next step /
 * overdue), which the user can accept to create a reminder. Everything is grounded: every
 * row is a real task or a real contact, and reminders are created/updated through the SAME
 * /api/tasks endpoints the drawer uses. Marking one done stamps it and lands it on the
 * contact's timeline (already wired).
 */
import { h, icon, refreshIcons, toast } from '../ui.js';
import { formatDate, parseDate, daysFromToday, formatNumber } from '../util.js';
import { openDrawer } from '../components/drawer.js';
import { openDraftDialog } from '../components/draftdialog.js';
import { chipCell } from '../components/cells.js';
import { priorityItems } from '../ai/priorities.js';
import { addReminder, dueInDays } from '../cadences.js';
import * as store from '../store.js';

const GROUPS = [
  { id: 'overdue', label: 'Overdue', color: '#c0392b', icon: 'alarm-clock-off' },
  { id: 'today', label: 'Due today', color: '#c08a2e', icon: 'calendar-clock' },
  { id: 'week', label: 'This week', color: '#4c6ea5', icon: 'calendar-days' },
  { id: 'upcoming', label: 'Upcoming', color: '#2e8b74', icon: 'calendar' },
];
const UPCOMING_CAP = 6;
const SUGGEST_INTENT = { overdue: 'Gentle follow-up', hot: 'Gentle follow-up', quiet: 'Re-engage (gone quiet)', high: 'Warm intro' };
const SUGGEST_OFFSET = { overdue: 0, hot: 1, quiet: 2, high: 3 };

function bucketOfTask(task) {
  const d = daysFromToday(parseDate(task.dueDate));
  if (d == null) return 'upcoming';
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 7) return 'week';
  return 'upcoming';
}

function dueBadge(task) {
  const date = parseDate(task.dueDate);
  const d = daysFromToday(date);
  if (d == null) return { cls: 'fu-badge fu-badge--none', text: 'No date' };
  if (d < 0) return { cls: 'fu-badge fu-badge--overdue', text: `Overdue ${Math.abs(d)}d` };
  if (d === 0) return { cls: 'fu-badge fu-badge--today', text: 'Due today' };
  if (d <= 14) return { cls: 'fu-badge fu-badge--soon', text: `in ${d}d` };
  return { cls: 'fu-badge fu-badge--future', text: formatDate(date) };
}

function cardShell({ title, subtitle, iconName, accent }) {
  const caption = h('p', { class: 't-caption mt-0.5', text: subtitle || '' });
  const actions = h('div', { class: 'ml-auto flex items-center gap-2' });
  const body = h('div', { class: 'card-body' });
  const head = h('div', { class: 'card-head' }, [
    h('span', { class: 'card-icon', style: `--accent:${accent}` }, [icon(iconName, 'size-[18px]')]),
    h('div', { class: 'min-w-0 flex-1' }, [h('h2', { class: 't-title', text: title }), caption]),
    actions,
  ]);
  return { el: h('section', { class: 'card' }, [head, body]), body, caption, actions };
}

export function render(container) {
  const remCard = cardShell({ title: 'Follow-ups', subtitle: 'Your reminders, most urgent first.', iconName: 'bell-ring', accent: '#a83a5b' });
  const sugCard = cardShell({ title: 'Suggested follow-ups', subtitle: 'Straight from your real dates — accept to set a reminder.', iconName: 'list-todo', accent: '#c08a2e' });

  const strip = h('div', { class: 'fu-strip' });
  const remHost = h('div', {});
  remCard.body.append(strip, remHost);
  const sugHost = h('div', {});
  sugCard.body.append(sugHost);

  container.append(remCard.el, sugCard.el);
  refreshIcons(container);

  let currentState = null;
  let tasks = [];
  let showAllUpcoming = false;

  const contactOf = (task) => (currentState?.contacts || []).find((c) => c.id === task.contactId) || null;

  /* ---------- reminders ---------- */
  function doneBox(task) {
    const box = h('button', { class: 'fu-check', type: 'button', title: 'Mark done', 'aria-label': `Mark "${task.title}" done` }, [icon('check', 'size-3.5')]);
    box.addEventListener('click', async () => {
      box.disabled = true;
      const r = await store.updateTask(task.id, { done: true });
      if (!r.ok) { box.disabled = false; toast(r.error || 'Could not update.', 'warn'); return; }
      toast('Done — added to the timeline.', 'good');
      loadReminders();
    });
    return box;
  }

  function rescheduleControl(task) {
    const wrap = h('span', { class: 'fu-resched' });
    const btn = h('button', { class: 'fu-act', type: 'button', title: 'Reschedule' }, [icon('calendar-clock', 'size-3.5')]);
    btn.addEventListener('click', () => {
      const input = h('input', { class: 'fu-date', type: 'date', value: task.dueDate || dueInDays(0) });
      input.addEventListener('change', async () => {
        if (!input.value) return;
        const r = await store.updateTask(task.id, { dueDate: input.value });
        if (!r.ok) { toast(r.error || 'Could not reschedule.', 'warn'); return; }
        toast('Rescheduled.', 'good');
        loadReminders();
      });
      input.addEventListener('blur', () => { wrap.replaceChildren(btn); refreshIcons(wrap); });
      wrap.replaceChildren(input);
      requestAnimationFrame(() => { input.focus(); try { input.showPicker?.(); } catch { /* not supported */ } });
    });
    wrap.replaceChildren(btn);
    return wrap;
  }

  function reminderRow(task) {
    const contact = contactOf(task);
    const badge = dueBadge(task);
    const name = contact?.fullName || task.contactName || 'Unlinked reminder';
    const org = contact?.organisation || task.contactOrg || '';
    return h('div', { class: 'fu-row' }, [
      doneBox(task),
      h('div', { class: 'fu-main' }, [
        h('div', { class: 'fu-line1' }, [
          contact
            ? h('button', { class: 'fu-name', type: 'button', title: 'Open contact', onClick: () => openDrawer(contact) },
                [h('span', { class: 'nm', text: name }), org ? h('span', { class: 'sub', text: org }) : null])
            : h('span', { class: 'fu-name' }, [h('span', { class: 'nm', text: name }), org ? h('span', { class: 'sub', text: org }) : null]),
          contact?.stage ? chipCell('stage', contact.stage) : null,
        ]),
        h('div', { class: 'fu-note', text: task.title }),
      ]),
      h('div', { class: 'fu-right' }, [
        h('span', { class: badge.cls, text: badge.text }),
        h('div', { class: 'fu-actions' }, [
          rescheduleControl(task),
          contact ? h('button', { class: 'fu-act', type: 'button', title: 'Open contact', onClick: () => openDrawer(contact) }, [icon('user-round', 'size-3.5')]) : null,
          (store.isLive() && contact) ? h('button', { class: 'fu-act', type: 'button', title: 'Draft a message', onClick: () => openDraftDialog(contact, { intent: task.intent }) }, [icon('pen-line', 'size-3.5')]) : null,
        ]),
      ]),
    ]);
  }

  function renderReminders() {
    if (!store.isLive()) {
      strip.replaceChildren();
      remHost.replaceChildren(h('p', { class: 't-caption py-6 text-center', text: 'Connect the database to use follow-up reminders.' }));
      return;
    }
    const buckets = { overdue: [], today: [], week: [], upcoming: [] };
    for (const t of tasks) buckets[bucketOfTask(t)].push(t);
    const byDate = (a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
    for (const k of Object.keys(buckets)) buckets[k].sort(byDate);

    remCard.caption.textContent = tasks.length
      ? `${formatNumber(tasks.length)} open ${tasks.length === 1 ? 'reminder' : 'reminders'}, most urgent first.`
      : 'No open reminders.';

    // summary strip: one chip per group, click scrolls to that section
    strip.replaceChildren(...GROUPS.map((g) => {
      const n = buckets[g.id].length;
      const chip = h('button', { class: `fu-chip${n ? '' : ' is-empty'}`, type: 'button', style: `--c:${g.color}`, title: `Jump to ${g.label}` }, [
        icon(g.icon, 'size-3.5'), h('span', { class: 'fu-chip-l', text: g.label }), h('span', { class: 'fu-chip-n', text: String(n) }),
      ]);
      chip.addEventListener('click', () => remHost.querySelector(`#fu-grp-${g.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return chip;
    }));

    if (!tasks.length) {
      remHost.replaceChildren(h('div', { class: 'fu-empty' }, [
        icon('bell', 'size-6'),
        h('p', { class: 'fu-empty-t', text: 'No follow-ups scheduled.' }),
        h('p', { class: 't-caption', text: 'Open a contact and apply a cadence, or accept a suggestion below.' }),
      ]));
      return;
    }

    const sections = [];
    for (const g of GROUPS) {
      let rows = buckets[g.id];
      if (!rows.length) continue;
      let extra = null;
      if (g.id === 'upcoming' && rows.length > UPCOMING_CAP && !showAllUpcoming) {
        const hidden = rows.length - UPCOMING_CAP;
        rows = rows.slice(0, UPCOMING_CAP);
        extra = h('button', { class: 'fu-showall', type: 'button', onClick: () => { showAllUpcoming = true; renderReminders(); } },
          [icon('chevron-down', 'size-3.5'), h('span', { text: `Show all (${hidden} more)` })]);
      }
      sections.push(h('div', { class: 'fu-group', id: `fu-grp-${g.id}` }, [
        h('div', { class: 'fu-group-head', style: `--c:${g.color}` }, [
          icon(g.icon, 'size-4'), h('span', { class: 'fu-group-l', text: g.label }),
          h('span', { class: 'fu-group-n', text: String(buckets[g.id].length) }),
        ]),
        h('div', { class: 'fu-rows' }, rows.map(reminderRow)),
        extra,
      ]));
    }
    remHost.replaceChildren(...sections);
    refreshIcons(remHost);
  }

  /* ---------- suggestions ---------- */
  async function acceptSuggestion(item, btn) {
    if (!store.isLive()) { toast('Connect the database to add reminders.', 'warn'); return; }
    btn.disabled = true;
    const c = item.contact;
    const r = await addReminder(c, {
      dueDate: dueInDays(SUGGEST_OFFSET[item.reasonType] ?? 2),
      title: item.suggest,
      intent: SUGGEST_INTENT[item.reasonType] || 'Gentle follow-up',
    });
    if (!r.ok) { btn.disabled = false; toast(r.error || 'Could not add reminder.', 'warn'); return; }
    toast(`Reminder set for ${c.fullName || 'this contact'}.`, 'good');
    loadReminders();   // refetch tasks → this contact now has one → drops out of suggestions
  }

  function renderSuggestions() {
    const contacts = currentState?.contacts || [];
    const withTask = new Set(tasks.map((t) => t.contactId).filter((x) => x != null));
    const items = priorityItems(contacts).filter((it) => !withTask.has(it.contact.id));

    sugCard.caption.textContent = items.length
      ? `${items.length} ${items.length === 1 ? 'contact needs' : 'contacts need'} a nudge — accept to set a reminder.`
      : 'Nothing outstanding — every priority already has a reminder.';
    sugCard.el.classList.toggle('hidden', !items.length && !tasks.length && !store.isLive());

    if (!items.length) {
      sugHost.replaceChildren(h('p', { class: 't-caption py-4 text-center', text: 'No suggestions right now — you’re on top of it.' }));
      return;
    }
    sugHost.replaceChildren(...items.map((it) => {
      const c = it.contact;
      const acceptBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, [icon('plus', 'size-3.5'), h('span', { text: 'Set reminder' })]);
      acceptBtn.addEventListener('click', () => acceptSuggestion(it, acceptBtn));
      if (!store.isLive()) acceptBtn.disabled = true;
      return h('div', { class: 'fu-sug' }, [
        h('div', { class: 'fu-main' }, [
          h('div', { class: 'fu-line1' }, [
            h('button', { class: 'fu-name', type: 'button', title: 'Open contact', onClick: () => openDrawer(c) },
              [h('span', { class: 'nm', text: c.fullName || 'Unnamed' }), h('span', { class: 'sub', text: c.organisation || c.entityType || '—' })]),
            c.stage ? chipCell('stage', c.stage) : null,
          ]),
          h('div', { class: 'fu-sug-why' }, [h('span', { class: 'fu-why-tag', text: it.why }), h('span', { class: 'fu-sug-step', text: `→ ${it.suggest}` })]),
        ]),
        h('div', { class: 'fu-actions' }, [
          acceptBtn,
          h('button', { class: 'fu-act', type: 'button', title: 'Open contact', onClick: () => openDrawer(c) }, [icon('user-round', 'size-3.5')]),
          store.isLive() ? h('button', { class: 'fu-act', type: 'button', title: 'Draft a message', onClick: () => openDraftDialog(c, { intent: SUGGEST_INTENT[it.reasonType] }) }, [icon('pen-line', 'size-3.5')]) : null,
        ]),
      ]);
    }));
    refreshIcons(sugHost);
  }

  /* ---------- load ---------- */
  async function loadReminders() {
    if (!store.isLive()) { renderReminders(); renderSuggestions(); return; }
    const res = await store.listTasks('?open=1');
    tasks = res.tasks || [];
    renderReminders();
    renderSuggestions();
  }

  function update(state) {
    currentState = state;
    if (state.status === 'loading') { remHost.replaceChildren(h('p', { class: 't-caption py-6 text-center', text: 'Loading…' })); return; }
    if (state.status === 'error') { remHost.replaceChildren(h('p', { class: 't-caption py-6 text-center', text: state.error })); return; }
    showAllUpcoming = false;
    loadReminders();
  }

  return {
    update,
    destroy() { /* nothing persistent to tear down */ },
  };
}
