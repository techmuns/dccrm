# Dhamma Capital — Investor Relations Dashboard

A calm, visual-first dashboard for Dhamma Capital's investor relationships. It
replaces a cluttered sales-style CRM view with something anyone — even a
non-financial reader — understands at a glance.

**All five tabs are built, and Contacts is now a real CRM** backed by a shared
**Cloudflare D1** database (add / edit / delete / import / export + an activity
timeline). Phase 1 laid the reusable foundation and the **Overview** tab; Phase 2
added **Contacts** and **Follow-ups** (sharing one FilterBar, DataTable and
DetailDrawer); Phase 3 added **Campaigns** and **AI Insights**; the CRM upgrade put
Contacts on a live API. Campaigns and AI Insights still run on their own sample
data (real email stats and AI-read replies connect later) — each shows a small
"Sample data — connects to a live source later" note.

If the database isn't reachable (e.g. a preview build with no binding), the app
falls back to the read-only sample and shows a "Preview mode" banner, so it always
renders.

## Database & one-time setup (Cloudflare D1)

Contacts live in a Cloudflare D1 database, reached through Pages Functions under
`/functions/api`. The API needs a D1 binding named **`DB`**. One-time steps:

```bash
# 1. Create the database (copy the database_id it prints)
wrangler d1 create dccrm

# 2. Create the tables and seed the ~120 sample contacts (idempotent)
wrangler d1 execute dccrm --remote --file=./schema.sql

# 3. Bind it to your Pages project as DB — either:
#    • Dashboard: Pages → your project → Settings → Functions → D1 bindings →
#      add binding  Variable name: DB  →  Database: dccrm      (recommended), or
#    • wrangler.toml: uncomment the [[d1_databases]] block and paste the id.
```

Redeploy (or push) and Contacts is live. To restrict the whole app to your team,
turn on **Cloudflare Access** (Zero Trust → Access → Applications → add your Pages
domain with an email/one-time-PIN policy) — it sits in front of the site and the API.

**API** (all under `/api`): `GET/POST /api/contacts`, `GET/PUT/DELETE
/api/contacts/:id`, `POST /api/contacts/:id/activities`, `POST /api/import`
(upsert by email), `GET /api/export` (CSV). Excel/CSV is import/export only — the
database is the source of truth.

## Running it

It is a **static site** — no build step, no server, no backend.

- **Deployment:** Cloudflare Pages, served from the repository root with zero
  configuration. `index.html` is at the root; `/js` and `/data` sit beside it.
- **Locally:** serve the folder over http (browsers block ES-module and `fetch`
  access on `file://`). Any static server works, e.g. `npx serve` or
  `python3 -m http.server`, then open the printed address.

## Upload your own sheet

Click **Upload Sheet** (or drag a file anywhere onto the page) and choose an
`.xlsx`, `.xls` or `.csv`. The file is parsed **in the browser** — nothing is sent
anywhere. Column headers are matched case- and spacing-insensitively (e.g.
`Source / Channel`, `source_channel` and `SOURCE CHANNEL` all match), a header row
below a title/blank row is found automatically, and Excel date cells and `d/m/y`
text dates are both understood.

Your upload is remembered in this browser (`localStorage`) so it survives a
refresh. The chip near the title shows whether you are on sample or uploaded data,
with **Reset to sample** to go back. With no upload, the dashboard runs on
`data/contacts.sample.json` (~120 realistic example contacts).

## The tabs

**Overview** — an at-a-glance summary: four honest numbers (Total contacts · In
active conversation · Onboarded investors · Follow-ups due this week), a pipeline
funnel, and investors by type / top countries / by source.

**Contacts** — the contact universe with live filtering. Multi-select filters for
Type, Stage, Country, Vehicle, Source and Owner, plus a WhatsApp opt-in toggle,
all combining live. The centrepiece is a stage-split bar that instantly shows how
any filtered group divides across the pipeline (e.g. filter Type = FPI and see how
many are in conversation, contacted-but-silent, or never contacted), beside a
reactive donut and top-countries bar. A fast table (virtualised for 10k+ rows)
lists everyone; click a row for the full profile; Export CSV saves the current
filtered set.

**Follow-ups** — what to do next. Clickable urgency buckets (Overdue · Due today ·
Due this week · Later · No date set) filter the list; a "Needs a nudge" toggle
surfaces active-stage contacts gone quiet for 30+ days. Filter by Owner, Type and
Stage; a chart shows follow-ups due over the next six weeks.

**Campaigns** — how each email send performed. A list of campaigns with an inline
funnel per row; selecting one shows its funnel (Sent → Delivered → Opened →
Clicked → Replied), a "who replied" split with a jump straight to the non-repliers
in Contacts, and an open-rate/reply-rate trend over time. Plain language, no
marketing jargon.

**AI Insights** — relationship intelligence. Once replies are read by AI, each
active contact is scored. A priority queue ("respond within 2–3 days") flags people
who replied and asked questions, with the reply snippet and an AI-drafted reply you
can copy; a sentiment donut and interest-score buckets give the overview; a
"ready-to-review replies" list and an "interested but quiet" segment round it out.
All scoring thresholds and the enrichment mapping live in one swappable module.

The header search box filters every tab live; a category keeps the same colour
everywhere, and colours never repaint when you filter. Both new tabs share one
FilterBar, one virtualised DataTable and one right-side DetailDrawer.

## How the code is laid out

Modular by design, so later phases add a tab file and one line in `app.js`.

```
index.html            App shell + the whole design system (one card, one type scale, palette)
schema.sql            D1 tables (contacts, activities) + idempotent seed of the sample
wrangler.toml         Pages/Functions config (bind D1 as DB here or in the dashboard)
functions/api/        The CRM API (Cloudflare Pages Functions)
  _lib.js               Shared helpers (validation, JSON responses, CSV)
  contacts/index.js     GET list · POST create
  contacts/[id].js      GET one+timeline · PUT edit · DELETE
  contacts/[id]/activities.js   GET · POST log an activity
  import.js             POST bulk upsert by email
  export.js             GET all contacts as CSV
data/
  contacts.sample.json    ~120 example contacts (the fallback dataset)
  campaigns.sample.json   ~10 example email campaigns
  ai-insights.sample.json AI reply-scores keyed by email (active-conversation contacts)
js/
  config.js           Palette, pipeline order, header→field mapping, tab list
  util.js             Dates, numbers, counting — pure helpers, no DOM
  colors.js           One stable colour per category, assigned once from the full data
  data.js             Normalise rows + shared calculations (source-agnostic)
  filters.js          Pure filter / urgency-bucket / nudge / CSV helpers
  store.js            Contacts state + the live D1 API calls (create/edit/delete/import) with sample fallback
  source.js           Generic sample-vs-upload data source (used by Campaigns + AI Insights)
  campaigns.js        Campaigns data layer (funnel + rate maths) — swap the loader for a live feed
  ai-insights.js      ALL AI scoring thresholds + enrichment mapping (swappable module)
  nav.js              Cross-tab jumps (e.g. Campaigns → Contacts, pre-filtered)
  upload.js           Parse a spreadsheet in-browser (SheetJS)
  charts.js           Every ECharts chart: funnel, donut, bars, segmented split, line
  ui.js               Shared building blocks: card, stat tile, legend, states, toast
  router.js           The tab system
  app.js              Boot + header controls (search, upload, data status)
  components/         Reusable pieces shared across tabs
    filterbar.js        Multi-select filter dropdowns + toggles + active chips
    datatable.js        Sortable, virtualised table (handles 10k+ rows)
    drawer.js           The right-side detail drawer (one shared instance)
    chartcard.js        A card wrapping one chart + its synced legend
    cells.js            Shared table-cell renderers (name, chip, date)
    source-note.js      The "sample data — connects later" bar with Replace / Reset
  tabs/
    overview.js         The Overview tab
    contacts.js         The Contacts tab
    followups.js        The Follow-ups tab
    campaigns.js        The Campaigns tab
    insights.js         The AI Insights tab
    coming-soon.js      Placeholder for any future not-yet-built tab
```

Everything loads from CDNs: Tailwind (layout), Google Fonts (Plus Jakarta Sans +
Inter), Lucide (icons), ECharts (charts), SheetJS (upload parsing).
