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
  'fullName', 'entityType', 'role', 'organisation', 'designation', 'email', 'phone',
  'whatsapp', 'whatsappOptIn', 'country', 'city', 'vehicle', 'stage', 'referredBy',
  'lastContact', 'nextAction', 'nextActionDate', 'relationshipOwner', 'source', 'notes',
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

function renderView(contact) {
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

  const activitySection = h('div', { class: 'drawer-section' }, [
    h('h3', {}, [icon('history', 'size-3.5'), 'Activity']),
    h('div', { class: 'activity-host' }, [h('p', { class: 't-caption', text: 'Loading…' })]),
  ]);

  refs.body.replaceChildren(
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
      field('WhatsApp', wa(contact.whatsapp), { html: true }),
      field('WhatsApp opt-in', contact.whatsappOptIn),
      field('Location', [contact.city, contact.country].filter(Boolean).join(', ')),
    ]),
    section('Pipeline', 'git-branch', [field('Stage', contact.stage), field('Vehicle', contact.vehicle)]),
    section('Follow-up', 'calendar-check', [
      field('Last contact', contact.lastContact ? formatDate(contact.lastContactAt) : ''),
      field('Next action', contact.nextAction),
      contact.nextActionDate
        ? h('div', { class: 'drawer-field' }, [h('div', { class: 'k', text: 'Next action date' }),
            h('div', { class: `v${dueDays < 0 ? ' dt-date-overdue' : ''}`, text: nextValue })])
        : field('Next action date', ''),
      field('Relationship owner', contact.relationshipOwner),
    ]),
    section('Source', 'route', [field('Source / channel', contact.source), field('Referred by', contact.referredBy)]),
    contact.notes ? h('div', { class: 'drawer-section' }, [h('h3', {}, [icon('sticky-note', 'size-3.5'), 'Notes']),
      h('p', { class: 'drawer-note', text: contact.notes })]) : null,
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

  if (store.isLive() && contact.id != null) loadActivity(contact, activitySection.querySelector('.activity-host'));
  else activitySection.querySelector('.activity-host').replaceChildren(
    h('p', { class: 't-caption', text: 'Activity history is available once the database is connected.' }));
}

/* ---------- activity timeline ---------- */

const ACTIVITY_TYPES = ['Note', 'Call', 'Email', 'Meeting', 'WhatsApp', 'Other'];
const ACTIVITY_ICON = { Note: 'sticky-note', Call: 'phone', Email: 'mail', Meeting: 'users', WhatsApp: 'message-circle', 'Stage change': 'git-branch', Other: 'circle-dot' };

async function loadActivity(contact, host) {
  const detail = await store.getContactDetail(contact.id);
  const list = h('ul', { class: 'timeline' });
  renderTimeline(list, detail.activities || []);
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

/* ---------- edit / create ---------- */

function labelFor(field) {
  return {
    fullName: 'Full name', entityType: 'Entity type', role: 'Role', organisation: 'Organisation',
    designation: 'Designation', email: 'Email', phone: 'Phone', whatsapp: 'WhatsApp number',
    whatsappOptIn: 'WhatsApp opt-in', country: 'Country', city: 'City', vehicle: 'Vehicle', stage: 'Stage',
    referredBy: 'Referred by', lastContact: 'Last contact', nextAction: 'Next action',
    nextActionDate: 'Next action date', relationshipOwner: 'Relationship owner', source: 'Source / channel', notes: 'Notes',
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
  } else if (field === 'notes') {
    el = h('textarea', { class: 'field-input', rows: '3' }); el.value = value || '';
  } else if (field === 'lastContact' || field === 'nextActionDate') {
    el = h('input', { class: 'field-input', type: 'date', value: value || '' });
  } else {
    const suggestions = ['entityType', 'role', 'vehicle', 'relationshipOwner', 'source', 'country', 'city'].includes(field)
      ? suggestionsFor(field) : [];
    const listId = `dl-${field}`;
    el = h('input', { class: 'field-input', type: field === 'email' ? 'email' : 'text', value: value || '',
      ...(suggestions.length ? { list: listId } : {}) });
    if (suggestions.length) datalist = h('datalist', { id: listId }, suggestions.map((sv) => h('option', { value: sv })));
  }
  inputs[field] = el;
  return h('label', { class: `form-row${field === 'notes' ? ' form-row--wide' : ''}` }, [
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
    ['Contact channels', ['email', 'phone', 'whatsapp', 'whatsappOptIn', 'country', 'city']],
    ['Pipeline', ['vehicle', 'stage']],
    ['Follow-up', ['lastContact', 'nextAction', 'nextActionDate', 'relationshipOwner']],
    ['Source', ['source', 'referredBy']],
    ['Notes', ['notes']],
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

export function openDrawer(contact) {
  if (!refs) build();
  lastFocus = document.activeElement;
  renderView(contact);
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
