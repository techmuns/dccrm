/**
 * tabs/inbox.js — the Inbox / New replies view (Phase 12).
 *
 * Lists recent inbound investor emails the reader pipeline classified: the matched contact,
 * the category, a one-line summary, the suggested stage, and the AI's editable suggested reply
 * (Copy / Save as note). Everything is grounded — each row is a real stored reply matched to a
 * real contact — and nothing is ever sent from here. The same emails also appear on each
 * contact's Timeline and feed the priorities / follow-ups.
 */
import { h, icon, refreshIcons, toast } from '../ui.js';
import { formatDate, parseDate, formatNumber } from '../util.js';
import { openDrawer } from '../components/drawer.js';
import * as store from '../store.js';

const SENTIMENT = {
  Positive: { c: '#2e8b74', label: 'Positive' },
  Neutral: { c: '#6b7a99', label: 'Neutral' },
  Negative: { c: '#c0392b', label: 'Negative' },
};

function cardShell({ title, subtitle, iconName, accent }) {
  const caption = h('p', { class: 't-caption mt-0.5', text: subtitle || '' });
  const body = h('div', { class: 'card-body' });
  const actions = h('div', { class: 'ml-auto flex items-center gap-2' });
  const head = h('div', { class: 'card-head' }, [
    h('span', { class: 'card-icon', style: `--accent:${accent}` }, [icon(iconName, 'size-[18px]')]),
    h('div', { class: 'min-w-0 flex-1' }, [h('h2', { class: 't-title', text: title }), caption]),
    actions,
  ]);
  return { el: h('section', { class: 'card' }, [head, body]), body, caption, actions };
}

export function render(container) {
  const shell = cardShell({
    title: 'Inbox', subtitle: 'New replies from investors — classified and drafted. Nothing is ever sent automatically.',
    iconName: 'inbox', accent: '#4c6ea5',
  });
  const refreshBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('refresh-cw', 'size-3.5'), h('span', { text: 'Refresh' })]);
  shell.actions.append(refreshBtn);
  const host = h('div', { class: 'inbox-host' });
  shell.body.append(host);
  container.append(shell.el);
  refreshIcons(container);

  let currentState = null;
  let replies = [];

  const contactOf = (r) => (currentState?.contacts || []).find((c) => c.id === r.contactId) || null;

  function replyCard(r) {
    const contact = contactOf(r);
    const name = contact
      ? h('button', { class: 'inbox-name', type: 'button', title: 'Open contact', onClick: () => openDrawer(contact) },
        [h('span', { class: 'nm', text: contact.fullName || r.fromName || 'Unnamed' }), h('span', { class: 'sub', text: contact.organisation || r.contactOrg || r.fromEmail || '' })])
      : h('span', { class: 'inbox-name' }, [h('span', { class: 'nm', text: r.fromName || r.fromEmail || 'Unknown sender' }), h('span', { class: 'sub', text: r.fromEmail || '' })]);

    const sent = SENTIMENT[r.sentiment] || SENTIMENT.Neutral;
    const meta = h('div', { class: 'inbox-meta' }, [
      r.category ? h('span', { class: 'inbox-cat', text: r.category }) : null,
      h('span', { class: 'inbox-sent', style: `--c:${sent.c}` }, [h('span', { class: 'dot' }), h('span', { text: sent.label })]),
      r.suggestedStage ? h('span', { class: 'inbox-stage', title: 'Suggested stage from this email' }, [icon('git-branch', 'size-3'), h('span', { text: r.suggestedStage })]) : null,
      h('span', { class: 'inbox-date', text: r.receivedAt ? formatDate(parseDate(r.receivedAt)) : '' }),
    ]);

    const draft = h('textarea', { class: 'field-input inbox-draft', rows: '5' });
    draft.value = r.draftReply || '';
    const copyBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('copy', 'size-3.5'), h('span', { text: 'Copy' })]);
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(draft.value); toast('Draft copied.', 'good'); }
      catch { draft.select(); toast('Press Ctrl/⌘+C to copy.', 'warn'); }
    });
    const saveBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('sticky-note', 'size-3.5'), h('span', { text: 'Save as note' })]);
    saveBtn.addEventListener('click', async () => {
      if (!contact) { toast('No matched contact to save this note on.', 'warn'); return; }
      if (!draft.value.trim()) { toast('Nothing to save.', 'warn'); return; }
      saveBtn.disabled = true;
      const res = await store.logActivity(contact.id, { type: 'Note', summary: `Draft reply (from Inbox):\n${draft.value.trim()}`, source: 'Inbox' });
      saveBtn.disabled = false;
      if (!res.ok) { toast(res.error || 'Could not save.', 'warn'); return; }
      toast('Saved to the contact timeline.', 'good');
    });
    const openBtn = contact ? h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => openDrawer(contact) }, [icon('user-round', 'size-3.5'), h('span', { text: 'Open' })]) : null;

    return h('div', { class: 'inbox-row' }, [
      h('div', { class: 'inbox-top' }, [name, meta]),
      r.subject ? h('div', { class: 'inbox-subject', text: r.subject }) : null,
      r.summary ? h('p', { class: 'inbox-summary', text: r.summary }) : null,
      h('div', { class: 'inbox-draftwrap' }, [
        h('div', { class: 'inbox-draft-l' }, [icon('pen-line', 'size-3.5'), h('span', { text: 'Suggested reply — edit before you use it (never sent automatically)' })]),
        draft,
        h('div', { class: 'inbox-actions' }, [copyBtn, saveBtn, openBtn].filter(Boolean)),
      ]),
    ]);
  }

  function paint() {
    if (!store.isLive()) {
      host.replaceChildren(h('p', { class: 't-caption py-8 text-center', text: 'Connect the database to see the inbox.' }));
      return;
    }
    shell.caption.textContent = replies.length
      ? `${formatNumber(replies.length)} recent ${replies.length === 1 ? 'reply' : 'replies'} — classified and drafted. Nothing is ever sent automatically.`
      : 'New replies from investors — classified and drafted. Nothing is ever sent automatically.';
    if (!replies.length) {
      host.replaceChildren(h('div', { class: 'inbox-empty' }, [
        icon('inbox', 'size-6'),
        h('p', { class: 'inbox-empty-t', text: 'No replies yet.' }),
        h('p', { class: 't-caption', text: 'When investors email the catcher inbox, their replies land here — matched, classified and drafted.' }),
      ]));
      return;
    }
    host.replaceChildren(...replies.map(replyCard));
    refreshIcons(host);
  }

  async function load() {
    if (!store.isLive()) { paint(); return; }
    const res = await store.listReplies('?limit=200');
    replies = (res && res.replies) || [];
    paint();
  }
  refreshBtn.addEventListener('click', load);

  function update(state) {
    currentState = state;
    if (state.status === 'loading') { host.replaceChildren(h('p', { class: 't-caption py-8 text-center', text: 'Loading…' })); return; }
    if (state.status === 'error') { host.replaceChildren(h('p', { class: 't-caption py-8 text-center', text: state.error })); return; }
    load();
  }

  return { update, destroy() { /* nothing persistent */ } };
}
