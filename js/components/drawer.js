/**
 * components/drawer.js — the right-side contact panel: view a full profile with its
 * activity timeline, edit every field in place, add an activity, delete, or create a
 * brand-new contact. One shared instance, reused by every tab.
 *
 * Reads/writes go through the store (live Cloudflare D1). In preview mode (no
 * database) the write controls are hidden and it stays read-only.
 */
import { ALL_STAGES } from '../config.js';
import { h, icon, refreshIcons, toast } from '../ui.js';
import { colorOf } from '../colors.js';
import { formatDate, daysFromToday, escapeHtml, tidy } from '../util.js';
import * as store from '../store.js';

let refs = null;
let lastFocus = null;

const FIELD_ORDER = [
  'fullName', 'entityType', 'role', 'organisation', 'designation',
  'email', 'phone', 'altPhone', 'whatsapp', 'whatsappOptIn',
  'country', 'city', 'stage', 'vehicle', 'tier', 'priority',
  'lastContact', 'nextAction', 'nextActionDate', 'relationshipOwner',
  'source', 'referredBy', 'signal', 'notes', 'roughNotes',
];

function build() {
  const backdrop = h('div', { class: 'drawer-backdrop', 'aria-hidden': 'true' });
  const head = h('div', { class: 'drawer-head' });
  const body = h('div', { class: 'drawer-body' });
  const foot = h('div', { class: 'drawer-foot' });
  const panel = h('div', {
    class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Contact details', tabindex: '-1',
  }, [head, body, foot]);

  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) close();
  });
  document.body.append(backdrop, panel);
  refs = { backdrop, panel, head, body, foot };
}

/* suggestions for the free-text fields, drawn from the data already loaded */
function suggestionsFor(field) {
  const set = new Set();
  for (const c of store.getState().contacts) { const v = tidy(c[field]); if (v) set.add(v); }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/* ---------- view mode ---------- */

const chip = (dimension, value) => {
  const v = tidy(value);
  if (!v) return null;
  return h('span', { class: 'cat-chip', style: `--c:${colorOf(dimension, v)}` }, [
    h('span', { class: 'dot' }), h('span', { class: 'lbl', text: v }),
  ]);
};

function section(title, iconName, rows) {
  const filled = rows.filter(Boolean);
  if (!filled.length) return null;
  return h('div', { class: 'drawer-section' }, [h('h3', {}, [icon(iconName, 'size-3.5'), title]), ...filled]);
}

function field(label, value, { html = false } = {}) {
  const has = !(value == null || value === '');
  return h('div', { class: 'drawer-field' }, [
    h('div', { class: 'k', text: label }),
    h('div', { class: `v${has ? '' : ' empty'}`, ...(has ? (html ? { html: value } : { text: value }) : { text: '—' }) }),
  ]);
}

const mailto = (e) => (e ? `<a href="mailto:${encodeURIComponent(e)}">${escapeHtml(e)}</a>` : '');
const tel = (p) => (p ? `<a href="tel:${escapeHtml(p.replace(/[^\d+]/g, ''))}">${escapeHtml(p)}</a>` : '');
const wa = (n) => (n ? `<a href="https://wa.me/${n.replace(/[^\d]/g, '')}" target="_blank" rel="noopener">${escapeHtml(n)}</a>` : '');

/* ---------- AI insight panel (Feature 1) + reply cards (Feature 2) ---------- */

const BAND_COLOR = { Hot: '#ef4444', Warm: '#f59e0b', Cold: '#06b6d4' };
const SENTIMENT_COLOR = { Positive: '#10b981', Neutral: '#94a3b8', Negative: '#ef4444' };

function aiPanel(contact) {
  const scored = contact.aiScore != null;
  const band = contact.aiBand || (scored ? (contact.aiScore >= 70 ? 'Hot' : contact.aiScore >= 40 ? 'Warm' : 'Cold') : '');
  const c = BAND_COLOR[band] || '#94a3b8';

  const refresh = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' },
    [icon('sparkles', 'size-3.5'), h('span', { text: scored ? 'Refresh AI' : 'Score with AI' })]);
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    const r = await store.enrichContact(contact.id);
    refresh.disabled = false;
    if (!r.ok) {
      if (r.code === 'no-bedrock') toast('Set the BEDROCK_API_KEY secret to switch AI on.', 'warn');
      else toast(r.error || 'Could not score this contact.', 'error');
      return;
    }
    toast('Scored with AI.', 'good');
    renderView(r.contact);   // re-render with the fresh score
  });

  const head = h('div', { class: 'ai-panel-head' }, [
    scored
      ? h('div', { class: 'ai-score', style: `--c:${c}` }, [h('div', { class: 'n', text: String(contact.aiScore) }), h('div', { class: 'l', text: 'interest' })])
      : null,
    scored
      ? h('span', { class: 'cat-chip', style: `--c:${c}` }, [h('span', { class: 'dot' }), h('span', { class: 'lbl', text: band })])
      : h('span', { class: 't-caption', text: 'Not scored yet.' }),
    h('div', { class: 'ml-auto' }, [refresh]),
  ]);
  const rows = [];
  if (contact.aiSummary) rows.push(h('p', { class: 'ai-panel-summary', text: contact.aiSummary }));
  if (contact.aiNextStep) rows.push(h('div', { class: 'ai-next' }, [icon('arrow-right', 'size-3.5'), h('span', { text: contact.aiNextStep })]));
  if (contact.aiAnalyzedAt) rows.push(h('div', { class: 't-caption mt-1', text: `Last analysed ${formatDate(new Date(contact.aiAnalyzedAt))}` }));

  return h('div', { class: 'drawer-section' }, [
    h('h3', {}, [icon('brain-circuit', 'size-3.5'), 'AI insight']),
    h('div', { class: 'ai-panel' }, [head, ...rows]),
  ]);
}

async function copyDraft(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text;
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  btn.classList.add('done');
  btn.querySelector('span').textContent = 'Copied';
  setTimeout(() => { btn.classList.remove('done'); btn.querySelector('span').textContent = 'Copy reply'; }, 1600);
}

function replyCard(r) {
  const c = SENTIMENT_COLOR[r.sentiment] || '#94a3b8';
  const draft = tidy(r.draftReply);
  let draftBox = null;
  if (draft) {
    const copyBtn = h('button', { class: 'copy-btn', type: 'button' }, [icon('copy', 'size-3.5'), h('span', { text: 'Copy reply' })]);
    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyDraft(draft, copyBtn); });
    draftBox = h('div', { class: 'draft-box' }, [
      h('div', { class: 'dh' }, [icon('sparkles', 'size-3'), 'AI-drafted reply — review before sending']),
      h('div', { text: draft }), copyBtn,
    ]);
  }
  return h('div', { class: 'reply-card' }, [
    h('div', { class: 'reply-card-top' }, [
      h('span', { class: 'cat-chip', style: `--c:${c}` }, [h('span', { class: 'dot' }), h('span', { class: 'lbl', text: r.sentiment || 'Neutral' })]),
      r.questionsAsked ? h('span', { class: 't-caption', text: `${r.questionsAsked} question${r.questionsAsked === 1 ? '' : 's'}` }) : null,
      h('span', { class: 't-caption', style: 'margin-left:auto', text: r.receivedAt ? formatDate(new Date(r.receivedAt)) : '' }),
    ]),
    r.subject ? h('div', { class: 'reply-subject', text: r.subject }) : null,
    r.summary ? h('p', { class: 'reply-summary', text: r.summary }) : null,
    draftBox,
  ]);
}

function renderReplies(host, replies) {
  const sectionEl = host.closest('.drawer-section');   // toggle the whole section, not just the host
  if (!replies.length) { host.replaceChildren(); if (sectionEl) sectionEl.style.display = 'none'; return; }
  if (sectionEl) sectionEl.style.display = '';
  host.replaceChildren(...replies.map(replyCard));
  refreshIcons(host);
}

function renderView(contact, opts = {}) {
  refs.head.replaceChildren(
    h('button', { class: 'drawer-close', type: 'button', 'aria-label': 'Close', onClick: close }, [icon('x', 'size-4')]),
    h('div', { class: 'drawer-name', text: contact.fullName || 'Unnamed contact' }),
    contact.organisation ? h('div', { class: 'drawer-org', text: contact.organisation }) : null,
    h('div', { class: 'drawer-chips' }, [chip('entityType', contact.entityType), chip('stage', contact.stage)]),
  );

  const dueDays = daysFromToday(contact.nextActionAt);
  const nextValue = contact.nextActionDate
    ? `${formatDate(contact.nextActionAt)}${dueDays < 0 ? ` · ${Math.abs(dueDays)} day${Math.abs(dueDays) === 1 ? '' : 's'} overdue`
      : dueDays === 0 ? ' · due today' : ` · in ${dueDays} day${dueDays === 1 ? '' : 's'}`}`
    : '';

  const tagsSection = h('div', { class: 'drawer-section' }, [
    h('h3', {}, [icon('tag', 'size-3.5'), 'Tags']),
    h('div', { class: 'tags-host' }),
  ]);
  const tasksSection = h('div', { class: 'drawer-section' }, [
    h('h3', {}, [icon('list-checks', 'size-3.5'), 'Tasks']),
    h('div', { class: 'tasks-host' }),
  ]);
  const activitySection = h('div', { class: 'drawer-section' }, [
    h('h3', {}, [icon('history', 'size-3.5'), 'Memory & activity']),
    h('div', { class: 'activity-host' }, [h('p', { class: 't-caption', text: 'Loading…' })]),
  ]);
  const repliesSection = h('div', { class: 'drawer-section', style: 'display:none' }, [
    h('h3', {}, [icon('mail', 'size-3.5'), 'Recent replies']),
    h('div', { class: 'replies-host' }),
  ]);

  refs.body.replaceChildren(
    store.isLive() ? aiPanel(contact) : null,
    store.isLive() ? draftPanel(contact, { autoOpen: !!opts.draft }) : null,
    section('Identity', 'user', [
      field('Full name', contact.fullName),
      field('Entity type', contact.entityType),
      field('Role', contact.role),
      field('Organisation', contact.organisation),
      field('Designation', contact.designation),
    ]),
    section('Contact channels', 'at-sign', [
      field('Email', mailto(contact.email), { html: true }),
      field('Phone', tel(contact.phone), { html: true }),
      field('Alt phone', tel(contact.altPhone), { html: true }),
      field('WhatsApp', wa(contact.whatsapp), { html: true }),
      field('WhatsApp opt-in', contact.whatsappOptIn),
    ]),
    section('Location', 'map-pin', [
      field('Country', contact.country),
      field('City', contact.city),
    ]),
    section('Pipeline', 'git-branch', [
      field('Stage', contact.stage),
      field('Vehicle', contact.vehicle),
      field('Tier', contact.tier),
      field('Priority', contact.priority),
    ]),
    section('Follow-up', 'calendar-check', [
      field('Last contact', contact.lastContact ? formatDate(contact.lastContactAt) : ''),
      field('Next action', contact.nextAction),
      contact.nextActionDate
        ? h('div', { class: 'drawer-field' }, [h('div', { class: 'k', text: 'Next action date' }),
            h('div', { class: `v${dueDays < 0 ? ' dt-date-overdue' : ''}`, text: nextValue })])
        : field('Next action date', ''),
      field('Relationship owner', contact.relationshipOwner),
    ]),
    section('Source', 'route', [
      field('Source / channel', contact.source),
      field('Referred by', contact.referredBy),
      field('Signal / tags', contact.signal),
    ]),
    (contact.notes || contact.roughNotes) ? h('div', { class: 'drawer-section' }, [
      h('h3', {}, [icon('sticky-note', 'size-3.5'), 'Notes']),
      contact.notes ? h('p', { class: 'drawer-note', text: contact.notes }) : null,
      contact.roughNotes ? h('div', { class: 'drawer-field' }, [
        h('div', { class: 'k', text: 'Rough notes for Raghav' }),
        h('div', { class: 'v', text: contact.roughNotes }),
      ]) : null,
    ]) : null,
    store.isLive() ? repliesSection : null,
    store.isLive() ? tagsSection : null,
    store.isLive() ? tasksSection : null,
    activitySection,
  );

  /* footer: edit / delete (live only) + quick contact actions */
  const footChildren = [];
  if (store.isLive()) {
    footChildren.push(
      h('button', { class: 'btn btn-primary', type: 'button', style: 'flex:1', onClick: () => renderEdit(contact, { create: false }) },
        [icon('pencil', 'size-4'), 'Edit']),
      h('button', { class: 'btn btn-danger', type: 'button', title: 'Delete contact', onClick: () => confirmDelete(contact) },
        [icon('trash-2', 'size-4')]),
    );
  } else if (contact.email) {
    footChildren.push(h('a', { class: 'btn btn-primary', href: `mailto:${encodeURIComponent(contact.email)}`, style: 'flex:1' },
      [icon('mail', 'size-4'), 'Email']));
  }
  refs.foot.replaceChildren(...footChildren);
  refs.foot.style.display = footChildren.length ? '' : 'none';

  refreshIcons(refs.head); refreshIcons(refs.body); refreshIcons(refs.foot);

  if (store.isLive() && contact.id != null) {
    loadDetail(contact, {
      tags: tagsSection.querySelector('.tags-host'),
      tasks: tasksSection.querySelector('.tasks-host'),
      activity: activitySection.querySelector('.activity-host'),
      replies: repliesSection.querySelector('.replies-host'),
    });
  } else {
    activitySection.querySelector('.activity-host').replaceChildren(
      h('p', { class: 't-caption', text: 'Tags, tasks and activity are available once the database is connected.' }));
  }
}

/* fetch the contact's detail once, then fill tags / tasks / activity */
async function loadDetail(contact, hosts) {
  const detail = await store.getContactDetail(contact.id);
  renderTags(contact, hosts.tags, detail.tags || contact.tags || []);
  renderTasks(contact, hosts.tasks, detail.tasks || []);
  if (hosts.replies) renderReplies(hosts.replies, detail.replies || []);
  renderActivityInto(contact, hosts.activity, detail.activities || []);
}

/* ---------- tags ---------- */
function renderTags(contact, host, tags) {
  const chips = tags.map((t) => h('span', { class: 'cat-chip removable', style: `--c:${t.colour || '#94a3b8'}` }, [
    h('span', { class: 'dot' }), h('span', { class: 'lbl', text: t.name }),
    h('button', { class: 'chip-x', type: 'button', 'aria-label': `Remove ${t.name}`, onClick: async () => {
      const r = await store.removeTagFromContact(contact.id, t.id);
      if (!r.ok) { toast(r.error || 'Could not remove tag.', 'warn'); return; }
      renderTags(contact, host, (store.getState().contacts.find((c) => c.id === contact.id)?.tags) || []);
    } }, [icon('x', 'size-3')]),
  ]));

  const input = h('input', { class: 'field-input tag-add-input', type: 'text', placeholder: 'Add or create a tag…', list: 'drawer-tag-list' });
  const list = h('datalist', { id: 'drawer-tag-list' }, (store.getState().tags || []).map((t) => h('option', { value: t.name })));
  const add = async () => {
    const name = input.value.trim();
    if (!name) return;
    const r = await store.addTagToContact(contact.id, { name });
    if (!r.ok) { toast(r.error || 'Could not add tag.', 'warn'); return; }
    input.value = '';
    renderTags(contact, host, (store.getState().contacts.find((c) => c.id === contact.id)?.tags) || []);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const go = h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: add }, [icon('plus', 'size-3.5')]);

  host.replaceChildren(
    chips.length ? h('div', { class: 'chip-wrap' }, chips) : h('p', { class: 't-caption', text: 'No tags yet.' }),
    h('div', { class: 'flex gap-1 mt-2' }, [input, list, go]),
  );
  refreshIcons(host);
}

/* ---------- tasks ---------- */
function renderTasks(contact, host, tasks) {
  const list = h('ul', { class: 'task-list' });
  const paint = (items) => {
    list.replaceChildren(...(items.length ? items.map((t) => taskRow(contact, t, host)) : [h('li', { class: 't-caption text-slate-400 py-1', text: 'No tasks yet.' })]));
    refreshIcons(list);
  };
  paint(tasks);
  host.replaceChildren(addTaskForm(contact, host), list);
  refreshIcons(host);
}

function taskRow(contact, task, host) {
  const overdue = !task.done && task.dueDate && new Date(task.dueDate) < startOfToday();
  const box = h('input', { type: 'checkbox' });
  box.checked = !!task.done;
  box.addEventListener('change', async () => {
    const r = await store.updateTask(task.id, { done: box.checked });
    if (!r.ok) { toast(r.error || 'Could not update.', 'warn'); box.checked = !box.checked; return; }
    reloadTasks(contact, host);
  });
  return h('li', { class: `task-row${task.done ? ' is-done' : ''}` }, [
    box,
    h('div', { class: 'min-w-0 flex-1' }, [
      h('div', { class: 'task-title', text: task.title }),
      h('div', { class: 'task-meta' }, [
        task.dueDate ? h('span', { class: overdue ? 'dt-date-overdue' : '', text: formatDate(new Date(task.dueDate)) }) : h('span', { class: 'dt-muted', text: 'No date' }),
        task.owner ? h('span', { text: ` · ${task.owner}` }) : null,
      ]),
    ]),
    h('button', { class: 'task-del', type: 'button', 'aria-label': 'Delete task', onClick: async () => {
      const r = await store.deleteTask(task.id);
      if (!r.ok) { toast(r.error || 'Could not delete.', 'warn'); return; }
      reloadTasks(contact, host);
    } }, [icon('trash-2', 'size-3.5')]),
  ]);
}

async function reloadTasks(contact, host) {
  const res = await store.listTasks(`?contactId=${contact.id}`);
  renderTasks(contact, host, res.tasks || []);
}

function addTaskForm(contact, host) {
  const title = h('input', { class: 'field-input flex-1', type: 'text', placeholder: 'New task…' });
  const due = h('input', { class: 'field-input', type: 'date' });
  const owner = h('input', { class: 'field-input', type: 'text', placeholder: 'Owner', list: 'drawer-owner-list' });
  const ownerList = h('datalist', { id: 'drawer-owner-list' },
    [...new Set(store.getState().contacts.map((c) => tidy(c.relationshipOwner)).filter(Boolean))].map((o) => h('option', { value: o })));
  const add = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('plus', 'size-3.5'), 'Add']);
  const submit = async () => {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    add.disabled = true;
    const r = await store.createTask({ contactId: contact.id, title: t, dueDate: due.value || undefined, owner: owner.value.trim() || undefined });
    add.disabled = false;
    if (!r.ok) { toast(r.error || 'Could not add task.', 'error'); return; }
    title.value = ''; due.value = ''; owner.value = '';
    reloadTasks(contact, host);
  };
  add.addEventListener('click', submit);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return h('div', { class: 'activity-add' }, [
    h('div', { class: 'flex gap-2' }, [title]),
    h('div', { class: 'flex gap-2 mt-2' }, [due, owner, ownerList, add]),
  ]);
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/* ---------- activity timeline ---------- */

const ACTIVITY_TYPES = ['Note', 'Call', 'Email', 'Meeting', 'WhatsApp', 'Other'];
const ACTIVITY_ICON = { Note: 'sticky-note', Call: 'phone', Email: 'mail', Meeting: 'users', WhatsApp: 'message-circle', 'Stage change': 'git-branch', Other: 'circle-dot' };

function renderActivityInto(contact, host, activities) {
  const list = h('ul', { class: 'timeline' });
  renderTimeline(list, activities);
  host.replaceChildren(addActivityForm(contact, list), list);
  refreshIcons(host);
}

function renderTimeline(list, activities) {
  if (!activities.length) {
    list.replaceChildren(h('li', { class: 't-caption text-slate-400 py-1', text: 'No activity logged yet.' }));
    return;
  }
  list.replaceChildren(...activities.map((a) => h('li', { class: 'tl-item' }, [
    h('span', { class: 'tl-dot' }, [icon(ACTIVITY_ICON[a.type] || 'circle-dot', 'size-3.5')]),
    h('div', { class: 'min-w-0' }, [
      h('div', { class: 'tl-top' }, [
        h('span', { class: 'tl-type', text: a.type || 'Note' }),
        a.source ? h('span', { class: 'tl-source', text: a.source }) : null,
        h('span', { class: 'tl-date', text: a.occurredAt ? formatDate(new Date(a.occurredAt)) : '' }),
      ]),
      h('p', { class: 'tl-summary', text: a.summary }),
    ]),
  ])));
}

function addActivityForm(contact, list) {
  const type = h('select', { class: 'field-input', 'aria-label': 'Activity type' },
    ACTIVITY_TYPES.map((t) => h('option', { value: t, text: t })));
  const note = h('input', { class: 'field-input flex-1', type: 'text', placeholder: 'What happened? (e.g. Sent the deck)' });
  const date = h('input', { class: 'field-input', type: 'date', value: new Date().toISOString().slice(0, 10) });
  const save = h('button', { class: 'btn btn-quiet', type: 'button' }, [icon('plus', 'size-4'), 'Log']);

  save.addEventListener('click', async () => {
    const summary = note.value.trim();
    if (!summary) { note.focus(); return; }
    save.disabled = true;
    const res = await store.logActivity(contact.id, { type: type.value, summary, occurredAt: date.value || undefined });
    save.disabled = false;
    if (!res.ok) { toast(res.error || 'Could not log that.', 'error'); return; }
    note.value = '';
    // refresh the timeline from the server
    const detail = await store.getContactDetail(contact.id);
    renderTimeline(list, detail.activities || []);
    refreshIcons(list);
    toast('Activity logged.', 'good');
  });

  return h('div', { class: 'activity-add' }, [
    h('div', { class: 'flex gap-2' }, [type, date]),
    h('div', { class: 'flex gap-2 mt-2' }, [note, save]),
  ]);
}

/* ---------- draft a message (Phase 3) ---------- */

const DRAFT_INTENTS = ['Warm intro', 'Gentle follow-up', 'Diligence follow-up', 'Re-engage (gone quiet)', 'Thank you / next step'];

/** Re-fetch and repaint just the memory/activity timeline (after saving a draft as a note). */
async function reloadActivity(contact) {
  const host = refs?.body?.querySelector('.activity-host');
  if (!host) return;
  const detail = await store.getContactDetail(contact.id);
  renderActivityInto(contact, host, detail.activities || []);
}

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text;
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  toast('Copied to clipboard.', 'good');
}

/** A collapsible "Draft a message" panel: intent + channel → editable draft → copy / regenerate / save. */
function draftPanel(contact, { autoOpen = false } = {}) {
  const intentSel = h('select', { class: 'field-input', 'aria-label': 'Message intent' },
    DRAFT_INTENTS.map((i) => h('option', { value: i, text: i })));
  let channel = 'Email';
  const emailBtn = h('button', { class: 'seg-btn is-on', type: 'button', text: 'Email' });
  const waBtn = h('button', { class: 'seg-btn', type: 'button', text: 'WhatsApp' });
  emailBtn.addEventListener('click', () => { channel = 'Email'; emailBtn.classList.add('is-on'); waBtn.classList.remove('is-on'); });
  waBtn.addEventListener('click', () => { channel = 'WhatsApp'; waBtn.classList.add('is-on'); emailBtn.classList.remove('is-on'); });
  const genBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, [icon('sparkles', 'size-3.5'), h('span', { text: 'Generate' })]);

  const subjectInput = h('input', { class: 'field-input draft-subject hidden', type: 'text', placeholder: 'Subject' });
  const output = h('textarea', { class: 'field-input draft-output', rows: '7', placeholder: 'Your draft will appear here — edit it freely before you use it.' });
  const copyBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('copy', 'size-3.5'), h('span', { text: 'Copy' })]);
  const regenBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('refresh-cw', 'size-3.5'), h('span', { text: 'Regenerate' })]);
  const saveBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('save', 'size-3.5'), h('span', { text: 'Save as note' })]);
  const outWrap = h('div', { class: 'draft-out hidden' }, [subjectInput, output, h('div', { class: 'draft-actions' }, [copyBtn, regenBtn, saveBtn])]);

  const fullText = () => (!subjectInput.classList.contains('hidden') && subjectInput.value ? `Subject: ${subjectInput.value}\n\n` : '') + output.value;

  async function generate() {
    genBtn.disabled = true; genBtn.replaceChildren(icon('loader-circle', 'size-3.5 animate-spin'), h('span', { text: 'Writing…' })); refreshIcons(genBtn);
    const res = await store.draftMessage(contact.id, intentSel.value, channel);
    genBtn.disabled = false; genBtn.replaceChildren(icon('sparkles', 'size-3.5'), h('span', { text: 'Generate' })); refreshIcons(genBtn);
    if (!res.ok) {
      toast(res.code === 'no-bedrock' ? 'Turn on AI (set BEDROCK_API_KEY) to draft messages.' : (res.error || 'Could not draft a message.'), res.code === 'no-bedrock' ? 'warn' : 'error');
      return;
    }
    if (channel === 'Email' && res.subject) { subjectInput.value = res.subject; subjectInput.classList.remove('hidden'); }
    else { subjectInput.value = ''; subjectInput.classList.add('hidden'); }
    output.value = res.draft || '';
    outWrap.classList.remove('hidden');
    output.focus();
  }
  genBtn.addEventListener('click', generate);
  regenBtn.addEventListener('click', generate);
  copyBtn.addEventListener('click', () => copyText(fullText(), copyBtn));
  saveBtn.addEventListener('click', async () => {
    const text = output.value.trim();
    if (!text) { toast('Nothing to save yet.', 'warn'); return; }
    const prefix = `[${intentSel.value} · ${channel}]`;
    const subj = (!subjectInput.classList.contains('hidden') && subjectInput.value) ? ` ${subjectInput.value} —` : '';
    const r = await store.logActivity(contact.id, { type: 'Note', summary: `${prefix}${subj} ${text}`, source: 'AI draft' });
    if (!r.ok) { toast(r.error || 'Could not save.', 'warn'); return; }
    toast('Saved to memory.', 'good');
    reloadActivity(contact);
  });

  const bodyWrap = h('div', { class: 'draft-body hidden' }, [
    h('div', { class: 'draft-controls' }, [
      h('label', { class: 'draft-field' }, [h('span', { class: 'draft-lbl', text: 'Purpose' }), intentSel]),
      h('label', { class: 'draft-field' }, [h('span', { class: 'draft-lbl', text: 'Channel' }), h('div', { class: 'draft-seg' }, [emailBtn, waBtn])]),
    ]),
    h('div', { class: 'mt-2' }, [genBtn]),
    outWrap,
  ]);
  const toggle = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('pen-line', 'size-3.5'), h('span', { text: 'Draft a message' })]);
  toggle.addEventListener('click', () => { const wasHidden = bodyWrap.classList.contains('hidden'); bodyWrap.classList.toggle('hidden'); if (wasHidden) requestAnimationFrame(() => intentSel.focus()); });

  if (autoOpen) bodyWrap.classList.remove('hidden');
  return h('div', { class: 'drawer-section' }, [
    h('h3', {}, [icon('pen-line', 'size-3.5'), 'Draft a message']),
    toggle, bodyWrap,
  ]);
}

/* ---------- edit / create ---------- */

function labelFor(field) {
  return {
    fullName: 'Full name', entityType: 'Entity type', role: 'Role', organisation: 'Organisation',
    designation: 'Designation', email: 'Email', phone: 'Phone', altPhone: 'Alt phone',
    whatsapp: 'WhatsApp number', whatsappOptIn: 'WhatsApp opt-in', country: 'Country', city: 'City',
    vehicle: 'Vehicle', stage: 'Stage', tier: 'Tier', priority: 'Priority',
    referredBy: 'Referred by', lastContact: 'Last contact', nextAction: 'Next action',
    nextActionDate: 'Next action date', relationshipOwner: 'Relationship owner', source: 'Source / channel',
    signal: 'Signal / tags', notes: 'Notes', roughNotes: 'Rough notes for Raghav',
  }[field];
}

function inputFor(field, value, inputs) {
  let el;
  let datalist = null;
  if (field === 'stage') {
    el = h('select', { class: 'field-input' }, [h('option', { value: '', text: '—' }),
      ...ALL_STAGES.map((s) => h('option', { value: s, text: s, selected: s === value ? '' : null }))]);
  } else if (field === 'whatsappOptIn') {
    el = h('select', { class: 'field-input' }, ['', 'Yes', 'No'].map((o) =>
      h('option', { value: o, text: o || '—', selected: o === value ? '' : null })));
  } else if (field === 'notes' || field === 'roughNotes') {
    el = h('textarea', { class: 'field-input', rows: '3' }); el.value = value || '';
  } else if (field === 'lastContact' || field === 'nextActionDate') {
    el = h('input', { class: 'field-input', type: 'date', value: value || '' });
  } else {
    const suggestions = ['entityType', 'role', 'vehicle', 'tier', 'priority', 'relationshipOwner', 'source', 'country', 'city'].includes(field)
      ? suggestionsFor(field) : [];
    const listId = `dl-${field}`;
    el = h('input', { class: 'field-input', type: field === 'email' ? 'email' : 'text', value: value || '',
      ...(suggestions.length ? { list: listId } : {}) });
    if (suggestions.length) datalist = h('datalist', { id: listId }, suggestions.map((sv) => h('option', { value: sv })));
  }
  inputs[field] = el;
  const wide = field === 'notes' || field === 'roughNotes';
  return h('label', { class: `form-row${wide ? ' form-row--wide' : ''}` }, [
    h('span', { class: 'form-label', text: labelFor(field) }), el, datalist,
  ]);
}

function renderEdit(contact, { create }) {
  const inputs = {};
  refs.head.replaceChildren(
    h('button', { class: 'drawer-close', type: 'button', 'aria-label': 'Close', onClick: close }, [icon('x', 'size-4')]),
    h('div', { class: 'drawer-name', text: create ? 'New contact' : `Edit ${contact.fullName || 'contact'}` }),
    h('div', { class: 'drawer-org', text: create ? 'Fill in what you know — only one of name, email or organisation is required.' : '' }),
  );

  const groups = [
    ['Identity', ['fullName', 'entityType', 'role', 'organisation', 'designation']],
    ['Contact channels', ['email', 'phone', 'altPhone', 'whatsapp', 'whatsappOptIn']],
    ['Location', ['country', 'city']],
    ['Pipeline', ['stage', 'vehicle', 'tier', 'priority']],
    ['Follow-up', ['lastContact', 'nextAction', 'nextActionDate', 'relationshipOwner']],
    ['Source', ['source', 'referredBy', 'signal']],
    ['Notes', ['notes', 'roughNotes']],
  ];
  refs.body.replaceChildren(...groups.map(([title, fields]) =>
    h('div', { class: 'drawer-section' }, [
      h('h3', {}, [title]),
      h('div', { class: 'form-grid' }, fields.map((f) => inputFor(f, contact[f], inputs))),
    ])));

  const save = h('button', { class: 'btn btn-primary', type: 'button', style: 'flex:1' },
    [icon('check', 'size-4'), create ? 'Create contact' : 'Save changes']);
  const cancel = h('button', { class: 'btn btn-quiet', type: 'button', text: 'Cancel',
    onClick: () => (create ? close() : renderView(contact)) });

  save.addEventListener('click', async () => {
    const payload = {};
    for (const f of FIELD_ORDER) if (inputs[f]) payload[f] = inputs[f].value.trim();
    if (!payload.fullName && !payload.email && !payload.organisation) {
      toast('Add at least a name, an email or an organisation.', 'warn'); return;
    }
    save.disabled = true;
    const res = create ? await store.createContact(payload) : await store.updateContact(contact.id, payload, { optimistic: false });
    save.disabled = false;
    if (!res.ok) { toast(res.error || 'Could not save.', 'error'); return; }
    toast(create ? 'Contact added.' : 'Changes saved.', 'good');
    renderView(res.contact);
  });

  refs.foot.replaceChildren(cancel, save);
  refs.foot.style.display = '';
  refreshIcons(refs.head); refreshIcons(refs.body); refreshIcons(refs.foot);
  requestAnimationFrame(() => refs.body.querySelector('.field-input')?.focus());
}

/* ---------- delete ---------- */

function confirmDelete(contact) {
  refs.foot.replaceChildren(
    h('div', { class: 'confirm-bar' }, [
      h('span', { class: 't-caption', text: `Delete ${contact.fullName || 'this contact'}? This cannot be undone.` }),
      h('div', { class: 'flex gap-2' }, [
        h('button', { class: 'btn btn-quiet', type: 'button', text: 'Keep', onClick: () => renderView(contact) }),
        h('button', { class: 'btn btn-danger', type: 'button', onClick: async () => {
          const res = await store.deleteContact(contact.id);
          if (!res.ok) { toast(res.error || 'Could not delete.', 'error'); return; }
          toast('Contact deleted.', 'good');
          close();
        } }, [icon('trash-2', 'size-4'), 'Delete']),
      ]),
    ]),
  );
  refreshIcons(refs.foot);
}

/* ---------- open / close ---------- */

export function openDrawer(contact, opts = {}) {
  if (!refs) build();
  lastFocus = document.activeElement;
  renderView(contact, opts);
  refs.backdrop.classList.add('open');
  refs.panel.classList.add('open');
  refs.backdrop.removeAttribute('aria-hidden');
  requestAnimationFrame(() => refs.panel.focus());
}

/** Open the drawer straight into a blank create form. */
export function openNewContact() {
  if (!refs) build();
  lastFocus = document.activeElement;
  const blank = {};
  for (const f of FIELD_ORDER) blank[f] = '';
  renderEdit(blank, { create: true });
  refs.backdrop.classList.add('open');
  refs.panel.classList.add('open');
  refs.backdrop.removeAttribute('aria-hidden');
  requestAnimationFrame(() => refs.panel.focus());
}

export function close() {
  if (!refs) return;
  refs.backdrop.classList.remove('open');
  refs.panel.classList.remove('open');
  refs.backdrop.setAttribute('aria-hidden', 'true');
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
