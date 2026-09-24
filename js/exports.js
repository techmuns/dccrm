/**
 * exports.js — give the team their data back out (Phase 4). No external sending: these
 * are downloads and clipboard copies only.
 *
 * (a) "Final Output" workbook — the SAME Excel they imported. The headers, order and
 *     meaning match the working-copy import exactly, so exporting then re-importing
 *     produces the same contacts (round-trips through HEADER_MAP / normalizeRows).
 * (b) A Zoho Campaigns send-list — Name, Email, Organisation, Stage — as a download or
 *     tab-separated clipboard text, skipping anyone with no email.
 *
 * Reuses SheetJS (window.XLSX, already loaded for Import).
 */
import { tidy } from './util.js';

/* The 25 working-copy columns, in order. Header text is chosen so each maps back to the
   SAME field on import (verified against HEADER_MAP): the file round-trips. */
export const EXPORT_COLUMNS = [
  ['fullName', 'Full Name'], ['organisation', 'Organisation'], ['roughNotes', 'Rough Notes for Raghav'],
  ['entityType', 'Entity Type'], ['role', 'Role'], ['designation', 'Designation'], ['email', 'Email'],
  ['phone', 'Phone'], ['whatsapp', 'WhatsApp Number'], ['whatsappOptIn', 'WhatsApp Opt-In'],
  ['country', 'Primary Country'], ['city', 'Primary City'], ['vehicle', 'Vehicle'], ['stage', 'Stage'],
  ['referredBy', 'Referred By'], ['lastContact', 'Last Contact'], ['nextAction', 'Next Action'],
  ['nextActionDate', 'Next Action Date'], ['relationshipOwner', 'Relationship Owner'],
  ['source', 'Source / Channel'], ['tier', 'Tier'], ['priority', 'Priority'], ['signal', 'Signal / Tags'],
  ['altPhone', 'Alt Phone'], ['notes', 'Notes'],
];

/* The Zoho send-list: a short, clean list ready to paste into a campaign. */
export const SENDLIST_COLUMNS = [
  ['fullName', 'Full Name'], ['email', 'Email'], ['organisation', 'Organisation'], ['stage', 'Stage'],
];

export const FINAL_OUTPUT_SHEET = 'Final Output';

const stamp = () => new Date().toISOString().slice(0, 10);
const cellValue = (v) => (v == null ? '' : String(v));   // empty stays empty (never "null")

/** Array-of-arrays for a sheet: header row, then one row per contact. */
export function aoaFor(contacts, columns) {
  const header = columns.map(([, h]) => h);
  const rows = contacts.map((c) => columns.map(([f]) => cellValue(c[f])));
  return [header, ...rows];
}

/* ---------- workbook / file helpers ---------- */

function requireXLSX() {
  if (!window.XLSX) throw new Error('The spreadsheet writer has not finished loading. Give it a moment and try again.');
  return window.XLSX;
}

function saveWorkbook(aoa, sheetName, filename) {
  const XLSX = requireXLSX();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);   // browser download
}

function saveBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v) => {
  const s = cellValue(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function toCsv(aoa) {
  return aoa.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
function toTsv(aoa) {
  return aoa.map((row) => row.map((v) => cellValue(v).replace(/[\t\n\r]/g, ' ')).join('\t')).join('\n');
}

/* ---------- (a) Final Output workbook ---------- */

/** Download the full "Final Output" workbook. Returns how many contacts were written. */
export function exportContactsXlsx(contacts, filename) {
  saveWorkbook(aoaFor(contacts, EXPORT_COLUMNS), FINAL_OUTPUT_SHEET, filename || `Dhamma Database - ${stamp()}.xlsx`);
  return contacts.length;
}

/* ---------- (b) Zoho send-list ---------- */

/** Split a set into those with an email (the ones a campaign can use) and the total. */
export function sendListParts(contacts) {
  const withEmail = (contacts || []).filter((c) => tidy(c.email));
  return { withEmail, total: (contacts || []).length };
}

export function exportSendListXlsx(contacts, filename) {
  const { withEmail } = sendListParts(contacts);
  saveWorkbook(aoaFor(withEmail, SENDLIST_COLUMNS), 'Send List', filename || `Zoho send list - ${stamp()}.xlsx`);
  return withEmail.length;
}

export function exportSendListCsv(contacts, filename) {
  const { withEmail } = sendListParts(contacts);
  saveBlob('﻿' + toCsv(aoaFor(withEmail, SENDLIST_COLUMNS)), 'text/csv;charset=utf-8', filename || `Zoho send list - ${stamp()}.csv`);
  return withEmail.length;
}

/** Tab-separated send-list, ready to paste straight into a sheet or Zoho. */
export function sendListTsv(contacts) {
  const { withEmail } = sendListParts(contacts);
  return toTsv(aoaFor(withEmail, SENDLIST_COLUMNS));
}

/* ---------- clipboard ---------- */

export async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}
