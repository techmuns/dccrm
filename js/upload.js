/**
 * upload.js — reads a spreadsheet the user drops in, entirely in the browser.
 *
 * Nothing leaves the machine. The file is parsed with SheetJS, the header row is
 * found even when it is not the very first row, and the rows are handed to the
 * data layer in exactly the same shape as the sample JSON.
 */
import { mapHeaders } from './data.js';

export const ACCEPTED = '.xlsx,.xls,.csv';

const MAX_BYTES = 25 * 1024 * 1024;

/** How many of our known fields a candidate header row recognises. */
function scoreHeaderRow(sheet, headerRowIndex) {
  const probe = window.XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: '', raw: true });
  if (!probe.length) return { score: 0, rows: [] };
  const headers = [...new Set(probe.slice(0, 30).flatMap((row) => Object.keys(row || {})))];
  const { matched } = mapHeaders(headers);
  return { score: matched.length, rows: probe };
}

/**
 * Parse a File into raw sheet rows.
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

  // Try every sheet, and the first few rows of each as the header row. Real sheets
  // often start with a title row or a blank line above the actual headers.
  let best = { score: 0, rows: [], sheetName: workbook.SheetNames[0] };
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    for (let headerRow = 0; headerRow < 5; headerRow += 1) {
      const candidate = scoreHeaderRow(sheet, headerRow);
      if (candidate.score > best.score) best = { ...candidate, sheetName };
      if (best.score >= 8) break; // a clear winner, stop looking
    }
    if (best.score >= 8) break;
  }

  if (best.score < 3) {
    throw new Error(
      "We couldn't find the expected columns in that file. It needs a header row with " +
      'names like "Full Name", "Entity Type", "Stage" and "Primary Country".'
    );
  }

  return { rows: best.rows, sheetName: best.sheetName, matchedColumns: best.score };
}
