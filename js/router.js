/**
 * router.js — the tab system.
 *
 * A tab is an object with { id, render(container) -> { update(state), destroy() } }.
 * Adding the Contacts or Follow-ups tab later means registering one more of these;
 * nothing else in the app has to change.
 */
import { TABS } from './config.js';
import { h, icon, refreshIcons } from './ui.js';

const registry = new Map();
let active = null;      // { id, handle, container }
let viewEl = null;
let navEl = null;
let latestState = null;

export function registerTab(id, definition) {
  registry.set(id, definition);
}

export function mountTabs({ nav, view, initial = 'overview' }) {
  navEl = nav;
  viewEl = view;

  navEl.replaceChildren(...TABS.map((tab) => {
    const button = h('button', {
      class: `tab${tab.ready ? '' : ' tab--soon'}`,
      type: 'button',
      role: 'tab',
      dataset: { tab: tab.id },
      'aria-selected': String(tab.id === initial),
      title: tab.ready ? tab.label : `${tab.label} — coming in a later phase`,
    }, [
      icon(tab.icon, 'size-4'),
      h('span', { text: tab.label }),
      tab.ready ? null : h('span', { class: 'tab-soon', text: 'Soon' }),
    ]);
    // Tabs that are not built yet still open, onto their placeholder. Seeing what
    // is coming is more useful than a dead button.
    button.addEventListener('click', () => activate(tab.id));
    return button;
  }));

  refreshIcons(navEl);
  activate(initial);
}

export function activate(id) {
  if (active?.id === id) return;
  if (!registry.has(id)) return;

  active?.handle?.destroy?.();
  viewEl.replaceChildren();

  const container = h('div', { class: 'tab-panel', role: 'tabpanel' });
  viewEl.append(container);

  const handle = registry.get(id).render(container);
  active = { id, handle, container };

  for (const button of navEl.querySelectorAll('.tab')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === id));
  }

  if (latestState) handle.update?.(latestState);
  refreshIcons(container);
  viewEl.scrollTop = 0;
}

/** Called whenever the store changes; the live tab re-renders itself. */
export function pushState(state) {
  latestState = state;
  active?.handle?.update?.(state);
}
