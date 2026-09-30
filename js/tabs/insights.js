/**
 * tabs/insights.js — relationship intelligence (sample AI output for now).
 *
 * Joins the loaded contacts with AI-scored reply data (via ai-insights.js) and
 * surfaces: a priority queue to respond to, a sentiment + interest overview, and a
 * warm-but-quiet re-touch list. The reply drafts themselves are NOT shown here — they
 * live only in the Inbox tab. All scoring lives in ai-insights.js, so real reply-reading
 * swaps in with no UI change.
 */
import { PALETTE } from '../config.js';
import * as store from '../store.js';
import { card, h, icon, refreshIcons, toast } from '../ui.js';
import { donutOption, barOption } from '../charts.js';
import { formatNumber, formatDate } from '../util.js';
import { createChartCard } from '../components/chartcard.js';
import { createSourceNote, readJsonFile } from '../components/source-note.js';
import { openDrawer } from '../components/drawer.js';
import {
  insightsSource, joinInsights, priorityQueue, quietWarm, sentimentSplit, scoreBuckets, priorityColor,
} from '../ai-insights.js';

/* This section shows reply-scored INTELLIGENCE (who to respond to, who's gone quiet), not the
   reply drafts themselves — those (and their editable "suggested reply") live only in the Inbox
   tab. So no draft box / "Copy reply" is rendered here; each card links to the profile instead. */

function priorityCard(c) {
  const profileBtn = h('button', { class: 'link-btn', type: 'button', style: 'margin-left:auto;color:var(--ink-3)' },
    [icon('panel-right-open', 'size-3.5'), h('span', { text: 'Profile' })]);
  profileBtn.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(c); });
  return h('div', { class: 'pcard', style: `--c:${priorityColor(c.ai.priority)}` }, [
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
    c.ai.relationshipSummary ? h('div', { class: 'ai-line', text: c.ai.relationshipSummary }) : null,
    c.ai.suggestedNextStep ? h('div', { class: 'ai-next' }, [icon('arrow-right', 'size-3.5'), h('span', { text: c.ai.suggestedNextStep })]) : null,
    c.ai.lastReplySnippet ? h('div', { class: 'snippet quote', text: c.ai.lastReplySnippet }) : null,
    h('div', { class: 'pcard-actions' }, [profileBtn]),
  ].filter(Boolean));
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

/**
 * The AI-intelligence section (Phase-13 simplification): everything the old "AI Insights" tab
 * showed, as an embeddable section so it lives once, inside Overview. Returns { el, update,
 * destroy }. The rule-based Ask box + priorities list are NOT here — Overview already owns
 * those, so this section carries only the reply-scored intelligence.
 */
export function createInsightsSection() {
  const container = h('div', { class: 'insights-section' });
  const note = createSourceNote({ source: insightsSource, accept: '.json', readFile: readJsonFile, noun: 'AI insights' });

  /* Live toolbar (real data): re-score everyone via the bulk GitHub Action, plus when
     the AI last ran. Shown instead of the sample note when the database is connected. */
  const analysed = h('span', { class: 't-caption ai-analysed' });
  const refreshAllBtn = h('button', { class: 'sn-btn sn-btn--primary', type: 'button' },
    [icon('sparkles', 'size-3.5'), h('span', { text: 'Refresh all AI' })]);
  refreshAllBtn.addEventListener('click', onRefreshAll);
  const liveBar = h('div', { class: 'source-note source-note--live' }, [
    h('span', { class: 'sn-ico' }, [icon('brain-circuit', 'size-4')]),
    h('span', { class: 'sn-text' }, [h('b', { text: 'Live AI' }), document.createTextNode(' · scored from your contacts & replies '), analysed]),
    h('div', { class: 'sn-actions' }, [refreshAllBtn]),
  ]);
  const topNote = h('div', {}, [note.el, liveBar]);

  async function onRefreshAll() {
    refreshAllBtn.disabled = true;
    try {
      const res = await store.refreshAllAi('all');
      if (!res.ok) {
        if (res.code === 'no-dispatch') toast('Bulk scoring needs the GitHub dispatch secrets (see setup). You can still use “Refresh AI” on a single contact.', 'warn');
        else if (res.code === 'no-bedrock') toast('Set the BEDROCK_API_KEY secret to switch AI on.', 'warn');
        else toast(res.error || 'Could not start the run.', 'error');
        return;
      }
      toast('Scoring your contacts in the background — the tab updates in a few minutes.', 'good');
    } finally {
      refreshAllBtn.disabled = false;
    }
  }

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

  /* interested but quiet (the reply drafts themselves live only in the Inbox tab) */
  const quiet = h('div', {});
  const quietCard = card({ title: 'Interested but quiet', subtitle: 'Warm people who have gone silent — a gentle nudge.', iconName: 'moon', accent: PALETTE[3] });
  quietCard.content.append(quiet);

  container.append(topNote, overview, priorityCardEl.el, quietCard.el);
  refreshIcons(container);

  let latestState = null;

  function rebuild() {
    note.refresh();
    const live = store.isLive();
    note.el.style.display = live ? 'none' : '';
    liveBar.style.display = live ? '' : 'none';
    if (live) {
      const meta = store.getState().aiMeta;
      analysed.textContent = meta && meta.analyzedAt ? `· last analysed ${formatDate(new Date(meta.analyzedAt))}` : '· not scored yet';
      refreshIcons(liveBar);
    }
    const contactsReady = latestState && latestState.status === 'ready';
    const s = insightsSource.state;

    if (!contactsReady || s.status === 'loading') {
      for (const w of [sentiment, buckets]) w.setState('loading');
      priorityCardEl.setState('loading'); quietCard.setState('loading');
      return;
    }
    if (s.status === 'error') {
      for (const w of [sentiment, buckets]) w.setState('error', { message: s.error });
      priorityCardEl.setState('error', { message: s.error }); quietCard.setState('error', { message: s.error });
      return;
    }

    const list = joinInsights(latestState.contacts, s.data);
    if (!list.length) {
      const msg = live
        ? 'No AI scores yet — click “Refresh all AI” above, or open a contact and choose “Refresh AI”.'
        : 'No AI-scored replies match these contacts yet.';
      for (const w of [sentiment, buckets]) w.setState('empty', { message: msg });
      priorityCardEl.setState('empty', { message: msg }); quietCard.setState('empty', { message: msg });
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
    el: container,
    update(state) { latestState = state; rebuild(); },
    destroy() {
      unsub();
      for (const w of [sentiment, buckets]) w.destroy();
    },
  };
}
