/**
 * ai/updatebox.js — the "Update with AI" input box (Phase 3, the most important piece).
 *
 * The team pastes anything they learned — a call note, a WhatsApp/email thread, or a
 * blob mentioning several investors at once. We send it (with a compact list of the
 * real contacts) to Bedrock and get back a validated list of proposed changes. We NEVER
 * blind-write: the user sees a preview (one card per investor, old → new, editable, with
 * a memory note), ticks the ones to keep, and applies. Applying goes through the SAME
 * create/update/activity endpoints the grid and drawer use, so everything stays grounded
 * in real D1 rows.
 *
 * Exposed two ways: a prominent inline card on Overview (createUpdatePanel) and a modal
 * from the global header button (openUpdateBox). Both funnel into the same preview.
 */
import { h, icon, refreshIcons, toast } from '../ui.js';
import { ALL_STAGES, FIELD_LABELS } from '../config.js';
import { openModal } from '../components/modal.js';
import { tidy, formatDate, parseDate } from '../util.js';
import { openDrawer } from '../components/drawer.js';
import * as store from '../store.js';

const DATE_FIELDS = new Set(['lastContact', 'nextActionDate']);
const label = (f) => FIELD_LABELS[f] || f;
const contactById = (id) => store.getState().contacts.find((c) => c.id === id);
const PLACEHOLDER = 'e.g. Spoke to Rajesh at Tarang — moving ahead, wants the diligence pack. Priya said not now, revisit next quarter. Met a new prospect, Amit Shah from Blue Peak Family Office, keen on the long-only fund.';

function showVal(field, value) {
  if (!tidy(value)) return '—';
  if (DATE_FIELDS.has(field)) { const d = parseDate(value); return d ? formatDate(d) : tidy(value); }
  return tidy(value);
}

function fieldEditor(field, value) {
  if (field === 'stage') {
    const el = h('select', { class: 'field-input' }, [h('option', { value: '', text: '—' }),
      ...ALL_STAGES.map((s) => h('option', { value: s, text: s, selected: s === value ? '' : null }))]);
    el.value = value || '';
    return el;
  }
  if (field === 'whatsappOptIn') {
    return h('select', { class: 'field-input' }, ['', 'Yes', 'No'].map((o) =>
      h('option', { value: o, text: o || '—', selected: o === (value || '') ? '' : null })));
  }
  if (DATE_FIELDS.has(field)) return h('input', { class: 'field-input', type: 'date', value: value || '' });
  if (field === 'notes' || field === 'roughNotes') { const el = h('textarea', { class: 'field-input', rows: '2' }); el.value = value || ''; return el; }
  return h('input', { class: 'field-input', type: field === 'email' ? 'email' : 'text', value: value || '' });
}

/** One preview card. Resolves an ambiguous match to update-or-create, then collects. */
function buildCard(update) {
  const card = h('div', { class: 'upd-card' });
  const includeBox = h('input', { type: 'checkbox' });
  includeBox.checked = true;
  let resolved = null;        // 'update' | 'create'
  let resolvedId = null;
  let getFields = () => ({});
  let noteInput = h('textarea', { class: 'field-input', rows: '2' });

  const diffRow = (field, oldVal, editorEl) => h('div', { class: 'diff-row' }, [
    h('div', { class: 'diff-k', text: label(field) }),
    h('div', { class: 'diff-old', text: showVal(field, oldVal) }),
    icon('arrow-right', 'size-3.5 diff-arrow'),
    h('div', { class: 'diff-new' }, [editorEl]),
  ]);

  const head = (tag, name, contact) => h('div', { class: 'upd-head' }, [
    h('label', { class: 'upd-include', title: 'Include this change' }, [includeBox]),
    h('span', { class: `upd-tag upd-tag--${tag}`, text: tag === 'create' ? 'CREATE' : tag === 'update' ? 'UPDATE' : 'PICK ONE' }),
    h('span', { class: 'upd-name', text: name }),
    contact ? h('button', { class: 'upd-open', type: 'button', title: 'Open profile', onClick: () => openDrawer(contact) }, [icon('external-link', 'size-3.5')]) : null,
  ]);
  const noteBlock = () => {
    noteInput = h('textarea', { class: 'field-input', rows: '2' }); noteInput.value = update.note || '';
    return h('div', { class: 'upd-note' }, [
      h('div', { class: 'upd-note-lbl' }, [icon('brain', 'size-3.5'), h('span', { text: 'Memory note to save' })]),
      noteInput,
    ]);
  };

  function renderUpdate(contact) {
    resolved = 'update'; resolvedId = contact.id;
    const editors = {};
    const rows = Object.entries(update.proposedFields).map(([f, v]) => { const ed = fieldEditor(f, v); editors[f] = ed; return diffRow(f, contact[f], ed); });
    getFields = () => { const o = {}; for (const [f, ed] of Object.entries(editors)) o[f] = ed.value.trim(); return o; };
    card.replaceChildren(
      head('update', contact.fullName || 'Unnamed', contact),
      h('div', { class: 'upd-fields' }, rows.length ? rows : [h('p', { class: 't-caption px-1', text: 'No field changes — just a memory note.' })]),
      noteBlock(),
    );
    refreshIcons(card);
  }

  function renderCreate() {
    resolved = 'create'; resolvedId = null;
    const fields = { fullName: '', ...update.proposedFields };
    const order = ['fullName', ...Object.keys(fields).filter((f) => f !== 'fullName')];
    const editors = {};
    const rows = order.map((f) => { const ed = fieldEditor(f, fields[f]); editors[f] = ed; return diffRow(f, '', ed); });
    getFields = () => { const o = {}; for (const [f, ed] of Object.entries(editors)) o[f] = ed.value.trim(); return o; };
    card.replaceChildren(head('create', 'New contact', null), h('div', { class: 'upd-fields' }, rows), noteBlock());
    refreshIcons(card);
  }

  function renderAmbiguous() {
    const opts = update.candidates.map((id) => {
      const c = contactById(id); if (!c) return null;
      const b = h('button', { class: 'amb-opt', type: 'button' }, [
        h('div', { class: 'amb-name', text: c.fullName || 'Unnamed' }),
        h('div', { class: 'amb-sub', text: [c.organisation, c.email, c.stage].filter(Boolean).join(' · ') || '—' }),
      ]);
      b.addEventListener('click', () => renderUpdate(c));
      return b;
    }).filter(Boolean);
    const newBtn = h('button', { class: 'amb-opt amb-new', type: 'button' }, [icon('plus', 'size-3.5'), h('span', { text: 'Create a new contact instead' })]);
    newBtn.addEventListener('click', renderCreate);
    card.replaceChildren(
      head('amb', tidy(update.proposedFields.fullName) || 'Ambiguous match', null),
      h('p', { class: 't-caption px-1', text: 'This note could match more than one person. Pick the right one, or create new.' }),
      h('div', { class: 'amb-picker' }, [...opts, newBtn]),
    );
    refreshIcons(card);
  }

  if (update.matchType === 'existing' && contactById(update.contactId)) renderUpdate(contactById(update.contactId));
  else if (update.matchType === 'ambiguous' && update.candidates.length) renderAmbiguous();
  else renderCreate();

  return {
    el: card,
    collect() {
      if (!includeBox.checked) return null;
      if (!resolved) return { unresolved: true };
      const fields = getFields();
      const cleaned = {};
      for (const [k, v] of Object.entries(fields)) if (v !== '' && v != null) cleaned[k] = v;
      const note = (noteInput.value || '').trim();
      if (resolved === 'create' && !cleaned.fullName) return { error: 'A new contact needs a full name.' };
      if (!Object.keys(cleaned).length && !note) return null;
      return { action: resolved, id: resolvedId, fields: cleaned, note };
    },
  };
}

async function applyAll(cards, applyBtn, done) {
  const picks = [];
  for (const c of cards) {
    const r = c.collect();
    if (!r) continue;
    if (r.unresolved) { toast('Pick a contact for the highlighted card, or untick it.', 'warn'); return; }
    if (r.error) { toast(r.error, 'warn'); return; }
    picks.push(r);
  }
  if (!picks.length) { toast('Nothing ticked to apply.', 'warn'); return; }
  applyBtn.disabled = true; applyBtn.replaceChildren(icon('loader-circle', 'size-4 animate-spin'), h('span', { text: 'Saving…' })); refreshIcons(applyBtn);

  let updated = 0, created = 0, notes = 0, failed = 0;
  for (const p of picks) {
    try {
      let id = p.id;
      if (p.action === 'create') {
        const res = await store.createContact(p.fields, { silent: true });
        if (!res.ok) { failed += 1; continue; }
        id = res.contact.id; created += 1;
      } else if (Object.keys(p.fields).length) {
        const res = await store.updateContact(id, p.fields, { optimistic: false, silent: true });
        if (!res.ok) { failed += 1; continue; }
        updated += 1;
      }
      if (p.note && id != null) { const a = await store.logActivity(id, { type: 'Note', summary: p.note, source: 'Prompt box' }); if (a.ok) notes += 1; }
    } catch { failed += 1; }
  }
  store.resync();
  const bits = [];
  if (updated) bits.push(`${updated} updated`);
  if (created) bits.push(`${created} created`);
  if (notes) bits.push(`${notes} ${notes === 1 ? 'note' : 'notes'} saved`);
  if (failed) bits.push(`${failed} failed`);
  toast(bits.join(' · ') || 'Nothing to change.', failed ? 'warn' : 'good');
  done?.();
}

/** Modal showing the preview list + apply. Shared by the inline panel and the modal input. */
function openPreviewModal(updates) {
  const m = openModal({
    title: 'Review AI updates', iconName: 'wand-sparkles', wide: true,
    subtitle: `Review ${updates.length} proposed ${updates.length === 1 ? 'change' : 'changes'} — nothing saves until you apply.`,
  });
  const cards = updates.map((u) => buildCard(u));
  m.body.replaceChildren(h('div', { class: 'upd-list' }, cards.map((c) => c.el)));
  const apply = h('button', { class: 'btn btn-primary', type: 'button' }, [icon('check', 'size-4'), h('span', { text: 'Apply selected' })]);
  apply.addEventListener('click', () => applyAll(cards, apply, m.close));
  m.foot.replaceChildren(h('button', { class: 'btn btn-quiet', type: 'button', text: 'Cancel', onClick: m.close }), apply);
  m.refresh();
}

/** Read pasted text → preview modal. Returns true when a preview opened. */
async function readAndPreview(text, hint, setBusy) {
  if (!store.isLive()) { toast('Connect the database to file updates with AI.', 'warn'); return false; }
  if (!text.trim()) { toast('Paste the notes you want to file first.', 'warn'); return false; }
  setBusy?.(true);
  const res = await store.aiUpdate(text.trim(), (hint || '').trim());
  setBusy?.(false);
  if (!res.ok) {
    toast(res.code === 'no-bedrock' ? 'Turn on AI (set BEDROCK_API_KEY) to use this.' : (res.error || 'Could not read those notes.'), res.code === 'no-bedrock' ? 'warn' : 'error');
    return false;
  }
  if (!res.updates || !res.updates.length) { toast('No investors were recognised in that note — try naming the person.', 'warn'); return false; }
  openPreviewModal(res.updates);
  return true;
}

const busyToggle = (btn, labelText) => (busy) => {
  btn.disabled = busy;
  btn.replaceChildren(icon(busy ? 'loader-circle' : 'sparkles', `size-4${busy ? ' animate-spin' : ''}`), h('span', { text: busy ? 'Reading…' : labelText }));
  refreshIcons(btn);
};

/** The full modal input box (global header button). */
export function openUpdateBox({ hint = '' } = {}) {
  if (!store.isLive()) { toast('Connect the database to file updates with AI.', 'warn'); return; }
  const m = openModal({ title: 'Update with AI', iconName: 'wand-sparkles', wide: true, subtitle: 'Paste anything you learned — even several investors at once.' });
  const textarea = h('textarea', { class: 'field-input upd-textarea', rows: '7', placeholder: PLACEHOLDER });
  const hintInput = h('input', { class: 'field-input', type: 'text', placeholder: 'name / phone / unique ID', value: hint });
  const submit = h('button', { class: 'btn btn-primary', type: 'button' }, [icon('sparkles', 'size-4'), h('span', { text: 'Read & preview' })]);
  submit.addEventListener('click', async () => { if (await readAndPreview(textarea.value, hintInput.value, busyToggle(submit, 'Read & preview'))) m.close(); });
  m.body.replaceChildren(
    h('label', { class: 'upd-label', text: 'What did you learn?' }), textarea,
    h('label', { class: 'upd-label mt-3', text: 'Which investor? (optional — helps when the note is about one person)' }), hintInput,
  );
  m.foot.replaceChildren(h('button', { class: 'btn btn-quiet', type: 'button', text: 'Cancel', onClick: m.close }), submit);
  m.refresh();
  requestAnimationFrame(() => textarea.focus());
}

/** A prominent inline card for the Overview tab. Same funnel to the preview. */
export function createUpdatePanel() {
  const textarea = h('textarea', { class: 'field-input upd-textarea', rows: '3', placeholder: PLACEHOLDER });
  const hintInput = h('input', { class: 'field-input upd-hint', type: 'text', placeholder: 'Which investor? (optional)' });
  const submit = h('button', { class: 'btn btn-primary', type: 'button' }, [icon('sparkles', 'size-4'), h('span', { text: 'Read & preview' })]);
  submit.addEventListener('click', () => readAndPreview(textarea.value, hintInput.value, busyToggle(submit, 'Read & preview')));
  textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit.click(); });

  const el = h('section', { class: 'card ai-update-card' }, [
    h('div', { class: 'card-head' }, [
      h('span', { class: 'card-icon', style: '--accent:#4f46e5' }, [icon('wand-sparkles', 'size-[18px]')]),
      h('div', { class: 'min-w-0 flex-1' }, [
        h('h2', { class: 't-title', text: 'Update with AI' }),
        h('p', { class: 't-caption mt-0.5', text: 'Paste a call note, a WhatsApp or email thread, or several investors at once — we’ll file it for you.' }),
      ]),
    ]),
    h('div', { class: 'card-body' }, [
      h('div', { class: 'ai-update-body' }, [textarea, h('div', { class: 'ai-update-row' }, [hintInput, submit])]),
    ]),
  ]);
  return { el };
}
