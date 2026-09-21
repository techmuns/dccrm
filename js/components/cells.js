/**
 * components/cells.js — the shared cell renderers used by both tabs' tables, so a
 * name, a coloured chip or a date looks identical wherever it appears.
 */
import { h } from '../ui.js';
import { colorOf } from '../colors.js';
import { formatDate, daysFromToday, tidy } from '../util.js';

export function nameCell(contact) {
  return h('div', { class: 'min-w-0' }, [
    h('div', { class: 'nm', text: contact.fullName || 'Unnamed' }),
    h('div', { class: 'sub', text: contact.organisation || contact.designation || '—' }),
  ]);
}

export function chipCell(dimension, value) {
  const v = tidy(value);
  if (!v) return h('span', { class: 'dt-muted', text: '—' });
  return h('span', { class: 'cat-chip', style: `--c:${colorOf(dimension, v)}` }, [
    h('span', { class: 'dot' }), h('span', { class: 'lbl', text: v }),
  ]);
}

export function textCell(value) {
  const v = tidy(value);
  return v ? h('span', { text: v }) : h('span', { class: 'dt-muted', text: '—' });
}

/** A date; when `markOverdue` and the date is in the past, it turns red. */
export function dateCell(dateObj, { markOverdue = false } = {}) {
  if (!dateObj) return h('span', { class: 'dt-muted', text: '—' });
  const overdue = markOverdue && daysFromToday(dateObj) < 0;
  return h('span', { class: overdue ? 'dt-date-overdue' : '', text: formatDate(dateObj) });
}
