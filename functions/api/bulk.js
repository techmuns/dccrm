/**
 * /api/bulk — one batched action over many contacts.
 * Body: { action: 'stage'|'owner'|'tag'|'delete', ids: number[], value?: string, tagId?, name? }
 * Returns { ok, affected }.
 */
import { json, fail, noDb, now, readJson, ensureSchema, currentUser, TAG_PALETTE, gateViolation } from './_lib.js';

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/* Stages that gate on entry (Phase 10). A bulk move into one only touches the rows that
   already satisfy the gate; the rest are reported as blocked, never silently moved. */
const GATED_STAGES = new Set(['Diligence', 'Committed']);

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  let body;
  try { await ensureSchema(env); body = await readJson(request); } catch (err) { return fail(err.message, 400); }

  const action = String(body.action || '');
  const ids = Array.isArray(body.ids) ? body.ids.map((n) => parseInt(n, 10)).filter(Number.isInteger) : [];
  if (!ids.length) return fail('No contacts selected.', 400);
  if (ids.length > 10000) return fail('Too many contacts in one action.', 413);
  const ts = now();
  const who = currentUser(request);

  try {
    if (action === 'stage' || action === 'owner') {
      const col = action === 'stage' ? 'stage' : 'relationshipOwner';
      const value = String(body.value || '').trim() || null;

      // A bulk move INTO a gated stage only affects rows that already meet the gate.
      let targetIds = ids;
      let blocked = 0;
      if (action === 'stage' && value && GATED_STAGES.has(value)) {
        const rows = [];
        for (const group of chunk(ids, 100)) {
          const res = await env.DB.prepare(
            `SELECT id, stage, vehicle, targetTicket, committedAmount, fundingDate FROM contacts WHERE id IN (${group.map(() => '?').join(',')})`,
          ).bind(...group).all();
          rows.push(...(res.results || []));
        }
        targetIds = rows.filter((r) => gateViolation(r, { stage: value }) === null).map((r) => r.id);
        blocked = ids.length - targetIds.length;
        if (!targetIds.length) {
          const need = value === 'Diligence' ? 'Vehicle + Target ticket' : 'Committed amount + expected funding date';
          return json({ ok: true, affected: 0, blocked, message: `None moved — each needs ${need} first. Open a profile to fill them in.` });
        }
      }

      const stmts = chunk(targetIds, 100).map((group) => env.DB.prepare(
        `UPDATE contacts SET ${col} = ?, updatedAt = ?, updatedBy = ? WHERE id IN (${group.map(() => '?').join(',')})`,
      ).bind(value, ts, who, ...group));
      await env.DB.batch(stmts);
      const msg = blocked ? `${targetIds.length} moved · ${blocked} skipped (need the deal fields first).` : undefined;
      return json({ ok: true, affected: targetIds.length, blocked, message: msg });
    }

    if (action === 'tag') {
      // resolve or create the tag, then link it to all selected contacts
      let tag;
      if (body.tagId) tag = await env.DB.prepare('SELECT id FROM tags WHERE id = ?').bind(parseInt(body.tagId, 10)).first();
      if (!tag) {
        const name = String(body.name || body.value || '').trim();
        if (!name) return fail('Provide a tag name or id.', 400);
        tag = await env.DB.prepare('SELECT id FROM tags WHERE lower(name) = lower(?)').bind(name).first();
        if (!tag) {
          const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags').first();
          tag = await env.DB.prepare('INSERT INTO tags (name, colour) VALUES (?, ?) RETURNING id').bind(name, TAG_PALETTE[n % TAG_PALETTE.length]).first();
        }
      }
      const stmts = ids.map((cid) => env.DB.prepare('INSERT OR IGNORE INTO contact_tags (contactId, tagId) VALUES (?, ?)').bind(cid, tag.id));
      for (const b of chunk(stmts, 50)) await env.DB.batch(b);
      return json({ ok: true, affected: ids.length, tagId: tag.id });
    }

    if (action === 'delete') {
      const stmts = chunk(ids, 100).map((group) => env.DB.prepare(
        `DELETE FROM contacts WHERE id IN (${group.map(() => '?').join(',')})`,
      ).bind(...group));
      await env.DB.batch(stmts);
      return json({ ok: true, affected: ids.length });
    }

    return fail(`Unknown bulk action "${action}".`, 400);
  } catch (err) {
    return fail(`Bulk action failed: ${err.message}`, 500);
  }
}
