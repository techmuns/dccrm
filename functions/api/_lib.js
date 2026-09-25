/**
 * functions/api/_lib.js — shared helpers for the CRM API (Cloudflare Pages Functions).
 * Underscore-prefixed, so Pages does not treat it as a route.
 *
 * Includes ensureSchema(): the database is self-initializing — on first run it
 * creates any missing tables, migrates in new columns, and seeds sample data, so no
 * manual SQL step is ever needed.
 */
import { SEED_CONTACTS } from './_seed.js';

/* The columns a client may write on a contact. id / createdAt / updatedAt / updatedBy
   are server-managed. */
export const WRITABLE = [
  'fullName', 'entityType', 'role', 'organisation', 'designation', 'email', 'phone', 'altPhone',
  'whatsapp', 'whatsappOptIn', 'country', 'city', 'vehicle', 'stage', 'tier', 'priority', 'referredBy',
  'lastContact', 'nextAction', 'nextActionDate', 'relationshipOwner', 'source', 'signal', 'notes', 'roughNotes',
];

export const HEADERS = {
  fullName: 'Full Name', entityType: 'Entity Type', role: 'Role', organisation: 'Organisation Name',
  designation: 'Designation', email: 'Email', phone: 'Phone (display)', altPhone: 'Alt Phone',
  whatsapp: 'WhatsApp Number (E.164)', whatsappOptIn: 'WhatsApp Opt-In', country: 'Primary Country', city: 'Primary City',
  vehicle: 'Vehicle', stage: 'Stage', tier: 'Tier', priority: 'Priority', referredBy: 'Referred By',
  lastContact: 'Last Contact', nextAction: 'Next Action', nextActionDate: 'Next Action Date',
  relationshipOwner: 'Relationship Owner', source: 'Source / Channel', signal: 'Signal / Tags',
  notes: 'Notes', roughNotes: 'Rough Notes for Raghav',
};

export const TAG_PALETTE = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

export const fail = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);
export const noDb = () => json({ error: 'Database not connected', code: 'no-database' }, 503);
export const now = () => new Date().toISOString();

const trim = (v) => (v == null ? '' : String(v).trim());
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Who is signed in, from the Cloudflare Access header — or "Team" before Access is on. */
export function currentUser(request) {
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  return email && email.trim() ? email.trim() : 'Team';
}

export function cleanPayload(body, mode = 'create') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object of contact fields.');
  const values = {};
  for (const key of WRITABLE) {
    if (!(key in body)) continue;
    let v = trim(body[key]);
    if (key === 'email') v = v.toLowerCase();
    values[key] = v === '' ? null : v;
  }
  if (values.email && !EMAIL_RE.test(values.email)) throw new Error(`"${values.email}" does not look like an email address.`);
  if (mode === 'create') {
    if (!(values.fullName || values.email || values.organisation)) {
      throw new Error('A contact needs at least a name, an email or an organisation.');
    }
  } else if (!Object.keys(values).length) {
    throw new Error('No editable fields were provided.');
  }
  return values;
}

export async function readJson(request) {
  try { return await request.json(); }
  catch { throw new Error('The request body was not valid JSON.'); }
}

export const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* ---------- self-initializing schema ---------- */

let schemaReady = false;

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS contacts (
     id INTEGER PRIMARY KEY AUTOINCREMENT, fullName TEXT, entityType TEXT, role TEXT, organisation TEXT,
     designation TEXT, email TEXT UNIQUE, phone TEXT, whatsapp TEXT, whatsappOptIn TEXT, country TEXT, city TEXT,
     vehicle TEXT, stage TEXT, referredBy TEXT, lastContact TEXT, nextAction TEXT, nextActionDate TEXT,
     relationshipOwner TEXT, source TEXT, notes TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, updatedBy TEXT)`,
  `CREATE TABLE IF NOT EXISTS activities (
     id INTEGER PRIMARY KEY AUTOINCREMENT, contactId INTEGER NOT NULL, type TEXT, summary TEXT, occurredAt TEXT,
     createdBy TEXT, createdAt TEXT NOT NULL, FOREIGN KEY (contactId) REFERENCES contacts(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS tasks (
     id INTEGER PRIMARY KEY AUTOINCREMENT, contactId INTEGER, title TEXT NOT NULL, dueDate TEXT,
     done INTEGER NOT NULL DEFAULT 0, owner TEXT, createdBy TEXT, createdAt TEXT NOT NULL,
     FOREIGN KEY (contactId) REFERENCES contacts(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, colour TEXT)`,
  `CREATE TABLE IF NOT EXISTS contact_tags (
     contactId INTEGER NOT NULL, tagId INTEGER NOT NULL, PRIMARY KEY (contactId, tagId),
     FOREIGN KEY (contactId) REFERENCES contacts(id) ON DELETE CASCADE,
     FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS segments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, filtersJson TEXT, createdAt TEXT)`,
  // Email-reply intelligence (Feature 2): one row per ingested reply, matched to a contact by sender email.
  `CREATE TABLE IF NOT EXISTS replies (
     id INTEGER PRIMARY KEY AUTOINCREMENT, contactId INTEGER, fromEmail TEXT, fromName TEXT, subject TEXT,
     receivedAt TEXT, sentiment TEXT, interestSignal TEXT, questionsAsked INTEGER DEFAULT 0, summary TEXT,
     draftReply TEXT, messageId TEXT UNIQUE, model TEXT, createdAt TEXT NOT NULL,
     FOREIGN KEY (contactId) REFERENCES contacts(id) ON DELETE SET NULL)`,
  // Email-campaign stats (Feature 3): one row per send, upserted by (name, sentDate).
  `CREATE TABLE IF NOT EXISTS campaigns (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sentDate TEXT, segment TEXT,
     recipients INTEGER DEFAULT 0, delivered INTEGER DEFAULT 0, opened INTEGER DEFAULT 0, clicked INTEGER DEFAULT 0,
     replied INTEGER DEFAULT 0, bounced INTEGER DEFAULT 0, unsubscribed INTEGER DEFAULT 0,
     createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, UNIQUE(name, sentDate))`,
  `CREATE INDEX IF NOT EXISTS idx_activities_contactId ON activities(contactId)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_contactId ON tasks(contactId)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done)`,
  `CREATE INDEX IF NOT EXISTS idx_contact_tags_contactId ON contact_tags(contactId)`,
  `CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(stage)`,
  `CREATE INDEX IF NOT EXISTS idx_replies_contactId ON replies(contactId)`,
  `CREATE INDEX IF NOT EXISTS idx_replies_receivedAt ON replies(receivedAt)`,
];

/* new columns added to tables that may already exist from an earlier deploy */
const COLUMN_MIGRATIONS = [
  ['contacts', 'updatedBy', 'TEXT'],
  ['activities', 'createdBy', 'TEXT'],
  // Feature 1 — AI relationship enrichment, stored on the contact.
  ['contacts', 'aiScore', 'INTEGER'],
  ['contacts', 'aiBand', 'TEXT'],
  ['contacts', 'aiSummary', 'TEXT'],
  ['contacts', 'aiNextStep', 'TEXT'],
  ['contacts', 'aiAnalyzedAt', 'TEXT'],
  ['contacts', 'aiModel', 'TEXT'],
  // Phase-1 Dhamma working-copy columns.
  ['contacts', 'altPhone', 'TEXT'],
  ['contacts', 'tier', 'TEXT'],
  ['contacts', 'priority', 'TEXT'],
  ['contacts', 'signal', 'TEXT'],
  ['contacts', 'roughNotes', 'TEXT'],
  // Phase-3: where a logged note came from (e.g. "Prompt box", "AI draft").
  ['activities', 'source', 'TEXT'],
  // Phase-6: when a task was marked done, so completed follow-ups land on the timeline.
  ['tasks', 'completedAt', 'TEXT'],
  // Phase-7: the suggested message intent for a follow-up reminder (drives the AI draft).
  ['tasks', 'intent', 'TEXT'],
];

/* Old pipeline vocabulary → Dhamma's real stages. Applied once to a legacy demo
   database so existing seed rows adopt the new funnel; never touches real data,
   which already uses the new stage names. */
const LEGACY_STAGE_MAP = {
  'Not Contacted': 'Cold',
  'Contacted': 'Network',
  'In Conversation': 'Qualified',
  'Interested': 'In Diligence',
  'Meeting Scheduled': 'Committed',
  'Onboarded': 'Funded',
};
const NEW_STAGES = ['Cold', 'Network', 'Qualified', 'In Diligence', 'Committed', 'Funded', 'Hot'];

/* Dhamma's real pipeline vocabulary, in full (the funnel plus the two side statuses).
   The single source of truth the AI layer validates stages against. */
export const STAGES = ['Cold', 'Network', 'Qualified', 'In Diligence', 'Committed', 'Funded', 'Hot', 'Dormant'];

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

async function addColumnIfMissing(env, table, col, decl) {
  const info = await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all();
  if (!(info.results || []).some((c) => c.name === col)) {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`).run();
  }
}

async function seedContactsIfEmpty(env) {
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM contacts').first();
  if (n > 0) return;
  const ts = '2026-09-01T00:00:00.000Z';
  const cols = WRITABLE;
  const stmt = (row) => env.DB.prepare(
    `INSERT OR IGNORE INTO contacts (${cols.join(',')}, createdAt, updatedAt) VALUES (${cols.map(() => '?').join(',')}, ?, ?)`,
  ).bind(...cols.map((c) => row[c] ?? null), ts, ts);
  for (const group of chunk(SEED_CONTACTS, 50)) await env.DB.batch(group.map(stmt));
}

async function seedTagsIfEmpty(env) {
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags').first();
  if (n > 0) return;
  const tags = [
    ['VIP', TAG_PALETTE[4]], ['Warm intro', TAG_PALETTE[2]], ['Conference 2026', TAG_PALETTE[0]], ['Needs deck', TAG_PALETTE[3]],
  ];
  await env.DB.batch(tags.map(([name, colour]) =>
    env.DB.prepare('INSERT OR IGNORE INTO tags (name, colour) VALUES (?, ?)').bind(name, colour)));
}

async function seedTasksIfEmpty(env) {
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM tasks').first();
  if (n > 0) return;
  // Attach a few starter tasks to active-stage contacts so Follow-ups is alive.
  const rows = await env.DB.prepare(
    "SELECT id, relationshipOwner FROM contacts WHERE stage IN ('Qualified','In Diligence','Committed') ORDER BY id LIMIT 4",
  ).all();
  const list = rows.results || [];
  if (!list.length) return;
  const day = (offset) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
  const titles = ['Send the latest factsheet', 'Book the intro call', 'Share the audited track record', 'Follow up on fees'];
  const offsets = [-2, 1, 4, 9];
  const ts = now();
  await env.DB.batch(list.map((c, i) =>
    env.DB.prepare('INSERT INTO tasks (contactId, title, dueDate, done, owner, createdBy, createdAt) VALUES (?, ?, ?, 0, ?, ?, ?)')
      .bind(c.id, titles[i % titles.length], day(offsets[i % offsets.length]), c.relationshipOwner || 'Team', 'Team', ts)));
}

async function seedSegmentsIfEmpty(env) {
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM segments').first();
  if (n > 0) return;
  const seg = [
    ['FPIs in the pipeline', JSON.stringify({ entityType: ['FPI'], stage: ['Qualified'] })],
    ['Family Offices', JSON.stringify({ entityType: ['Family Office'] })],
  ];
  await env.DB.batch(seg.map(([name, filtersJson]) =>
    env.DB.prepare('INSERT INTO segments (name, filtersJson, createdAt) VALUES (?, ?, ?)').bind(name, filtersJson, now())));
}

/**
 * One-time remap of a legacy demo database from the old pipeline vocabulary to
 * Dhamma's real stages. Runs ONLY when the data still uses the old names AND has
 * no new-stage rows yet, so it can never clobber real imported data.
 */
async function migrateLegacyStages(env) {
  const oldNames = Object.keys(LEGACY_STAGE_MAP);
  const legacy = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM contacts WHERE stage IN (${oldNames.map(() => '?').join(',')})`,
  ).bind(...oldNames).first();
  if (!legacy || !legacy.n) return;   // nothing legacy to migrate
  const modern = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM contacts WHERE stage IN (${NEW_STAGES.map(() => '?').join(',')})`,
  ).bind(...NEW_STAGES).first();
  if (modern && modern.n) return;     // already has real/new-stage data — leave it alone
  await env.DB.batch(Object.entries(LEGACY_STAGE_MAP).map(([oldS, newS]) =>
    env.DB.prepare('UPDATE contacts SET stage = ? WHERE stage = ?').bind(newS, oldS)));
}

/** Create/migrate/seed everything. Cheap and idempotent; cached per isolate. */
export async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(CREATE_STATEMENTS.map((s) => env.DB.prepare(s)));
  for (const [table, col, decl] of COLUMN_MIGRATIONS) await addColumnIfMissing(env, table, col, decl);
  await seedContactsIfEmpty(env);
  await seedTagsIfEmpty(env);
  await seedTasksIfEmpty(env);
  await seedSegmentsIfEmpty(env);
  await migrateLegacyStages(env);
  schemaReady = true;
}

/** Fetch tags for a set of contact ids → Map(contactId -> [{id,name,colour}]). */
export async function tagsByContact(env, ids) {
  const map = new Map();
  if (!ids.length) return map;
  for (const group of chunk(ids, 100)) {
    const res = await env.DB.prepare(
      `SELECT ct.contactId AS cid, t.id, t.name, t.colour FROM contact_tags ct
       JOIN tags t ON t.id = ct.tagId WHERE ct.contactId IN (${group.map(() => '?').join(',')})`,
    ).bind(...group).all();
    for (const r of res.results || []) {
      if (!map.has(r.cid)) map.set(r.cid, []);
      map.get(r.cid).push({ id: r.id, name: r.name, colour: r.colour });
    }
  }
  return map;
}

/** Latest reply per contact → Map(contactId -> reply row). Newest wins. */
export async function latestRepliesByContact(env) {
  const map = new Map();
  const res = await env.DB.prepare(
    `SELECT * FROM replies WHERE contactId IS NOT NULL ORDER BY receivedAt ASC, id ASC`,
  ).all();
  for (const r of res.results || []) map.set(r.contactId, r); // last (newest) write wins
  return map;
}

/**
 * A compact, token-light snapshot of the whole book for the AI layer (Ask / Update).
 * Only real rows, only the identifying + filtering fields. Capped so a very large book
 * can't blow the model's context; the AI is told to reference contacts by #id, and the
 * UI always renders the real row from the store — nothing shown is ever invented.
 */
export async function loadCompactBook(env, limit = 2000) {
  const res = await env.DB.prepare(
    `SELECT id, fullName, organisation, email, phone, whatsapp, entityType, stage, country, city,
            tier, priority, relationshipOwner, lastContact, nextActionDate, signal
       FROM contacts ORDER BY updatedAt DESC LIMIT ?`,
  ).bind(Math.max(1, Math.min(limit, 20000))).all();
  return res.results || [];
}
