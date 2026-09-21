# Dhamma Capital — Investor Relations Dashboard

A calm, visual-first dashboard for Dhamma Capital's investor relationships. It
replaces a cluttered sales-style CRM view with something anyone — even a
non-financial reader — understands at a glance.

**All five tabs are built, and Contacts is a full CRM** backed by a shared
**Cloudflare D1** database: add / edit / delete, an activity timeline, **tasks &
reminders**, **tags & saved segments**, **bulk actions** on any selection, and
import / export. Every change is stamped with **who did it** (see team identity
below). Phase 1 laid the reusable foundation and the **Overview** tab; Phase 2
added **Contacts** and **Follow-ups** (sharing one FilterBar, DataTable and
DetailDrawer); Phase 3 added **Campaigns** and **AI Insights**; the CRM upgrade put
Contacts on a live API; and the **AI layer** (below) makes the rest real — **Amazon
Bedrock** scores every relationship and reads client email replies, and **Campaigns**
now import from your email tool into D1. Each live feature falls back to its bundled
sample when its source isn't connected yet, so the dashboard always renders.

If the database isn't reachable (e.g. a preview build with no binding), the app
falls back to the read-only sample and shows a "Preview mode" banner, so it always
renders.

## Database & one-time setup (Cloudflare D1)

Contacts live in a Cloudflare D1 database, reached through Pages Functions under
`/functions/api`. The API needs a D1 binding named **`DB`**. **The schema is
self-initializing** — on the first request the API creates every table it needs
(contacts, activities, tasks, tags, contact_tags, segments) and seeds the ~120
sample contacts plus a few starter tags, tasks and segments. There is **no manual
SQL step, ever**. One-time steps:

```bash
# 1. Create the database (copy the database_id it prints)
wrangler d1 create dccrm

# 2. Bind it to your Pages project as DB — either:
#    • Dashboard: Pages → your project → Settings → Functions → D1 bindings →
#      add binding  Variable name: DB  →  Database: dccrm      (recommended), or
#    • wrangler.toml: uncomment the [[d1_databases]] block and paste the id.
```

Redeploy (or push) and Contacts is live — the tables build themselves on the first
hit. (`schema.sql` is still included if you'd rather create the tables up front with
`wrangler d1 execute dccrm --remote --file=./schema.sql`, but it isn't required.)

**Who did what (team identity).** Put **Cloudflare Access** in front of the site and
the API reads the signed-in email from its `Cf-Access-Authenticated-User-Email`
header, stamps every create / edit / activity with that person, and shows
"Signed in as \<you\>" in the header. Without Access everything still works and is
attributed to "Team". To lock the whole app **and** API to your group, turn Access
on (Zero Trust → Access → Applications → add your Pages domain with an
email/one-time-PIN policy) — it sits in front of both the site and the API.

**API** (all under `/api`): `GET/POST /api/contacts`, `GET/PUT/DELETE
/api/contacts/:id`, `GET/POST /api/contacts/:id/activities`, `POST/DELETE
/api/contacts/:id/tags`; `GET/POST /api/tasks` (`?open=1` for the open list),
`PUT/DELETE /api/tasks/:id`; `GET/POST /api/tags`, `DELETE /api/tags/:id`;
`GET/POST /api/segments`, `DELETE /api/segments/:id`; `POST /api/bulk` (change
stage / assign owner / add tag / delete across a selection); `GET /api/me` (the
signed-in user); `POST /api/import` (upsert by email), `GET /api/export` (CSV).
Excel/CSV is import/export only — the database is the source of truth. The AI layer
adds `POST /api/contacts/:id/enrich`, `POST /api/ai/refresh-all`,
`GET /api/ai/pending` + `POST /api/ai/result` (GHA_SECRET), `GET /api/insights`,
`POST /api/replies/ingest` (INGEST_SECRET) + `GET /api/replies`, and
`GET /api/campaigns` + `POST /api/campaigns/import` + `DELETE /api/campaigns/:id`.

## AI layer — Amazon Bedrock (scoring · reply reading · campaigns)

Three capabilities sit on top of the CRM. They call **Amazon Bedrock** with a
**Bedrock API key used as a Bearer token** (not AWS SigV4) against the Converse API,
trying a **model fallback chain** in order until one answers — the proven pattern
from `techmuns/paramemo`. Each runs two ways: a **direct** Pages Function for single
on-demand actions, and a **patient GitHub Actions** runner for bulk work (Actions has
no Worker timeout, so it rides out a busy model across long retry waves).

1. **AI enrichment of contacts.** From a contact's own data (notes, stage, type, last
   contact, next action, activity) Bedrock returns an interest score (0–100), a band
   (Hot / Warm / Cold), a one-line relationship summary and a suggested next step,
   stored on the contact. The **AI Insights** tab ranks by score; the drawer shows it
   with a **Refresh AI** button (direct call); **Refresh all AI** fires the bulk
   Action; a **nightly** Action re-scores changed contacts.
2. **Email-reply intelligence.** A scheduled Action (~every 15 min) reads NEW replies
   from a dedicated inbox over IMAP, asks Bedrock for sentiment, an interest signal,
   the number of questions asked, a summary and a **draft reply**, matches each to a
   contact by sender email, and POSTs them to `/api/replies/ingest`. The drawer shows
   each reply with its draft; the "Respond within 2–3 days" queue runs on this real
   data. **Until the inbox is connected it runs in a clearly-labelled TEST mode** off
   `data/replies.sample.json`, fully demonstrable now (and if no Bedrock key is set, a
   labelled heuristic stands in). Set the IMAP secrets to go live — nothing else changes.
3. **Campaign import.** On **Campaigns**, **Import campaigns…** takes a CSV/Excel export
   from Zoho Campaigns (name, sentDate, segment, recipients, delivered, opened, clicked,
   replied, bounced, unsubscribed), parses it in the browser, and upserts into a D1
   `campaigns` table (by name + date). The tab then runs on D1, falling back to the
   sample only when the table is empty; "See the non-repliers" still jumps to Contacts.

### Configure it — exact variable names

Set these once. **Secrets** go in `wrangler secret put` / the dashboard's encrypted
fields / GitHub **Secrets**; **plain vars** go in `wrangler.toml [vars]` / the
dashboard **Variables** / GitHub **Variables**. **Never commit a secret.** With
nothing set, the app is unchanged and every AI control degrades gracefully with a
plain-English note.

**Cloudflare Pages** (Settings → Environment variables, and Functions bindings):

| Name | Kind | Purpose |
|------|------|---------|
| `BEDROCK_API_KEY` | secret | Amazon Bedrock API key (Bearer). Switches AI on. |
| `AWS_REGION` | var | Bedrock region, e.g. `us-east-1`. |
| `BEDROCK_MODEL_IDS` | var | Comma-separated fallback chain (default `anthropic.claude-sonnet-5,us.anthropic.claude-sonnet-5,us.anthropic.claude-sonnet-4-5-20250929-v1:0`). Single-id override: `BEDROCK_MODEL_ID`. |
| `GHA_SECRET` | secret | Shared secret guarding `/api/ai/pending` + `/api/ai/result`. |
| `INGEST_SECRET` | secret | Shared secret guarding `/api/replies/ingest`. |
| `GITHUB_DISPATCH_TOKEN` | secret | GitHub token (repo scope) so **Refresh all AI** can fire the Action. |
| `GH_OWNER` / `GH_REPO` | var | Repo that holds the workflows, e.g. `techmuns` / `dccrm`. |

**GitHub → Settings → Secrets and variables → Actions:**

| Name | Kind | Purpose |
|------|------|---------|
| `WORKER_URL` | secret | Deployed base URL, e.g. `https://dccrm.pages.dev`. |
| `GHA_SECRET`, `INGEST_SECRET`, `BEDROCK_API_KEY` | secret | Same values as on Pages. |
| `IMAP_HOST` / `IMAP_USER` / `IMAP_PASSWORD` | secret | The replies inbox — **leave unset to keep Feature 2 in TEST mode.** |
| `AWS_REGION`, `BEDROCK_MODEL_IDS` | variable | Same as on Pages. |
| `IMAP_PORT` / `IMAP_MAILBOX` | variable | Optional (default `993` / `INBOX`). |

Workflows: `.github/workflows/ai-enrich.yml` (repository_dispatch from the app, nightly
02:00 UTC for changed contacts, or manual) and `.github/workflows/email-ingest.yml`
(every 15 minutes, or manual). The app itself has **no build step and no npm
dependencies** — the IMAP client is installed only inside the email workflow.

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
Type, Stage, Country, Vehicle, Source, Owner and **Tag**, plus a WhatsApp opt-in
toggle, all combining live. Save any filter combination as a **segment** and it
comes back as a one-click chip. The centrepiece is a stage-split bar that instantly
shows how any filtered group divides across the pipeline (e.g. filter Type = FPI
and see how many are in conversation, contacted-but-silent, or never contacted),
beside a reactive donut and top-countries bar. A fast table (virtualised for 10k+
rows) lists everyone; click a row for the full profile (edit inline, add tags, add
tasks, log activity); tick rows to run a **bulk action** — change stage, assign an
owner, add a tag, export or delete the selection; Export CSV saves the current
filtered set.

**Follow-ups** — what to do next. Clickable urgency buckets (Overdue · Due today ·
Due this week · Later · No date set) filter the list; a "Needs a nudge" toggle
surfaces active-stage contacts gone quiet for 30+ days. Filter by Owner, Type and
Stage; a chart shows follow-ups due over the next six weeks, and an **Open tasks**
card lists every reminder across the team (tick one to mark it done).

**Campaigns** — how each email send performed. Runs on the D1 `campaigns` table
(**Import campaigns…** upserts a Zoho Campaigns export; it falls back to the sample
when empty). A list with an inline funnel per row; selecting one shows its funnel
(Sent → Delivered → Opened → Clicked → Replied), a "who replied" split with a jump
straight to the non-repliers in Contacts, and an open-rate/reply-rate trend over time.

**AI Insights** — relationship intelligence, scored for real by **Amazon Bedrock**
(see the AI layer above). A priority queue ("respond within 2–3 days") flags people
who replied and asked questions, with the reply snippet, the AI relationship summary,
a suggested next step, and an AI-drafted reply you can copy; a sentiment donut and
interest-score buckets give the overview; a "ready-to-review replies" list and an
"interested but quiet" segment round it out. **Refresh all AI** re-scores everyone and
a "last analysed" time shows when. All scoring thresholds and the enrichment mapping
live in one swappable module, so the same pipeline serves the sample and the live feed.

The header search box filters every tab live; a category keeps the same colour
everywhere, and colours never repaint when you filter. Both new tabs share one
FilterBar, one virtualised DataTable and one right-side DetailDrawer.

## How the code is laid out

Modular by design, so later phases add a tab file and one line in `app.js`.

```
index.html            App shell + the whole design system (one card, one type scale, palette)
schema.sql            Optional up-front D1 schema (the API self-initializes, so this is only a reference)
wrangler.toml         Pages/Functions config (bind D1 as DB here or in the dashboard)
functions/api/        The CRM API (Cloudflare Pages Functions)
  _lib.js               Shared helpers + self-initializing schema (builds every table & seeds on first hit), team identity, CSV
  _seed.js              The ~120 sample contacts used to seed an empty database
  contacts/index.js     GET list (with tags) · POST create
  contacts/[id].js      GET one + timeline + tasks + tags · PUT edit · DELETE
  contacts/[id]/activities.js   GET · POST log an activity (stamped with who)
  contacts/[id]/tags.js         POST add a tag (creates it inline if new) · DELETE remove
  tasks/index.js        GET tasks (?open=1) · POST create      ·   tasks/[id].js     PUT · DELETE
  tags/index.js         GET tags + usage counts · POST create  ·   tags/[id].js      DELETE
  segments/index.js     GET saved segments · POST save         ·   segments/[id].js  DELETE
  bulk.js               POST one action (stage / owner / tag / delete) across many contacts
  me.js                 GET the signed-in user (from the Cloudflare Access header)
  import.js             POST bulk upsert by email      ·   export.js  GET all contacts as CSV
  _bedrock.js           Bedrock Converse (Bearer key) — direct call, model chain, repository_dispatch
  _ai.mjs               Shared AI prompts + JSON parse + test heuristic (imported by Functions AND scripts)
  contacts/[id]/enrich.js       POST — score one contact on demand (direct Bedrock)
  ai/refresh-all.js     POST — fire the bulk enrichment Action   ·   ai/pending.js · ai/result.js  (GHA_SECRET handshake)
  insights.js           GET — the AI Insights feed (enrichment + latest replies) keyed by email
  replies/ingest.js     POST analysed replies (INGEST_SECRET)    ·   replies/index.js  GET recent replies
  campaigns/index.js    GET campaigns · campaigns/import.js POST upsert · campaigns/[id].js DELETE
scripts/                GitHub Actions runners (patient Bedrock; no Worker timeout)
  _bedrock.mjs          Patient Bedrock Converse (long retry waves) — mirrors paramemo
  ai-enrich.mjs         Bulk contact scoring   ·   email-ingest.mjs  IMAP → Bedrock → /api/replies/ingest
.github/workflows/      ai-enrich.yml (dispatch + nightly) · email-ingest.yml (every 15 min)
data/
  contacts.sample.json    ~120 example contacts (the fallback dataset)
  campaigns.sample.json   ~10 example email campaigns
  ai-insights.sample.json AI reply-scores keyed by email (fallback for preview mode)
  replies.sample.json     example client replies driving Feature 2's TEST mode
js/
  config.js           Palette, pipeline order, header→field mapping, tab list
  util.js             Dates, numbers, counting — pure helpers, no DOM
  colors.js           One stable colour per category, assigned once from the full data
  data.js             Normalise rows + shared calculations (source-agnostic)
  filters.js          Pure filter / urgency-bucket / nudge / CSV helpers
  store.js            Contacts state + all live D1 API calls (contacts, tasks, tags, segments, bulk, AI, replies, campaigns) with sample fallback
  source.js           Generic data source: the live API when the DB is connected, else sample/upload (Campaigns + AI Insights)
  campaigns.js        Campaigns data layer (funnel + rate maths) — loads from D1; an import upserts to D1
  ai-insights.js      ALL AI scoring thresholds + enrichment mapping (swappable) — live feed from /api/insights
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
    source-note.js      The data-source bar (Sample / Your data / Live) with Import / Replace / Reset
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
