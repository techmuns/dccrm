# Dhamma Capital — Investor Relations Dashboard

A calm, visual-first dashboard for Dhamma Capital's investor relationships. It
replaces a cluttered sales-style CRM view with something anyone — even a
non-financial reader — understands at a glance.

This is **Phase 1 of ~8**: a reusable foundation plus the first tab (**Overview**).
Later tabs — Contacts, Follow-ups, Campaigns, AI Insights — are stubbed in the tab
bar and slot in without rewrites.

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

## The Overview tab

- **Four honest numbers:** Total contacts · In active conversation · Onboarded
  investors · Follow-ups due this week (next action within 7 days).
- **Pipeline funnel:** everyone by stage, in pipeline order.
- **Investors by type**, **Top countries** and **By source / channel**.

The header search box filters the whole tab live; a category keeps the same colour
everywhere, and colours never repaint when you filter.

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
  data.js             Normalise rows + the Overview calculations (source-agnostic)
  store.js            Holds "what data are we looking at"; load, upload, persist, search
  upload.js           Parse a spreadsheet in-browser (SheetJS)
  charts.js           Every ECharts chart: funnel, donut, horizontal bar, bar
  ui.js               Shared building blocks: card, stat tile, legend, states, toast
  router.js           The tab system
  app.js              Boot + header controls (search, upload, data status)
  tabs/
    overview.js       The Overview tab
    coming-soon.js    Placeholder the not-yet-built tabs render
```

Everything loads from CDNs: Tailwind (layout), Google Fonts (Plus Jakarta Sans +
Inter), Lucide (icons), ECharts (charts), SheetJS (upload parsing).
