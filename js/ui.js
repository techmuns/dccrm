/**
 * ui.js — the visual building blocks every tab shares.
 *
 * One card shape, one legend, one set of loading / empty / error states. A future
 * tab composes these rather than inventing its own, which is what keeps the look
 * consistent as the product grows.
 */
import { escapeHtml, formatNumber } from './util.js';

/** Tiny element factory. attrs: class, text, html, dataset, style, on*, anything else -> attribute. */
export function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style') node.setAttribute('style', value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** A Lucide icon placeholder. Call refreshIcons() once the node is in the document. */
export const icon = (name, className = 'size-4') =>
  h('i', { 'data-lucide': name, class: className, 'aria-hidden': 'true' });

export function refreshIcons(root = document) {
  if (window.lucide?.createIcons) window.lucide.createIcons({ nameAttr: 'data-lucide', root });
}

/* ---------- card ---------- */

/**
 * The only widget container in the app. Never nested inside another card.
 * Returns { el, content, setState } — write into `content`, then setState('ready').
 */
export function card({ title, subtitle, iconName, accent = '#a83a5b', className = '', actions = null } = {}) {
  const content = h('div', { class: 'card-content' });
  const overlay = h('div', { class: 'card-overlay' });

  const head = h('div', { class: 'card-head' }, [
    iconName
      ? h('span', { class: 'card-icon', style: `--accent:${accent}` }, [icon(iconName, 'size-[18px]')])
      : null,
    h('div', { class: 'min-w-0 flex-1' }, [
      h('h2', { class: 't-title truncate', text: title }),
      subtitle ? h('p', { class: 't-caption mt-0.5', text: subtitle }) : null,
    ]),
    actions,
  ]);

  const el = h('section', { class: `card ${className}` }, [head, h('div', { class: 'card-body' }, [content, overlay])]);

  function setState(state, options = {}) {
    el.dataset.state = state;
    overlay.replaceChildren();
    if (state === 'loading') overlay.append(options.skeleton || skeleton());
    else if (state === 'empty') overlay.append(emptyState(options.message));
    else if (state === 'error') overlay.append(errorState(options.message));
    refreshIcons(overlay);
  }

  setState('loading', {});
  return { el, content, setState, head };
}

/* ---------- states ---------- */

/** Shimmer placeholder. `lines` shapes it roughly like the thing it stands in for. */
export function skeleton(kind = 'chart') {
  if (kind === 'tile') {
    return h('div', { class: 'w-full space-y-3' }, [
      h('div', { class: 'shimmer h-3 w-24 rounded-full' }),
      h('div', { class: 'shimmer h-8 w-20 rounded-lg' }),
    ]);
  }
  if (kind === 'bars') {
    return h('div', { class: 'w-full space-y-2.5 py-1' },
      [72, 58, 47, 38, 30, 22].map((w) =>
        h('div', { class: 'flex items-center gap-2' }, [
          h('div', { class: 'shimmer h-2.5 w-16 rounded-full shrink-0' }),
          h('div', { class: 'shimmer h-5 rounded-md', style: `width:${w}%` }),
        ])));
  }
  return h('div', { class: 'w-full h-full min-h-[180px] flex flex-col gap-3 justify-center' }, [
    h('div', { class: 'shimmer h-full min-h-[140px] rounded-xl' }),
    h('div', { class: 'flex gap-2' }, [1, 2, 3, 4].map(() => h('div', { class: 'shimmer h-3 w-16 rounded-full' }))),
  ]);
}

export const emptyState = (message = 'No data yet — upload your sheet') =>
  h('div', { class: 'state-block' }, [
    h('span', { class: 'state-icon state-icon--empty' }, [icon('inbox', 'size-5')]),
    h('p', { class: 't-body font-medium text-slate-600', text: message }),
    h('p', { class: 't-caption', text: 'Use the Upload Sheet button at the top right.' }),
  ]);

export const errorState = (message = 'Something went wrong.') =>
  h('div', { class: 'state-block' }, [
    h('span', { class: 'state-icon state-icon--error' }, [icon('triangle-alert', 'size-5')]),
    h('p', { class: 't-body font-medium text-slate-700', text: "We couldn't show this" }),
    h('p', { class: 't-caption max-w-sm', text: message }),
  ]);

/* ---------- legend ---------- */

/**
 * The shared legend, used under every chart.
 *
 * It is not decoration: it is how identity survives without colour. Every value is
 * readable as text here, so a reader who cannot separate two hues still gets the
 * whole picture. Hovering an entry lights up the matching mark in the chart.
 */
export function legend(items, { onHover = null, showValue = true, showShare = false } = {}) {
  const list = h('ul', { class: 'legend' }, items.map((item) => {
    const entry = h('li', {
      class: 'legend-item',
      dataset: { name: item.name },
      title: item.hint || `${item.name}: ${formatNumber(item.value)}`,
    }, [
      h('span', { class: 'legend-dot', style: `background:${item.color}` }),
      h('span', { class: 'legend-label', text: item.name }),
      showValue ? h('span', { class: 'legend-value', text: formatNumber(item.value) }) : null,
      showShare && item.shareLabel ? h('span', { class: 'legend-share', text: item.shareLabel }) : null,
    ]);
    if (onHover) {
      entry.addEventListener('mouseenter', () => onHover(item.name, true));
      entry.addEventListener('mouseleave', () => onHover(item.name, false));
    }
    return entry;
  }));
  return list;
}

/* ---------- misc ---------- */

export const footnote = (message) => h('p', { class: 'card-footnote', html: message });

/** A small pill. tone: neutral | brand | warn | good */
export const pill = (label, tone = 'neutral', iconName = null) =>
  h('span', { class: `pill pill--${tone}` }, [iconName ? icon(iconName, 'size-3.5') : null, h('span', { text: label })]);

/** A short-lived message at the bottom-right. tone: good | warn | error */
export function toast(message, tone = 'good') {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const node = h('div', { class: `toast toast--${tone}` }, [
    icon(tone === 'good' ? 'circle-check' : tone === 'warn' ? 'info' : 'triangle-alert', 'size-4 shrink-0 mt-px'),
    h('p', { class: 't-body', html: escapeHtml(message) }),
  ]);
  host.append(node);
  refreshIcons(node);
  setTimeout(() => {
    node.classList.add('toast--out');
    setTimeout(() => node.remove(), 300);
  }, 5200);
}

/* ---------- stat tile ---------- */

/**
 * One of the number tiles across the top of a tab. Same card shell as a widget,
 * different insides: an icon, one big number, and a plain-English label.
 */
export function statTile({ label, hint, iconName, accent }) {
  const value = h('p', { class: 't-figure', text: '—' });
  const note = h('p', { class: 't-caption mt-1.5 min-h-[1rem]' });

  const content = h('div', { class: 'card-content' }, [
    h('p', { class: 't-caption font-medium text-slate-500', text: label }),
    value,
    note,
  ]);

  const overlay = h('div', { class: 'card-overlay' });
  const el = h('section', { class: 'card card--tile', title: hint || label }, [
    h('span', { class: 'tile-icon', style: `--accent:${accent}` }, [icon(iconName, 'size-[18px]')]),
    h('div', { class: 'card-body' }, [content, overlay]),
  ]);

  function setState(state) {
    el.dataset.state = state;
    overlay.replaceChildren();
    if (state === 'loading') overlay.append(skeleton('tile'));
    else if (state === 'error') overlay.append(h('p', { class: 't-figure text-slate-300', text: '—' }));
    refreshIcons(overlay);
  }

  setState('loading');
  return {
    el,
    setState,
    set(number, noteText = '') {
      value.textContent = formatNumber(number);
      note.textContent = noteText;
      setState('ready');
    },
  };
}
