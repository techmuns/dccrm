/**
 * tabs/coming-soon.js — the placeholder a not-yet-built tab renders.
 * Registered for every tab in config.TABS that is not marked ready.
 */
import { h, icon, refreshIcons } from '../ui.js';

export function comingSoon({ label, iconName, blurb, bullets = [] }) {
  return {
    render(container) {
      container.append(h('section', { class: 'card card--soon' }, [
        h('span', { class: 'soon-icon' }, [icon(iconName, 'size-6')]),
        h('h2', { class: 't-title mt-4', text: label }),
        h('p', { class: 't-body mt-2 max-w-md text-slate-500', text: blurb }),
        bullets.length
          ? h('ul', { class: 'soon-list' }, bullets.map((item) =>
              h('li', {}, [icon('circle-dashed', 'size-3.5 text-slate-300 shrink-0'), h('span', { text: item })])))
          : null,
      ]));
      refreshIcons(container);
      return { update() {}, destroy() {} };
    },
  };
}
