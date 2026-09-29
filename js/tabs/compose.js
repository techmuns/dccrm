/**
 * tabs/compose.js — "Compose with AI" (Phase 8): turn a short brief into a clean,
 * merge-ready investor email, preview it on a REAL contact, edit it, and export it
 * (HTML for Zoho + the matching send-list). Nothing is ever sent from the app.
 *
 * Grounded: the audience is real contacts (reusing the filter bar, saved segments and a
 * manual selection), the preview fills a real sample contact's name/organisation, and the
 * send-list reuses the Phase-4 exporter (skips anyone with no email). The generate call
 * goes through the shared Bedrock path (store.composeEmail → /api/ai/compose).
 */
import { h, icon, refreshIcons, toast } from '../ui.js';
import { formatNumber, tidy, debounce } from '../util.js';
import { createFilterBar } from '../components/filterbar.js';
import { chipCell } from '../components/cells.js';
import { isClosed } from '../data.js';
import { takeComposeAudience } from '../nav.js';
import {
  sendListParts, exportSendListXlsx, exportSendListCsv, sendListTsv, copyToClipboard,
  emailHtml, emailPlainText, downloadEmailHtml, fillPlaceholders, PLACEHOLDERS,
} from '../exports.js';
import * as store from '../store.js';

const LIST_CAP = 300;

function cardShell({ title, subtitle, iconName, accent, step }) {
  const caption = h('p', { class: 't-caption mt-0.5', text: subtitle || '' });
  const actions = h('div', { class: 'ml-auto flex items-center gap-2' });
  const head = h('div', { class: 'card-head' }, [
    step ? h('span', { class: 'compose-step', text: step }) : null,
    h('span', { class: 'card-icon', style: `--accent:${accent}` }, [icon(iconName, 'size-[18px]')]),
    h('div', { class: 'min-w-0 flex-1' }, [h('h2', { class: 't-title', text: title }), caption]),
    actions,
  ]);
  const body = h('div', { class: 'card-body' });
  return { el: h('section', { class: 'card' }, [head, body]), body, caption, actions };
}

async function copyEmailRich(html, text) {
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return true;
    }
  } catch { /* fall through to plain text */ }
  return copyToClipboard(text);
}

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const pos = start + text.length;
  input.focus();
  try { input.setSelectionRange(pos, pos); } catch { /* not a text field */ }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function render(container) {
  let currentState = null;
  let source = 'everyone';            // 'everyone' | 'filter' | 'segment'
  let handoffIds = null;              // a manual selection handed off from Contacts
  let checked = new Set();            // contact ids currently ticked (the audience)
  let generated = null;              // { subject, preheader, body } once composed
  let lastFocused = null;            // which editor a placeholder chip inserts into

  /* ---------- Card A · Audience ---------- */
  const cardA = cardShell({ title: 'Audience', subtitle: 'Who is this email for?', iconName: 'users', accent: '#a83a5b', step: 'A' });

  const filterBar = createFilterBar({
    dimensions: [
      { field: 'stage', label: 'Stage', icon: 'git-branch' },
      { field: 'heat', label: 'Heat', icon: 'flame' },
      { field: 'entityType', label: 'Type', icon: 'building-2' },
      { field: 'country', label: 'Country', icon: 'globe' },
      { field: 'relationshipOwner', label: 'Owner', icon: 'user-round' },
      { field: 'vehicle', label: 'Vehicle', icon: 'briefcase' },
      { field: 'source', label: 'Source', icon: 'route' },
    ],
    onChange: () => { resetChecked(); paintAudience(); },
  });

  const srcBtns = {};
  const sourceRow = h('div', { class: 'compose-src' }, [
    ['everyone', 'Everyone', 'users'], ['filter', 'Filter', 'sliders-horizontal'], ['segment', 'Saved segment', 'bookmark'],
  ].map(([key, label, ic]) => {
    const b = h('button', { class: `seg-btn${key === source ? ' is-on' : ''}`, type: 'button' }, [icon(ic, 'size-3.5'), h('span', { text: label })]);
    b.addEventListener('click', () => setSource(key));
    srcBtns[key] = b;
    return b;
  }));

  const handoffNote = h('div', { class: 'compose-handoff hidden' });
  const segmentSel = h('select', { class: 'field-input compose-seg hidden', 'aria-label': 'Saved segment' });
  segmentSel.addEventListener('change', () => {
    const seg = (currentState?.segments || []).find((s) => String(s.id) === segmentSel.value);
    if (!seg) return;
    try { filterBar.setSelections(JSON.parse(seg.filtersJson || '{}')); } catch { filterBar.clear(); }
    // onChange (via setSelections) refreshes the audience
  });

  const countLine = h('p', { class: 'compose-count' });
  const selectAllBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => { checked = new Set(baseList().map((c) => c.id)); paintAudience(); } }, [icon('check-check', 'size-3.5'), h('span', { text: 'Select all' })]);
  const clearSelBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => { checked = new Set(); paintAudience(); } }, [icon('square', 'size-3.5'), h('span', { text: 'Clear' })]);
  const listHost = h('div', { class: 'compose-list' });

  cardA.body.append(
    sourceRow, handoffNote, segmentSel, filterBar.el, filterBar.chipsEl,
    h('div', { class: 'compose-count-row' }, [countLine, h('div', { class: 'flex items-center gap-1.5 ml-auto' }, [selectAllBtn, clearSelBtn])]),
    listHost,
  );

  /* ---------- Card B · Brief ---------- */
  const cardB = cardShell({ title: 'Brief', subtitle: 'What is this email about?', iconName: 'pencil-line', accent: '#c08a2e', step: 'B' });
  const brief = h('textarea', { class: 'field-input', rows: '3', placeholder: 'e.g. Q3 update — the fund is performing well, we closed a new deal, and we want to thank investors and invite questions.' });
  let tone = 'Warm';
  const warmBtn = h('button', { class: 'seg-btn is-on', type: 'button', text: 'Warm' });
  const formalBtn = h('button', { class: 'seg-btn', type: 'button', text: 'Formal' });
  warmBtn.addEventListener('click', () => { tone = 'Warm'; warmBtn.classList.add('is-on'); formalBtn.classList.remove('is-on'); });
  formalBtn.addEventListener('click', () => { tone = 'Formal'; formalBtn.classList.add('is-on'); warmBtn.classList.remove('is-on'); });
  const keyPoints = h('textarea', { class: 'field-input', rows: '2', placeholder: 'Optional — one key point per line' });
  const genBtn = h('button', { class: 'btn btn-primary', type: 'button' }, [icon('sparkles', 'size-4'), h('span', { text: 'Generate email' })]);
  const briefNote = h('p', { class: 't-caption', text: '' });
  genBtn.addEventListener('click', () => generate());

  cardB.body.append(
    h('label', { class: 'compose-lbl', text: 'What’s this email about?' }), brief,
    h('div', { class: 'compose-brief-row' }, [
      h('label', { class: 'compose-field' }, [h('span', { class: 'compose-lbl', text: 'Tone' }), h('div', { class: 'draft-seg' }, [warmBtn, formalBtn])]),
      h('label', { class: 'compose-field flex-1' }, [h('span', { class: 'compose-lbl', text: 'Key points (optional)' }), keyPoints]),
    ]),
    h('div', { class: 'flex items-center gap-3 mt-3' }, [genBtn, briefNote]),
  );

  /* ---------- Card C · Email (hidden until generated) ---------- */
  const cardC = cardShell({ title: 'Email', subtitle: 'Edit, preview on a real contact, then export.', iconName: 'mail', accent: '#2e8b74', step: 'C' });
  cardC.el.classList.add('hidden');
  const regenBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('refresh-cw', 'size-3.5'), h('span', { text: 'Regenerate' })]);
  const saveBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('save', 'size-3.5'), h('span', { text: 'Save' })]);
  cardC.actions.append(saveBtn, regenBtn);
  regenBtn.addEventListener('click', () => generate());
  saveBtn.addEventListener('click', () => saveComposed());

  const subjectIn = h('input', { class: 'field-input', type: 'text', placeholder: 'Subject' });
  const preheaderIn = h('input', { class: 'field-input', type: 'text', placeholder: 'Preheader (inbox preview line)' });
  const bodyIn = h('textarea', { class: 'field-input compose-body', rows: '12', placeholder: 'Email body' });
  for (const el of [subjectIn, preheaderIn, bodyIn]) el.addEventListener('focus', () => { lastFocused = el; });
  const previewUpdate = debounce(() => renderPreview(), 250);
  for (const el of [subjectIn, preheaderIn, bodyIn]) el.addEventListener('input', () => { syncGenerated(); previewUpdate(); });

  const chips = h('div', { class: 'compose-chips' }, [
    h('span', { class: 'compose-chips-l', text: 'Insert:' }),
    ...PLACEHOLDERS.map((p) => {
      const b = h('button', { class: 'compose-chip', type: 'button', text: p });
      b.addEventListener('click', () => insertAtCursor(lastFocused && lastFocused !== subjectIn ? lastFocused : bodyIn, p));
      return b;
    }),
  ]);

  const previewFrame = h('iframe', { class: 'compose-frame', title: 'Email preview', sandbox: '' });
  const previewTo = h('div', { class: 'compose-preview-to' });
  const editorCol = h('div', { class: 'compose-editor' }, [
    h('label', { class: 'compose-lbl', text: 'Subject' }), subjectIn,
    h('label', { class: 'compose-lbl mt-2', text: 'Preheader' }), preheaderIn,
    h('label', { class: 'compose-lbl mt-2', text: 'Body' }), chips, bodyIn,
  ]);
  const previewCol = h('div', { class: 'compose-preview' }, [
    h('div', { class: 'compose-preview-head' }, [icon('eye', 'size-3.5'), h('span', { text: 'Live preview' }), h('span', { class: 'compose-preview-note', text: 'personalises per recipient' })]),
    previewTo, previewFrame,
  ]);

  /* export row */
  const copyBtn = h('button', { class: 'btn btn-primary', type: 'button' }, [icon('copy', 'size-4'), h('span', { text: 'Copy email' })]);
  const htmlBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, [icon('file-code-2', 'size-4'), h('span', { text: 'Download HTML' })]);
  copyBtn.addEventListener('click', async () => {
    const ok = await copyEmailRich(emailHtml(generated), emailPlainText(generated));
    toast(ok ? 'Email copied — paste into your email or Zoho.' : 'Could not copy.', ok ? 'good' : 'warn');
  });
  htmlBtn.addEventListener('click', () => { downloadEmailHtml(generated); toast('Downloaded a Zoho-ready .html file (placeholders kept).', 'good'); });

  const sendXlsx = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('sheet', 'size-3.5'), h('span', { text: '.xlsx' })]);
  const sendCsv = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('download', 'size-3.5'), h('span', { text: '.csv' })]);
  const sendCopy = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('clipboard-copy', 'size-3.5'), h('span', { text: 'Copy' })]);
  const sendNote = h('span', { class: 't-caption' });
  sendXlsx.addEventListener('click', () => { const n = exportSendListXlsx(audience()); toast(`Downloaded ${formatNumber(n)} recipients.`, 'good'); });
  sendCsv.addEventListener('click', () => { const n = exportSendListCsv(audience()); toast(`Downloaded ${formatNumber(n)} recipients.`, 'good'); });
  sendCopy.addEventListener('click', async () => { const ok = await copyToClipboard(sendListTsv(audience())); toast(ok ? 'Send-list copied — paste into Zoho or a sheet.' : 'Could not copy.', ok ? 'good' : 'warn'); });

  const exportRow = h('div', { class: 'compose-export' }, [
    h('div', { class: 'compose-export-main' }, [copyBtn, htmlBtn]),
    h('div', { class: 'compose-sendlist' }, [
      h('span', { class: 'compose-sendlist-l' }, [icon('send', 'size-3.5'), h('span', { text: 'Send list' })]),
      sendNote, sendXlsx, sendCsv, sendCopy,
    ]),
  ]);

  cardC.body.append(
    h('div', { class: 'compose-grid' }, [editorCol, previewCol]),
    exportRow,
  );

  /* ---------- saved emails strip ---------- */
  const savedStrip = h('div', { class: 'compose-saved hidden' });

  container.append(cardA.el, savedStrip, cardB.el, cardC.el);
  refreshIcons(container);

  /* ---------- audience logic ---------- */
  function baseList() {
    const all = currentState?.contacts || [];
    if (handoffIds) return all.filter((c) => handoffIds.has(c.id));   // respect an explicit handoff
    const pool = all.filter((c) => !isClosed(c));   // never email Closed (Passed / Disqualified) records
    if (source === 'everyone') return pool;
    return filterBar.apply(pool);
  }
  function audience() { const set = checked; return baseList().filter((c) => set.has(c.id)); }
  function resetChecked() { checked = new Set(baseList().map((c) => c.id)); }

  function setSource(next) {
    handoffIds = null;
    handoffNote.classList.add('hidden');
    source = next;
    for (const [k, b] of Object.entries(srcBtns)) b.classList.toggle('is-on', k === source);
    segmentSel.classList.toggle('hidden', source !== 'segment');
    filterBar.el.classList.toggle('hidden', source === 'everyone');
    filterBar.chipsEl.classList.toggle('hidden', source === 'everyone');
    if (source !== 'segment' && source !== 'filter') filterBar.clear();   // clear() also announces → paints
    resetChecked();
    paintAudience();
  }

  function paintAudience() {
    const base = baseList();
    const chosen = base.filter((c) => checked.has(c.id));
    const { withEmail } = sendListParts(chosen);
    countLine.replaceChildren(
      h('b', { text: formatNumber(chosen.length) }), ` selected · `,
      h('b', { text: formatNumber(withEmail.length) }), ` of ${formatNumber(chosen.length)} have an email`,
    );
    sendNote.textContent = `${formatNumber(withEmail.length)} with email`;

    const shown = base.slice(0, LIST_CAP);
    listHost.replaceChildren(...(shown.length ? shown.map(rowFor) : [h('p', { class: 't-caption py-6 text-center', text: 'No contacts match — widen the filter or pick “Everyone”.' })]));
    if (base.length > LIST_CAP) listHost.append(h('p', { class: 't-caption py-2 text-center', text: `Showing the first ${LIST_CAP} of ${formatNumber(base.length)}. All ${formatNumber(base.length)} are included.` }));
    refreshIcons(listHost);

    // keep preview/sample honest as the audience changes
    if (generated) renderPreview();
  }

  function rowFor(contact) {
    const box = h('input', { type: 'checkbox' });
    box.checked = checked.has(contact.id);
    box.addEventListener('change', () => { if (box.checked) checked.add(contact.id); else checked.delete(contact.id); paintAudience(); });
    const noEmail = !tidy(contact.email);
    return h('label', { class: `compose-row${noEmail ? ' is-noemail' : ''}` }, [
      box,
      h('div', { class: 'min-w-0 flex-1' }, [
        h('div', { class: 'compose-row-name', text: contact.fullName || 'Unnamed' }),
        h('div', { class: 'compose-row-sub', text: [contact.organisation, contact.email || 'no email'].filter(Boolean).join(' · ') }),
      ]),
      contact.stage ? chipCell('stage', contact.stage) : null,
    ]);
  }

  /* ---------- generate / edit / preview ---------- */
  function sampleContact() {
    const aud = audience();
    return aud.find((c) => tidy(c.email)) || aud[0] || baseList()[0] || null;
  }

  function syncGenerated() {
    generated = { subject: subjectIn.value, preheader: preheaderIn.value, body: bodyIn.value };
  }

  function fillEditor(email) {
    subjectIn.value = email.subject || '';
    preheaderIn.value = email.preheader || '';
    bodyIn.value = email.body || '';
    syncGenerated();
  }

  function renderPreview() {
    const c = sampleContact();
    previewTo.replaceChildren(
      h('span', { class: 'compose-to-k', text: 'To: ' }),
      h('span', { text: c ? `${c.fullName || 'Unnamed'}${c.email ? ' · ' + c.email : ''}` : 'a recipient' }),
    );
    const filled = {
      subject: fillPlaceholders(subjectIn.value, c),
      preheader: fillPlaceholders(preheaderIn.value, c),
      body: fillPlaceholders(bodyIn.value, c),
    };
    previewFrame.srcdoc = emailHtml(filled);
  }

  async function generate() {
    if (!store.isLive()) { toast('Connect the database to compose with AI.', 'warn'); return; }
    const briefText = brief.value.trim();
    if (!briefText) { toast('Tell me what the email is about first.', 'warn'); brief.focus(); return; }
    genBtn.disabled = regenBtn.disabled = true;
    const label = genBtn.querySelector('span');
    genBtn.replaceChildren(icon('loader-circle', 'size-4 animate-spin'), h('span', { text: 'Writing…' })); refreshIcons(genBtn);
    const res = await store.composeEmail({ brief: briefText, tone, keyPoints: keyPoints.value.trim() });
    genBtn.disabled = regenBtn.disabled = false;
    genBtn.replaceChildren(icon('sparkles', 'size-4'), h('span', { text: 'Generate email' })); refreshIcons(genBtn);
    if (!res.ok) {
      toast(res.code === 'no-bedrock' ? 'Turn on AI (set BEDROCK_API_KEY) to compose.' : (res.error || 'Could not compose that email.'), res.code === 'no-bedrock' ? 'warn' : 'error');
      return;
    }
    fillEditor({ subject: res.subject, preheader: res.preheader, body: res.body });
    cardC.el.classList.remove('hidden');
    renderPreview();
    cardC.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Draft ready — edit and preview below.', 'good');
  }

  /* ---------- saved emails ---------- */
  async function saveComposed() {
    if (!store.isLive()) { toast('Connect the database to save emails.', 'warn'); return; }
    if (!bodyIn.value.trim() && !subjectIn.value.trim()) { toast('Nothing to save yet.', 'warn'); return; }
    const name = (prompt('Name this email (to reuse later):', subjectIn.value.slice(0, 80)) || '').trim();
    if (!name) return;
    const res = await store.saveEmail({ name, subject: subjectIn.value, preheader: preheaderIn.value, body: bodyIn.value });
    if (!res.ok) { toast(res.error || 'Could not save.', 'error'); return; }
    toast(`Saved “${name}”.`, 'good');
    loadSaved();
  }

  async function loadSaved() {
    if (!store.isLive()) { savedStrip.classList.add('hidden'); return; }
    const res = await store.listEmails();
    const emails = res.emails || [];
    if (!emails.length) { savedStrip.classList.add('hidden'); savedStrip.replaceChildren(); return; }
    savedStrip.classList.remove('hidden');
    savedStrip.replaceChildren(
      h('span', { class: 'compose-saved-l' }, [icon('bookmark', 'size-3.5'), h('span', { text: 'Saved emails' })]),
      ...emails.map((em) => {
        const chip = h('span', { class: 'compose-saved-chip' }, [
          h('button', { class: 'compose-saved-load', type: 'button', title: 'Load this email', onClick: () => {
            fillEditor(em); cardC.el.classList.remove('hidden'); renderPreview();
            cardC.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } }, [icon('mail', 'size-3.5'), h('span', { text: em.name })]),
          h('button', { class: 'compose-saved-del', type: 'button', 'aria-label': `Delete ${em.name}`, onClick: async () => {
            const r = await store.deleteEmail(em.id); if (!r.ok) { toast(r.error || 'Could not delete.', 'warn'); return; } loadSaved();
          } }, [icon('x', 'size-3')]),
        ]);
        return chip;
      }),
    );
    refreshIcons(savedStrip);
  }

  /* ---------- lifecycle ---------- */
  let warmed = false;
  function update(state) {
    currentState = state;
    if (state.status !== 'ready') return;
    filterBar.setData(state.contacts);

    // segment dropdown options
    const segs = state.segments || [];
    segmentSel.replaceChildren(
      h('option', { value: '', text: segs.length ? 'Pick a saved segment…' : 'No saved segments yet' }),
      ...segs.map((s) => h('option', { value: String(s.id), text: s.name })),
    );

    // a handoff from Contacts (the current selection) preloads a manual audience
    if (!warmed) {
      const ids = takeComposeAudience();
      if (ids && ids.size) {
        handoffIds = ids;
        source = 'everyone';
        for (const [k, b] of Object.entries(srcBtns)) b.classList.toggle('is-on', k === source);
        filterBar.el.classList.add('hidden'); filterBar.chipsEl.classList.add('hidden'); segmentSel.classList.add('hidden');
        handoffNote.classList.remove('hidden');
        handoffNote.replaceChildren(
          icon('check-check', 'size-3.5'),
          h('span', { html: `Using <b>${formatNumber(ids.size)}</b> contact${ids.size === 1 ? '' : 's'} selected on the Contacts tab.` }),
          h('button', { class: 'compose-handoff-x', type: 'button', text: 'Use a filter instead', onClick: () => setSource('filter') }),
        );
        refreshIcons(handoffNote);
      }
      warmed = true;
      if (store.isLive()) briefNote.textContent = 'One click writes a professional draft. Nothing is ever sent from here.';
      else briefNote.textContent = 'Preview mode — connect the database to compose with AI.';
      loadSaved();
      resetChecked();
    } else {
      // later store emits: keep the user's manual selection, just drop ids that vanished
      const ids = new Set((state.contacts || []).map((c) => c.id));
      for (const id of [...checked]) if (!ids.has(id)) checked.delete(id);
    }

    paintAudience();
  }

  return {
    update,
    destroy() { /* nothing persistent */ },
  };
}
