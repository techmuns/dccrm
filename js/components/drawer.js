/**
 * components/drawer.js — the right-side Detail Drawer, created once and reused by
 * every tab. Call openDrawer(contact) to show all of one person's fields, grouped
 * tidily; the same instance is shared, so there is only ever one drawer in the DOM.
 */
import { h, icon, refreshIcons } from '../ui.js';
import { colorOf } from '../colors.js';
import { formatDate, daysFromToday, escapeHtml, tidy } from '../util.js';

let refs = null;
let lastFocus = null;

function build() {
  const backdrop = h('div', { class: 'drawer-backdrop', 'aria-hidden': 'true' });
  const body = h('div', { class: 'drawer-body' });
  const head = h('div', { class: 'drawer-head' });
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

/* one grouped section */
function section(title, iconName, rows) {
  const filled = rows.filter(Boolean);
  if (!filled.length) return null;
  return h('div', { class: 'drawer-section' }, [
    h('h3', {}, [icon(iconName, 'size-3.5'), title]),
    ...filled,
  ]);
}

/* one label/value line; `html` allows links */
function field(label, value, { html = false } = {}) {
  const has = !(value == null || value === '');
  return h('div', { class: 'drawer-field' }, [
    h('div', { class: 'k', text: label }),
    h('div', { class: `v${has ? '' : ' empty'}`, ...(has ? (html ? { html: value } : { text: value }) : { text: '—' }) }),
  ]);
}

const chip = (dimension, value) => {
  const v = tidy(value);
  if (!v) return null;
  return h('span', { class: 'cat-chip', style: `--c:${colorOf(dimension, v)}` }, [
    h('span', { class: 'dot' }), h('span', { class: 'lbl', text: v }),
  ]);
};

const mailto = (email) => (email ? `<a href="mailto:${encodeURIComponent(email)}">${escapeHtml(email)}</a>` : '');
const tel = (phone) => (phone ? `<a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">${escapeHtml(phone)}</a>` : '');
const wa = (num) => {
  if (!num) return '';
  const clean = num.replace(/[^\d]/g, '');
  return `<a href="https://wa.me/${clean}" target="_blank" rel="noopener">${escapeHtml(num)}</a>`;
};

export function openDrawer(contact) {
  if (!refs) build();
  lastFocus = document.activeElement;

  /* header: name, organisation, type + stage chips */
  refs.head.replaceChildren(
    h('button', { class: 'drawer-close', type: 'button', 'aria-label': 'Close', onClick: close }, [icon('x', 'size-4')]),
    h('div', { class: 'drawer-name', text: contact.fullName || 'Unnamed contact' }),
    contact.organisation ? h('div', { class: 'drawer-org', text: contact.organisation }) : null,
    h('div', { class: 'drawer-chips' }, [chip('entityType', contact.entityType), chip('stage', contact.stage)]),
  );

  /* next-action note, coloured if overdue */
  const dueDays = daysFromToday(contact.nextActionAt);
  const dueNote = contact.nextActionDate
    ? (dueDays < 0 ? ` · ${Math.abs(dueDays)} day${Math.abs(dueDays) === 1 ? '' : 's'} overdue`
      : dueDays === 0 ? ' · due today'
      : ` · in ${dueDays} day${dueDays === 1 ? '' : 's'}`)
    : '';
  const nextValue = contact.nextActionDate
    ? `${formatDate(contact.nextActionAt)}${dueNote}`
    : '';

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
    section('Pipeline', 'git-branch', [
      field('Stage', contact.stage),
      field('Vehicle', contact.vehicle),
    ]),
    section('Follow-up', 'calendar-check', [
      field('Last contact', contact.lastContact ? formatDate(contact.lastContactAt) : ''),
      field('Next action', contact.nextAction),
      contact.nextActionDate
        ? h('div', { class: 'drawer-field' }, [
            h('div', { class: 'k', text: 'Next action date' }),
            h('div', { class: `v${dueDays < 0 ? ' dt-date-overdue' : ''}`, text: nextValue }),
          ])
        : field('Next action date', ''),
      field('Relationship owner', contact.relationshipOwner),
    ]),
    section('Source', 'route', [
      field('Source / channel', contact.source),
      field('Referred by', contact.referredBy),
    ]),
    contact.notes
      ? h('div', { class: 'drawer-section' }, [
          h('h3', {}, [icon('sticky-note', 'size-3.5'), 'Notes']),
          h('p', { class: 'drawer-note', text: contact.notes }),
        ])
      : null,
  );

  /* footer: quick actions */
  refs.foot.replaceChildren(
    contact.email
      ? h('a', { class: 'btn btn-primary', href: `mailto:${encodeURIComponent(contact.email)}`, style: 'flex:1' },
          [icon('mail', 'size-4'), 'Email'])
      : null,
    contact.whatsapp
      ? h('a', { class: 'btn btn-quiet', href: `https://wa.me/${contact.whatsapp.replace(/[^\d]/g, '')}`, target: '_blank', rel: 'noopener', style: 'flex:1' },
          [icon('message-circle', 'size-4'), 'WhatsApp'])
      : null,
  );
  if (!refs.foot.children.length) refs.foot.style.display = 'none';
  else refs.foot.style.display = '';

  refreshIcons(refs.head);
  refreshIcons(refs.body);
  refreshIcons(refs.foot);

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
