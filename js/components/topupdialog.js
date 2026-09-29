/**
 * components/topupdialog.js — the "Add top-up" dialog (Phase 11).
 *
 * Collects the commitment terms and creates a NEW Committed record linked to the LP. A top-up
 * is born at Committed, so the amount + expected funding date are required — the same gate every
 * other Committed move hits. onCreated(newRecord) fires on success.
 */
import { openModal } from './modal.js';
import { h, icon, toast } from '../ui.js';
import { VEHICLE_VALUES } from '../config.js';
import * as store from '../store.js';

export function openTopUpDialog(lp, { onCreated } = {}) {
  if (!store.isLive()) { toast('Connect the database to add a top-up.', 'warn'); return; }
  const m = openModal({
    title: 'Add top-up', iconName: 'copy-plus',
    subtitle: `A new commitment for ${lp.fullName || 'this LP'} — a fresh Committed record linked to them. The Invested record is untouched.`,
  });

  const amount = h('input', { class: 'field-input', type: 'text', placeholder: 'e.g. ₹5 Cr' });
  const funding = h('input', { class: 'field-input', type: 'date' });
  const vehicle = h('select', { class: 'field-input' }, [
    h('option', { value: '', text: '—', selected: lp.vehicle ? null : '' }),
    ...VEHICLE_VALUES.map((v) => h('option', { value: v, text: v, selected: v === lp.vehicle ? '' : null })),
  ]);
  if (lp.vehicle && !VEHICLE_VALUES.includes(lp.vehicle)) vehicle.prepend(h('option', { value: lp.vehicle, text: lp.vehicle, selected: '' }));

  const row = (label, el, req) => h('label', { class: 'tu-row' }, [
    h('span', { class: 'tu-lbl' }, [h('span', { text: label }), req ? h('span', { class: 'tu-req', text: 'Required' }) : null]),
    el,
  ]);
  m.body.append(h('div', { class: 'tu-form' }, [
    row('Committed amount', amount, true),
    row('Expected funding date', funding, true),
    row('Vehicle', vehicle, false),
  ]));

  const create = h('button', { class: 'btn btn-primary', type: 'button' }, [icon('copy-plus', 'size-4'), h('span', { text: 'Create top-up' })]);
  const cancel = h('button', { class: 'btn btn-quiet', type: 'button', text: 'Cancel', onClick: () => m.close() });
  create.addEventListener('click', async () => {
    if (!amount.value.trim() || !funding.value) { toast('Add the committed amount and the expected funding date.', 'warn'); return; }
    create.disabled = true;
    const r = await store.createTopUp(lp.id, { committedAmount: amount.value.trim(), fundingDate: funding.value, vehicle: vehicle.value });
    create.disabled = false;
    if (!r.ok) { toast(r.error || 'Could not create the top-up.', 'error'); return; }
    toast(`Top-up created for ${lp.fullName || 'the LP'}.`, 'good');
    m.close();
    onCreated?.(r.contact);
  });
  m.foot.append(cancel, create);
  m.refresh();
}
