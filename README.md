# Earnings Record Book

A multi-user web application to track challenge competition earnings by date. Record expected and actual amounts in USD, auto-convert to INR at a locked rate, filter by month or date range, and export a printable digital passbook (PDF).

![version](https://img.shields.io/badge/version-2.1.0-blue)
![stack](https://img.shields.io/badge/stack-Node.js%20%7C%20PostgreSQL%20%7C%20Vanilla%20JS-informational)

---

## Features

### Core tracking
- **Date-based entries** — Add any date in DD/MM/YYYY format; list is ordered chronologically (oldest first).
- **Multiple sources per date** — Add, rename, and remove earning sources per day.
- **Expected vs Actual (USD)** — Enter expected and received amounts per source.
- **Actual INR (locked)** — INR is calculated when you enter actual USD using the rate **at that moment** and stored. Changing the USD rate later does **not** affect past INR values.
- **Editable USD rate** — Set the current ₹/USD rate in the header; only new entries use it.
- **Source link** — Optional URL per source; open via ↗ button.

### Filter
- **All Time / Month / Date Range** — Filter which dates are visible via the filter bar.
- Summary strip and Grand Total update in real time to reflect the active filter.
- Passbook/print export also respects the current filter.

### Clear sources with undo
- **⊘ Clear All** button on each date asks for confirmation, then removes all sources.
- Sources are recoverable for **2 minutes** via the **↩ Undo** button (in the toast and in the date card).
- After 2 minutes the deletion is permanent.

### Auth & multi-user
- **Register / Login** — Each user gets a private, isolated account.
- Passwords hashed with bcrypt (10 rounds).
- **7-day session** via `httpOnly` cookie — no need to log in on every visit.
- Separate `/login.html` page; app auto-redirects if not authenticated.
- Any expired or deleted session automatically redirects to the login page.

### UI / UX
- **Visual completion** — Green highlight on sources with actuals; date card turns green when all sources are filled.
- **Per-date totals** and **Grand Total** across all (or filtered) dates.
- **Summary strip** — Total expected, total actual (USD & INR), dates completed count.
- **Digital Passbook** — Print or save as PDF a professional statement with date sections, source rows, day totals, and a grand total.
- **Dark theme (default)** — Toggle between dark and light; preference saved in `localStorage`.
- **Responsive** — Usable on phone and desktop; sticky Metric and Total columns during horizontal scroll.

---

## Project structure

```
record_book/
├── server.js           # Express API + PostgreSQL + auth + session logic
├── package.json
├── .env                # DATABASE_URL, PORT (not committed)
├── README.md
└── public/
    ├── login.html      # Standalone auth page (register / sign in)
    ├── index.html      # Main app shell, filter bar, modals, print preview
    ├── styles.css      # Layout, themes, filter, responsive, print styles
    └── app.js          # UI logic, filter, clear-undo, API calls, passbook
```

---

## Requirements

- **Node.js** 18+
- **npm**
- A **Neon** (or any PostgreSQL) database

---

## Setup

### 1. Clone

```bash
git clone https://github.com/jigyasu2004/record_book.git
cd record_book
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Create a `.env` file in the project root:

```env
PORT=3002
DATABASE_URL=postgresql://<user>:<password>@<host>/<db>?sslmode=require
```

> The app uses [Neon](https://neon.tech) serverless PostgreSQL. Create a free project at neon.tech and paste the connection string.

### 4. Start

```bash
npm start        # production
npm run dev      # development with auto-restart (nodemon)
```

Open **http://localhost:3002** — you'll land on the login page on first visit.

---

## Usage

### Authentication

- Visit `/login.html` (or `/` while not logged in — you'll be redirected automatically).
- **Register** with a unique username (≥ 3 chars) and password (≥ 6 chars).
- **Sign in** with your credentials. Session lasts 7 days.
- Click **Sign out** in the top-right to end the session.

### Adding a date

Click **+ Add Date**, type the date in **DD/MM/YYYY** format (today's date is pre-filled), then click **Add Date**. The new date appears in chronological order.

### Managing sources

- Click **+ Add Source** (or **+ Add First Source** on an empty date).
- Rename a source by clicking its column header name.
- Add an optional **link** in the "Paste source link…" field; click ↗ to open it.
- Remove a single source with the **×** button in its header.
- Remove all sources at once with **⊘ Clear All** — a confirmation is shown before deleting (undoable within 2 minutes).

### Entering amounts

| Field | Description |
|-------|-------------|
| Expected USD | What you expect to earn from this source |
| Actual USD | What you actually received — triggers INR calculation |
| Actual INR | Read-only; stored at the rate active when Actual USD was entered |

### USD rate

Set **USD Rate** in the header and click **Update** (or press Enter). Only new Actual USD entries use this rate; all stored INR values remain unchanged. Defaults to ₹92.54 on first use.

### Filtering

Use the filter bar (below the summary strip) to narrow the view:

| Mode | Description |
|------|-------------|
| All Time | Shows every date (default) |
| Month | Pick a month — shows only that month's dates |
| Date Range | Set a From and To date |

The summary strip, grand total, and passbook all reflect the active filter.

### Print / PDF

Click **Print** → the Digital Passbook preview opens (showing only filtered dates). Click **Print / Save as PDF** to open the browser print dialog and save.

---

## API reference

All endpoints are JSON. Data routes require a valid session cookie.

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | `{ username, password }` → creates account + session |
| POST | `/api/auth/login` | `{ username, password }` → creates session |
| POST | `/api/auth/logout` | Clears session |
| GET | `/api/auth/me` | Returns `{ user }` or `{ user: null }` |

### Data (session required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/data` | Full state: `settings` + `records` (each with `challenges`) |
| POST | `/api/records` | `{ date }` — creates a date record |
| DELETE | `/api/records/:id` | Deletes a date and all its sources |
| DELETE | `/api/records/:id/challenges` | Clears all sources for a date |
| POST | `/api/records/:id/challenges/restore` | `{ challenges[] }` — re-inserts sources (used by undo) |
| POST | `/api/records/:id/challenges` | `{ name?, link? }` — adds a source |
| PATCH | `/api/challenges/:id` | `{ name?, expected_usd?, actual_usd?, actual_inr?, link? }` |
| DELETE | `/api/challenges/:id` | Deletes a source |
| PUT | `/api/settings/:key` | `{ value }` — updates a setting (e.g. `usd_rate`) |

---

## Database schema (PostgreSQL)

```sql
users          (id, username UNIQUE, password_hash, created_at)
sessions       (id TEXT PK, user_id → users, expires_at)
user_settings  (user_id, key, value)  PRIMARY KEY (user_id, key)
date_records   (id, user_id → users, date TEXT, created_at)  UNIQUE (user_id, date)
challenges     (id, date_record_id → date_records, name, expected_usd,
                actual_usd, actual_inr, link, sort_order)
```

---

## Browser support

Modern Chrome, Firefox, Safari, Edge. Uses `fetch`, `position: sticky`, and ES2020+; no polyfills included.

---

## License

MIT

---

**Live:** [https://record-book-iota.vercel.app](https://record-book-iota.vercel.app)

**GitHub:** [https://github.com/jigyasu2004/record_book](https://github.com/jigyasu2004/record_book)
