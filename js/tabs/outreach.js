/**
 * tabs/outreach.js — Outreach: Compose + Campaigns in ONE tab (dashboard simplification).
 *
 * A sub-toggle switches between composing / personalising an investor email (with AI, the
 * recipient picker and the Zoho-ready copy-paste send-list export) and the campaign
 * performance view (funnels, reply split, engagement trend). Both existing modules are
 * embedded unchanged, so every feature of each is preserved — nothing is duplicated
 * elsewhere, and this is their single home.
 */
import { h, icon, refreshIcons } from '../ui.js';
import { render as renderCompose } from './compose.js';
import { render as renderCampaigns } from './campaigns.js';

export function render(container) {
  const composeHost = h('div', { class: 'outreach-view' });
  const campaignsHost = h('div', { class: 'outreach-view hidden' });

  const btns = {};
  const toggle = h('div', { class: 'mode-toggle outreach-toggle' },
    [['compose', 'Compose', 'mail-plus'], ['campaigns', 'Campaigns', 'send']].map(([k, label, ic]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(k === 'compose') }, [icon(ic, 'size-3.5'), h('span', { text: label })]);
      b.addEventListener('click', () => setView(k));
      btns[k] = b;
      return b;
    }));
  container.append(h('div', { class: 'flex items-center gap-3 flex-wrap outreach-bar' }, [toggle]), composeHost, campaignsHost);
  refreshIcons(container);

  // Embed both existing tab modules, unchanged.
  const compose = renderCompose(composeHost);
  const campaigns = renderCampaigns(campaignsHost);

  function setView(next) {
    for (const [k, b] of Object.entries(btns)) b.setAttribute('aria-pressed', String(k === next));
    composeHost.classList.toggle('hidden', next !== 'compose');
    campaignsHost.classList.toggle('hidden', next !== 'campaigns');
  }

  return {
    update(state) { compose.update?.(state); campaigns.update?.(state); },
    destroy() { compose.destroy?.(); campaigns.destroy?.(); },
  };
}
