/**
 * components/draftdialog.js — a standalone "Draft a message" modal.
 *
 * The same AI draft the contact drawer offers, but openable from anywhere (the Follow-ups
 * view uses it, pre-set to a reminder's intent). It reuses store.draftMessage and, on Save,
 * store.logActivity — so a saved draft lands in the contact's memory + timeline. It NEVER
 * sends anything: the output is an editable box with Copy / Save-as-note / Regenerate.
 */
import { h, icon, refreshIcons, toast } from '../ui.js';
import { openModal } from './modal.js';
import * as store from '../store.js';

const DRAFT_INTENTS = ['Warm intro', 'Gentle follow-up', 'Diligence follow-up', 'Re-engage (gone quiet)', 'Thank you / next step'];

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text;
    document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}

/**
 * Open the draft dialog for a contact.
 * @param {object} contact a normalised contact (needs an id to draft/save).
 * @param {object} [opts]
 * @param {string} [opts.intent] pre-selected message intent.
 * @param {boolean} [opts.autogenerate=true] generate immediately on open.
 */
export function openDraftDialog(contact, { intent, autogenerate = true } = {}) {
  if (!store.isLive()) { toast('Connect the database to draft messages.', 'warn'); return null; }
  const m = openModal({
    title: `Draft to ${contact.fullName || 'contact'}`, iconName: 'pen-line',
    subtitle: 'AI-drafted — review and edit before you send. Nothing is sent from here.',
  });

  const start = DRAFT_INTENTS.includes(intent) ? intent : DRAFT_INTENTS[1];
  const intentSel = h('select', { class: 'field-input' },
    DRAFT_INTENTS.map((i) => h('option', { value: i, text: i, selected: i === start ? '' : null })));
  intentSel.value = start;

  let channel = 'Email';
  const emailBtn = h('button', { class: 'seg-btn is-on', type: 'button', text: 'Email' });
  const waBtn = h('button', { class: 'seg-btn', type: 'button', text: 'WhatsApp' });
  emailBtn.addEventListener('click', () => { channel = 'Email'; emailBtn.classList.add('is-on'); waBtn.classList.remove('is-on'); subjectInput.classList.toggle('hidden', !subjectInput.value); });
  waBtn.addEventListener('click', () => { channel = 'WhatsApp'; waBtn.classList.add('is-on'); emailBtn.classList.remove('is-on'); subjectInput.classList.add('hidden'); });

  const subjectInput = h('input', { class: 'field-input draft-subject hidden', type: 'text', placeholder: 'Subject' });
  const output = h('textarea', { class: 'field-input draft-output', rows: '8', placeholder: 'Your draft will appear here — edit it freely before you use it.' });

  const genBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, [icon('refresh-cw', 'size-3.5'), h('span', { text: 'Regenerate' })]);
  const copyBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, [icon('copy', 'size-4'), h('span', { text: 'Copy' })]);
  const saveBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, [icon('save', 'size-4'), h('span', { text: 'Save as note' })]);
  const doneBtn = h('button', { class: 'btn btn-primary', type: 'button', text: 'Done', onClick: m.close });

  const fullText = () => (!subjectInput.classList.contains('hidden') && subjectInput.value ? `Subject: ${subjectInput.value}\n\n` : '') + output.value;

  async function generate() {
    genBtn.disabled = true; genBtn.replaceChildren(icon('loader-circle', 'size-3.5 animate-spin'), h('span', { text: 'Writing…' })); refreshIcons(genBtn);
    const res = await store.draftMessage(contact.id, intentSel.value, channel);
    genBtn.disabled = false; genBtn.replaceChildren(icon('refresh-cw', 'size-3.5'), h('span', { text: 'Regenerate' })); refreshIcons(genBtn);
    if (!res.ok) {
      toast(res.code === 'no-bedrock' ? 'Turn on AI (set BEDROCK_API_KEY) to draft — or type your own below.' : (res.error || 'Could not draft a message.'), res.code === 'no-bedrock' ? 'warn' : 'error');
      output.focus();
      return;
    }
    if (channel === 'Email' && res.subject) { subjectInput.value = res.subject; subjectInput.classList.remove('hidden'); }
    else { subjectInput.value = ''; subjectInput.classList.add('hidden'); }
    output.value = res.draft || '';
    output.focus();
  }

  genBtn.addEventListener('click', generate);
  intentSel.addEventListener('change', generate);
  copyBtn.addEventListener('click', async () => toast(await copyText(fullText()) ? 'Copied to clipboard.' : 'Could not copy.', 'good'));
  saveBtn.addEventListener('click', async () => {
    const text = output.value.trim();
    if (!text) { toast('Nothing to save yet.', 'warn'); return; }
    const subj = (!subjectInput.classList.contains('hidden') && subjectInput.value) ? ` ${subjectInput.value} —` : '';
    const r = await store.logActivity(contact.id, { type: 'Note', summary: `[${intentSel.value} · ${channel}]${subj} ${text}`, source: 'AI draft' });
    toast(r.ok ? 'Saved to memory & timeline.' : (r.error || 'Could not save.'), r.ok ? 'good' : 'warn');
  });

  m.body.replaceChildren(
    h('div', { class: 'draft-controls' }, [
      h('label', { class: 'draft-field' }, [h('span', { class: 'draft-lbl', text: 'Purpose' }), intentSel]),
      h('label', { class: 'draft-field' }, [h('span', { class: 'draft-lbl', text: 'Channel' }), h('div', { class: 'draft-seg' }, [emailBtn, waBtn])]),
      h('div', { class: 'draft-field ml-auto self-end' }, [genBtn]),
    ]),
    h('div', { class: 'mt-2' }, [subjectInput, output]),
  );
  m.foot.replaceChildren(copyBtn, saveBtn, doneBtn);
  m.refresh();

  if (autogenerate) generate();
  else requestAnimationFrame(() => output.focus());
  return m;
}
