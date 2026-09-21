/**
 * components/source-note.js — the small "Sample data — connects to live source
 * later" bar, with Replace… and Reset actions. Mirrors the header's data chip but
 * scoped to a tab's own data source, so a real feed can replace the sample the same
 * way an uploaded sheet replaces the sample contacts.
 */
import { h, icon, refreshIcons, toast } from '../ui.js';
import { formatDate } from '../util.js';

export function createSourceNote({ source, accept = '.json', readFile, noun = 'data' }) {
  const text = h('span', { class: 'sn-text' });
  const fileInput = h('input', { type: 'file', accept, class: 'hidden' });
  fileInput.addEventListener('change', (e) => onFile(e.target.files?.[0]));

  const replaceBtn = h('button', { class: 'sn-btn', type: 'button', onClick: () => fileInput.click() },
    [icon('upload', 'size-3.5'), 'Replace…']);
  const resetBtn = h('button', { class: 'sn-btn', type: 'button', title: 'Back to the sample data',
    onClick: async () => { await source.reset(); toast(`Back to the sample ${noun}.`, 'good'); } });
  resetBtn.append(icon('rotate-ccw', 'size-3.5'), document.createTextNode('Reset'));

  const el = h('div', { class: 'source-note' }, [
    h('span', { class: 'sn-ico' }, [icon('flask-conical', 'size-4')]),
    text,
    h('div', { class: 'sn-actions' }, [replaceBtn, resetBtn, fileInput]),
  ]);

  async function onFile(file) {
    if (!file) return;
    replaceBtn.disabled = true;
    try {
      const raw = await readFile(file);
      source.replace(raw, file.name);
      toast(`Loaded ${noun} from “${file.name}”.`, 'good');
      if (!source.state.persisted) toast("That file was too big to remember after a refresh.", 'warn');
    } catch (err) {
      toast(err.message || "We couldn't read that file.", 'error');
    } finally {
      replaceBtn.disabled = false;
      fileInput.value = '';
    }
  }

  function refresh() {
    const s = source.state;
    if (s.origin === 'upload') {
      text.innerHTML = `<b>Your data</b> · ${s.fileName ? s.fileName + ' · ' : ''}connects to a live source later`;
      resetBtn.style.display = '';
    } else {
      text.innerHTML = `<b>Sample ${noun}</b> — connects to a live source later`;
      resetBtn.style.display = 'none';
    }
    refreshIcons(el);
  }

  refresh();
  return { el, refresh };
}

/* file readers the tabs pass in */
export async function readJsonFile(file) {
  const txt = await file.text();
  try { return JSON.parse(txt); }
  catch { throw new Error('That file is not valid JSON.'); }
}

export async function readTabularFile(file) {
  if (/\.json$/i.test(file.name)) return readJsonFile(file);
  if (!window.XLSX) throw new Error('The spreadsheet reader is still loading — try again in a moment.');
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
}
