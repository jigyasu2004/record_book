# Earnings Record Book

A web application to track your challenge earnings by date. Record expected and actual amounts in USD, auto-convert to INR, and keep a digital passbook you can print or save as PDF.

![Earnings Record Book](https://img.shields.io/badge/version-1.0.0-blue)  
**Tech:** Node.js, Express, SQLite, vanilla HTML/CSS/JS

---

## Features

- **Date-based entries** — Add any date; list is ordered chronologically (oldest first).
- **Multiple sources per date** — Add/remove as many earning sources as you need per day.
- **Expected vs actual (USD)** — Enter expected and actual earnings per source.
- **Actual INR (locked)** — INR is calculated when you enter actual USD and **stored**. Changing the USD rate later does **not** change past INR values.
- **Editable USD rate** — Set the current ₹/USD rate in the header; new entries use it; previous INR stays fixed.
- **Source link** — Optional URL per source (e.g. challenge page); open via ↗ button.
- **Visual completion** — Green highlight on sources with actual earnings; whole date card turns green when all sources have actuals.
- **Per-date totals** — Sum of expected, actual USD, and actual INR for each date.
- **Grand total** — Totals across all dates at the bottom.
- **Summary strip** — Total expected, total actual (USD & INR), and “dates completed” count.
- **Print / Digital passbook** — Print or save as PDF a statement with all dates, sources, and totals.
- **Dark theme (default)** — Toggle between dark and light; preference saved in the browser.
- **Responsive** — Usable on phone and desktop; sticky Metric and Total columns when scrolling sources horizontally.

---

## Project structure

```
record_book/
├── server.js          # Express API + SQLite
├── earnings.db        # SQLite DB (created on first run)
├── package.json
├── README.md
└── public/
    ├── index.html     # App shell, modals, print preview
    ├── styles.css     # Layout, themes, responsive, print
    └── app.js         # UI logic, API calls, passbook generation
```

---

## Requirements

- **Node.js** 18+ (or 16+ with a compatible `better-sqlite3` build)
- **npm** (or yarn/pnpm)

---

## Installation

1. Clone the repo:
   ```bash
   git clone https://github.com/jigyasu2004/record_book.git
   cd record_book
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

   The app is served at **http://localhost:3002**.

   For development with auto-restart:
   ```bash
   npm run dev
   ```

---

## Usage

### Adding a date

- Click **+ Add Date**, pick a date, then **Add Date**.  
- The new date is inserted in chronological order (e.g. March 15 appears after March 14).

### Managing sources

- For a date, click **+ Add Source** (or **+ Add First Source** if the date has none).
- Rename a source by editing the name in the column header.
- Add an optional **link** in the “Paste source link…” field; use ↗ to open it.
- Remove a source with the **×** button in its header.

### Entering amounts

- **Expected USD** — What you expect to earn from that source.
- **Actual USD** — What you actually received.  
  When you enter this, INR is calculated using the **current** USD rate and **saved**. That INR value does not change if you later change the rate.
- **Actual INR** — Read-only; shows the stored value (or — if no actual USD yet).

### USD rate

- In the header, set **USD Rate** (e.g. 92.54) and click **Update** (or press Enter).  
- Only **new** actual-USD entries use this rate; existing INR values stay as stored.

### Print / PDF

- Click **Print** to open the passbook preview.
- Use **Print / Save as PDF** to open the browser print dialog; choose “Save as PDF” or a printer.

### Theme

- Use the **☀️ Light** / **🌙 Dark** button in the header. The choice is remembered in `localStorage`.

---

## API (backend)

All JSON; base path `/api`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/data` | Full state: `settings`, `records` (each with `challenges`). Records ordered by `date` ASC. |
| POST | `/api/records` | Body: `{ "date": "YYYY-MM-DD" }`. Creates a date. Returns the new record. |
| DELETE | `/api/records/:id` | Deletes a date and all its sources. |
| POST | `/api/records/:id/challenges` | Body: `{ "name": "…", "link": "…" }` (optional). Adds a source. |
| PATCH | `/api/challenges/:id` | Body: `{ "name", "expected_usd", "actual_usd", "actual_inr", "link" }` (any subset). Updates a source. |
| DELETE | `/api/challenges/:id` | Deletes a source. |
| PUT | `/api/settings/:key` | Body: `{ "value": "…" }`. Sets a setting (e.g. `usd_rate`). |

---

## Data (SQLite)

- **settings** — Key/value (e.g. `usd_rate`).
- **date_records** — One row per date (`id`, `date`, `created_at`).
- **challenges** — One row per source: `date_record_id`, `name`, `expected_usd`, `actual_usd`, `actual_inr`, `link`, `sort_order`.

`earnings.db` is created in the project root on first run. Back it up to keep your data.

---

## Configuration

- **Port** — Edit `PORT` in `server.js` (default `3002`).
- **Seed dates** — The server pre-creates dates from 2026-03-07 to 2026-03-14 if they don’t exist. Change or remove the `seedDates` array in `server.js` if you want different (or no) seed data.

---

## Browser support

- Modern Chrome, Firefox, Safari, Edge.
- Uses `position: sticky`, `fetch`, and ES6+; no polyfills included.

---

## License

MIT (or your chosen license).

---

## Repository

**GitHub:** [https://github.com/jigyasu2004/record_book](https://github.com/jigyasu2004/record_book)
