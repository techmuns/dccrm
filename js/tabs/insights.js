/**
 * tabs/insights.js — relationship intelligence (sample AI output for now).
 *
 * Joins the loaded contacts with AI-scored reply data (via ai-insights.js) and
 * surfaces: a priority queue to respond to, a sentiment + interest overview,
 * ready-to-review suggested replies, and a warm-but-quiet re-touch list. All
 * scoring lives in ai-insights.js, so real reply-reading swaps in with no UI change.
 */
import { PALETTE } from '../config.js';
import { card, h, icon, refreshIcons, toast } from '../ui.js';
import { donutOption, barOption } from '../charts.js';
import { formatNumber, formatDate, escapeHtml } from '../util.js';
import { colorOf } from '../colors.js';
import { createChartCard } from '../components/chartcard.js';
import { createSourceNote, readJsonFile } from '../components/source-note.js';
import { openDrawer } from '../components/drawer.js';
import {
  insightsSource, joinInsights, priorityQueue, quietWarm, sentimentSplit, scoreBuckets, priorityColor,
} from '../ai-insights.js';

/* copy-to-clipboard with graceful fallback */
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text;
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  btn.classList.add('done');
  btn.querySelector('span').textContent = 'Copied';
  setTimeout(() => { btn.classList.remove('done'); btn.querySelector('span').textContent = 'Copy reply'; }, 1800);
}

function draftBox(text) {
  const copyBtn = h('button', { class: 'copy-btn', type: 'button' }, [icon('copy', 'size-3.5'), h('span', { text: 'Copy reply' })]);
  copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyText(text, copyBtn); });
  return h('div', { class: 'draft-box' }, [
    h('div', { class: 'dh' }, [icon('sparkles', 'size-3'), 'AI-drafted reply — review before sending']),
    h('div', { text }),
    copyBtn,
  ]);
}

/** An expandable block: a header row that toggles a drafted reply open. */
function expandable(headerNodes, snippet, draft, extraClass = '') {
  const wrap = h('div', { class: `draft-wrap ${extraClass}` }, [h('div', { class: 'draft-inner' }, [draftBox(draft)])]);
  const toggle = h('button', { class: 'link-btn', type: 'button' },
    [icon('chevron-right', 'size-3.5 chev-r'), h('span', { text: 'Suggested reply' })]);
  const box = h('div', { class: 'xpand' }, [
    ...headerNodes,
    snippet ? h('div', { class: 'snippet quote', text: snippet }) : null,
    h('div', { class: 'pcard-actions' }, [toggle]),
    wrap,
  ]);
  toggle.addEventListener('click', () => box.classList.toggle('open'));
  return box;
}

function priorityCard(c) {
  const box = h('div', { class: 'pcard', style: `--c:${priorityColor(c.ai.priority)}` }, [
    expandable([
      h('div', { class: 'pcard-head' }, [
        h('div', { class: 'min-w-0' }, [
          h('div', { class: 'pcard-name', text: c.fullName }),
          h('div', { class: 'pcard-org', text: c.organisation || c.designation || c.entityType }),
        ]),
        h('div', { class: 'pcard-score' }, [
          h('div', { class: 'n', text: formatNumber(c.ai.interestScore) }),
          h('div', { class: 'l', text: 'interest' }),
        ]),
      ]),
      h('span', { class: 'reason-badge' }, [icon('flag', 'size-3.5'), `${c.ai.reason}`]),
    ], c.ai.lastReplySnippet, c.ai.suggestedReply),
  ]);
  // opening the profile: a small link under the name
  box.querySelector('.pcard-actions').append(
    (() => {
      const b = h('button', { class: 'link-btn', type: 'button', style: 'margin-left:auto;color:var(--ink-3)' },
        [icon('panel-right-open', 'size-3.5'), h('span', { text: 'Profile' })]);
      b.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(c); });
      return b;
    })(),
  );
  return box;
}

function replyItem(c) {
  return h('div', { class: 'reply-item' }, [
    expandable([
      h('div', { class: 'reply-head' }, [
        h('span', { class: 'nm', text: c.fullName }),
        h('span', { class: 'og', text: c.organisation ? `· ${c.organisation}` : '' }),
        h('span', { class: 'cat-chip ml-auto', style: `--c:${colorOf('entityType', c.entityType)}` },
          [h('span', { class: 'dot' }), h('span', { class: 'lbl', text: c.entityType })]),
      ]),
    ], c.ai.lastReplySnippet, c.ai.suggestedReply),
  ]);
}

function quietItem(c) {
  const el = h('div', { class: 'quiet-item', role: 'button', tabindex: '0' }, [
    h('div', { class: 'qmeta' }, [
      h('div', { class: 'qnm', text: c.fullName }),
      h('div', { class: 'qsub', text: `${c.organisation || c.entityType} · last reply ${c.ai.replyAgoDays} days ago` }),
    ]),
    h('div', { class: 'quiet-score' }, [
      h('div', { class: 'qn', text: formatNumber(c.ai.interestScore) }),
      h('div', { class: 'ql', text: 'interest' }),
    ]),
  ]);
  el.addEventListener('click', () => openDrawer(c));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDrawer(c); });
  return el;
}

export function render(container) {
  const note = createSourceNote({ source: insightsSource, accept: '.json', readFile: readJsonFile, noun: 'AI insights' });

  const sentiment = createChartCard({
    title: 'How they feel', subtitle: 'Sentiment of the latest replies.',
    iconName: 'smile', accent: PALETTE[2], chartClass: 'chart--mini-donut',
  });
  const buckets = createChartCard({
    title: 'How warm they are', subtitle: 'Interest score: Hot 70+, Warm 40–69, Cold under 40.',
    iconName: 'flame', accent: PALETTE[4], chartClass: 'chart--mini-hbar',
  });
  const overview = h('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-4' }, [
    h('div', { class: 'flex' }, [sentiment.el]),
    h('div', { class: 'flex' }, [buckets.el]),
  ]);

  /* priority queue */
  const pcards = h('div', { class: 'pcards' });
  const priorityCardEl = card({
    title: 'Respond within 2–3 days',
    subtitle: 'High-priority people who replied and asked questions.',
    iconName: 'zap', accent: PALETTE[4],
  });
  priorityCardEl.content.append(pcards);

  /* suggested replies + quiet */
  const replies = h('div', {});
  const repliesCard = card({ title: 'Ready-to-review replies', subtitle: 'AI drafts you can copy and send.', iconName: 'mail', accent: PALETTE[0] });
  repliesCard.content.append(replies);

  const quiet = h('div', {});
  const quietCard = card({ title: 'Interested but quiet', subtitle: 'Warm people who have gone silent — a gentle nudge.', iconName: 'moon', accent: PALETTE[3] });
  quietCard.content.append(quiet);

  const bottom = h('div', { class: 'grid grid-cols-1 lg:grid-cols-12 gap-4 items-start' }, [
    h('div', { class: 'lg:col-span-7' }, [repliesCard.el]),
    h('div', { class: 'lg:col-span-5' }, [quietCard.el]),
  ]);

  container.append(note.el, overview, priorityCardEl.el, bottom);
  refreshIcons(container);

  let latestState = null;

  function rebuild() {
    note.refresh();
    const contactsReady = latestState && latestState.status === 'ready';
    const s = insightsSource.state;

    if (!contactsReady || s.status === 'loading') {
      for (const w of [sentiment, buckets]) w.setState('loading');
      priorityCardEl.setState('loading'); repliesCard.setState('loading'); quietCard.setState('loading');
      return;
    }
    if (s.status === 'error') {
      for (const w of [sentiment, buckets]) w.setState('error', { message: s.error });
      priorityCardEl.setState('error', { message: s.error });
      repliesCard.setState('error', { message: s.error }); quietCard.setState('error', { message: s.error });
      return;
    }

    const list = joinInsights(latestState.contacts, s.data);
    if (!list.length) {
      const msg = 'No AI-scored replies match these contacts yet.';
      for (const w of [sentiment, buckets]) w.setState('empty', { message: msg });
      priorityCardEl.setState('empty', { message: msg });
      repliesCard.setState('empty', { message: msg }); quietCard.setState('empty', { message: msg });
      return;
    }

    /* overview charts */
    const sent = sentimentSplit(list);
    sentiment.draw(donutOption(sent, { centerValue: formatNumber(list.length), centerLabel: 'scored' }), sent, { showShare: true, valueLabel: 'People' });
    const bk = scoreBuckets(list).filter((b) => b.value > 0);
    buckets.draw(barOption(bk, { valueLabel: 'People' }), bk, { valueLabel: 'People' });

    /* priority queue */
    const queue = priorityQueue(list);
    priorityCardEl.setState('ready');
    priorityCardEl.head.querySelector('.t-caption').textContent =
      queue.length ? `${queue.length} ${queue.length === 1 ? 'person needs' : 'people need'} a reply soon.` : 'Nothing urgent right now.';
    pcards.replaceChildren(...(queue.length ? queue.map(priorityCard)
      : [h('p', { class: 't-caption py-4 text-center', text: 'No high-priority replies waiting — nicely on top of it.' })]));

    /* suggested replies (everyone with a draft, priority first) */
    const withDrafts = [...list].filter((c) => c.ai.suggestedReply)
      .sort((a, b) => (b.ai.isPriority - a.ai.isPriority) || (b.ai.interestScore - a.ai.interestScore));
    repliesCard.setState('ready');
    replies.replaceChildren(...withDrafts.slice(0, 12).map(replyItem));

    /* interested but quiet */
    const q = quietWarm(list);
    quietCard.setState('ready');
    quietCard.head.querySelector('.t-caption').textContent = q.length
      ? `${q.length} warm ${q.length === 1 ? 'contact has' : 'contacts have'} gone quiet.` : 'No warm contacts have gone quiet.';
    quiet.replaceChildren(...(q.length ? q.map(quietItem)
      : [h('p', { class: 't-caption py-4 text-center', text: 'Everyone warm has been in touch recently.' })]));

    refreshIcons(container);
  }

  const unsub = insightsSource.subscribe(rebuild);
  if (insightsSource.state.status === 'loading') insightsSource.init();

  return {
    update(state) { latestState = state; rebuild(); },
    destroy() {
      unsub();
      for (const w of [sentiment, buckets]) w.destroy();
    },
  };
}
