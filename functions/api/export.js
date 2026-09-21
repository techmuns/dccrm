/**
 * /api/export — every contact as a CSV download, using the sheet's own header names.
 */
import { WRITABLE, HEADERS, noDb, fail, csvCell } from './_lib.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return noDb();
  try {
    const rows = await env.DB.prepare('SELECT * FROM contacts ORDER BY fullName COLLATE NOCASE').all();
    const header = WRITABLE.map((f) => csvCell(HEADERS[f] || f)).join(',');
    const lines = (rows.results || []).map((r) => WRITABLE.map((f) => csvCell(r[f])).join(','));
    const csv = '﻿' + [header, ...lines].join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="dhamma-contacts-${stamp}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return fail(`Could not export contacts: ${err.message}`, 500);
  }
}
