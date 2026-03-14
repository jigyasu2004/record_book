const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3002;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database(path.join(__dirname, 'earnings.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS date_records (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS challenges (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    date_record_id INTEGER NOT NULL,
    name           TEXT    NOT NULL DEFAULT 'Challenge',
    expected_usd   REAL    DEFAULT NULL,
    actual_usd     REAL    DEFAULT NULL,
    sort_order     INTEGER DEFAULT 0,
    FOREIGN KEY (date_record_id) REFERENCES date_records(id) ON DELETE CASCADE
  );

  INSERT OR IGNORE INTO settings (key, value) VALUES ('usd_rate', '92.54');
`);

// Migrations: add new columns if they don't exist yet
try { db.exec('ALTER TABLE challenges ADD COLUMN link       TEXT DEFAULT NULL'); } catch (_) {}
try { db.exec('ALTER TABLE challenges ADD COLUMN actual_inr REAL DEFAULT NULL'); } catch (_) {}

// One-time migration: set actual_inr for rows that already have actual_usd
{
  const currentRate = parseFloat(
    db.prepare("SELECT value FROM settings WHERE key = 'usd_rate'").get()?.value || '92.54'
  );
  db.prepare(`
    UPDATE challenges
    SET actual_inr = ROUND(actual_usd * ?, 2)
    WHERE actual_usd IS NOT NULL AND actual_inr IS NULL
  `).run(currentRate);
}

// Pre-populate March 7–14, 2026 (skips dates that already exist)
const seedDates = [
  '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
  '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14'
];
const insertDate = db.prepare('INSERT OR IGNORE INTO date_records (date) VALUES (?)');
seedDates.forEach(d => insertDate.run(d));

/* ─── helpers ─────────────────────────────────────────────────────── */
function getAllData() {
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  settingsRows.forEach(({ key, value }) => {
    settings[key] = isNaN(value) ? value : parseFloat(value);
  });

  // ascending order: oldest date first
  const records = db.prepare('SELECT * FROM date_records ORDER BY date ASC').all();
  const allChallenges = db
    .prepare('SELECT * FROM challenges ORDER BY sort_order ASC, id ASC')
    .all();

  records.forEach(r => {
    r.challenges = allChallenges.filter(c => c.date_record_id === r.id);
  });

  return { settings, records };
}

/* ─── routes ──────────────────────────────────────────────────────── */

// Full data snapshot
app.get('/api/data', (req, res) => {
  try { res.json(getAllData()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Add date record
app.post('/api/records', (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: 'Date is required' });
    const result = db.prepare('INSERT INTO date_records (date) VALUES (?)').run(date);
    const record = db.prepare('SELECT * FROM date_records WHERE id = ?').get(result.lastInsertRowid);
    record.challenges = [];
    res.json(record);
  } catch (e) {
    if (e.message.includes('UNIQUE'))
      return res.status(400).json({ error: 'A record for this date already exists.' });
    res.status(500).json({ error: e.message });
  }
});

// Delete date record
app.delete('/api/records/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM date_records WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add challenge to a date record
app.post('/api/records/:id/challenges', (req, res) => {
  try {
    const dateRecordId = parseInt(req.params.id);
    const { name, link } = req.body;
    const { count } = db
      .prepare('SELECT COUNT(*) as count FROM challenges WHERE date_record_id = ?')
      .get(dateRecordId);
    const result = db
      .prepare('INSERT INTO challenges (date_record_id, name, link, sort_order) VALUES (?, ?, ?, ?)')
      .run(dateRecordId, name || `Source ${count + 1}`, link || null, count);
    const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(result.lastInsertRowid);
    res.json(challenge);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Patch challenge fields (partial update – includes link)
app.patch('/api/challenges/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Challenge not found' });

    const merged = { ...existing, ...req.body };
    db.prepare(
      'UPDATE challenges SET name = ?, expected_usd = ?, actual_usd = ?, actual_inr = ?, link = ? WHERE id = ?'
    ).run(merged.name, merged.expected_usd, merged.actual_usd, merged.actual_inr ?? null, merged.link ?? null, req.params.id);

    res.json(db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete challenge
app.delete('/api/challenges/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM challenges WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update a setting value
app.put('/api/settings/:key', (req, res) => {
  try {
    const { value } = req.body;
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(req.params.key, String(value));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`\n  Earnings Record Book  →  http://localhost:${PORT}\n`);
});
