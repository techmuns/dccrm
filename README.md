# Dhamma Capital — Investor Relations Dashboard

A calm, visual-first dashboard for Dhamma Capital's investor relationships. It
replaces a cluttered sales-style CRM view with something anyone — even a
non-financial reader — understands at a glance.

**Phases 1–2 are built.** Phase 1 laid the reusable foundation and the **Overview**
tab; Phase 2 adds **Contacts** and **Follow-ups**, all sharing one FilterBar, one
DataTable and one DetailDrawer. The remaining tabs — Campaigns and AI Insights —
are stubbed in the tab bar and slot in without rewrites.

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

The header search box filters every tab live; a category keeps the same colour
everywhere, and colours never repaint when you filter. Both new tabs share one
FilterBar, one virtualised DataTable and one right-side DetailDrawer.

## How the code is laid out

Modular by design, so later phases add a tab file and one line in `app.js`.

```
index.html            App shell + the whole design system (one card, one type scale, palette)
data/
  contacts.sample.json  ~120 example contacts (the fallback dataset)
js/
  config.js           Palette, pipeline order, header→field mapping, tab list
  util.js             Dates, numbers, counting — pure helpers, no DOM
  colors.js           One stable colour per category, assigned once from the full data
  data.js             Normalise rows + shared calculations (source-agnostic)
  filters.js          Pure filter / urgency-bucket / nudge / CSV helpers
  store.js            Holds "what data are we looking at"; load, upload, persist, search
  upload.js           Parse a spreadsheet in-browser (SheetJS)
  charts.js           Every ECharts chart: funnel, donut, bars, segmented split
  ui.js               Shared building blocks: card, stat tile, legend, states, toast
  router.js           The tab system
  app.js              Boot + header controls (search, upload, data status)
  components/         Reusable pieces shared across tabs
    filterbar.js        Multi-select filter dropdowns + toggles + active chips
    datatable.js        Sortable, virtualised table (handles 10k+ rows)
    drawer.js           The right-side detail drawer (one shared instance)
    chartcard.js        A card wrapping one chart + its synced legend
    cells.js            Shared table-cell renderers (name, chip, date)
  tabs/
    overview.js         The Overview tab
    contacts.js         The Contacts tab
    followups.js        The Follow-ups tab
    coming-soon.js      Placeholder the not-yet-built tabs render
```

Everything loads from CDNs: Tailwind (layout), Google Fonts (Plus Jakarta Sans +
Inter), Lucide (icons), ECharts (charts), SheetJS (upload parsing).
