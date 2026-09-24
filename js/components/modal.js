/**
 * components/modal.js — one centred modal, reusing the app's .modal-backdrop / .modal
 * styles (first introduced for the import dialog). The AI update box and the Ask box
 * on Contacts both open through here, so they look and behave identically.
 *
 * Returns handles to the body and footer so the caller fills them, plus close().
 */
import { h, icon, refreshIcons } from '../ui.js';

export function openModal({ title, iconName = 'sparkles', subtitle = '', wide = false, onClose } = {}) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const sub = h('p', { class: 'modal-sub', text: subtitle || '' });
  const bodyEl = h('div', { class: 'modal-body' });
  const footEl = h('div', { class: 'modal-foot' });
  const modal = h('div', {
    class: `modal${wide ? ' modal--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
  }, [
    h('div', { class: 'modal-head' }, [
      h('div', { class: 'modal-title' }, [icon(iconName, 'size-[18px]'), h('span', { text: title })]),
      sub,
    ]),
    bodyEl, footEl,
  ]);
  backdrop.append(modal);

  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (closed) return; closed = true;
    backdrop.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => backdrop.remove(), 200);
    onClose?.();
  }
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  refreshIcons(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));

  return {
    backdrop, modal, body: bodyEl, foot: footEl, close,
    setSubtitle: (t) => { sub.textContent = t || ''; },
    refresh: () => refreshIcons(backdrop),
  };
}
