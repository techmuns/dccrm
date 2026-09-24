/**
 * upload.js — reads a spreadsheet the user drops in, entirely in the browser.
 *
 * Nothing leaves the machine. The file is parsed with SheetJS. Dhamma's working copy
 * has several sheets, so every sheet is scanned: for each we find the header row (it
 * is not always the first row) and score how many of our known columns it has. We
 * return all the sheets that look like contact lists, plus a suggested default — the
 * sheet named "Final Output" when present, otherwise the best-matching one — and let
 * the caller show a picker. Rows come out in the same shape as the sample JSON.
 */
import { mapHeaders } from './data.js';

export const ACCEPTED = '.xlsx,.xls,.csv';

const MAX_BYTES = 25 * 1024 * 1024;
const PREFERRED_SHEET = 'final output';   // matched case-insensitively

/** How many of our known fields a candidate header row recognises. */
function scoreHeaderRow(sheet, headerRowIndex) {
  const probe = window.XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: '', raw: true });
  if (!probe.length) return { score: 0, rows: [] };
  const headers = [...new Set(probe.slice(0, 30).flatMap((row) => Object.keys(row || {})))];
  const { matched } = mapHeaders(headers);
  return { score: matched.length, rows: probe };
}

/** Best header-row interpretation of one sheet: the row offset that recognises the most columns. */
function readSheet(sheet) {
  let best = { score: 0, rows: [] };
  for (let headerRow = 0; headerRow < 5; headerRow += 1) {
    const candidate = scoreHeaderRow(sheet, headerRow);
    if (candidate.score > best.score) best = candidate;
    if (best.score >= 8) break; // a clear winner, stop looking
  }
  return best;
}

/**
 * Parse a File into candidate sheets.
 * Returns { sheets: [{ name, rows, score }], defaultSheetName }.
 * Throws an Error with a message that is safe to show the user as-is.
 */
export async function parseSpreadsheet(file) {
  if (!file) throw new Error('No file was chosen.');
  if (file.size > MAX_BYTES) {
    throw new Error('That file is larger than 25 MB. Try exporting just the contact sheet.');
  }
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    throw new Error('Please choose an .xlsx, .xls or .csv file.');
  }
  if (!window.XLSX) {
    throw new Error('The spreadsheet reader has not finished loading. Give it a moment and try again.');
  }

  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true });
  } catch {
    throw new Error("We couldn't open that file. It may be password protected or not a real spreadsheet.");
  }

  if (!workbook.SheetNames?.length) throw new Error('That workbook has no sheets in it.');

  // Scan every sheet; keep the ones that recognisably hold contacts (3+ known columns).
  const sheets = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const best = readSheet(sheet);
    if (best.rows.length && best.score >= 3) sheets.push({ name, rows: best.rows, score: best.score });
  }

  if (!sheets.length) {
    throw new Error(
      "We couldn't find the expected columns in that file. It needs a header row with " +
      'names like "Full Name", "Entity Type", "Stage" and "Primary Country".'
    );
  }

  // Default: the "Final Output" sheet if it's there, otherwise the best-matching sheet.
  const preferred = sheets.find((s) => s.name.trim().toLowerCase() === PREFERRED_SHEET);
  const byScore = [...sheets].sort((a, b) => b.score - a.score || b.rows.length - a.rows.length);
  const defaultSheetName = (preferred || byScore[0]).name;

  return { sheets, defaultSheetName };
}
