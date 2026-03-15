'use strict';

require('dotenv').config();
const express      = require('express');
const { Pool }     = require('pg');
const bcrypt       = require('bcryptjs');
const cookieParser = require('cookie-parser');
const crypto       = require('crypto');
const path         = require('path');

const app  = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ── Database ────────────────────────────────────────────────────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key     TEXT NOT NULL,
      value   TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );

    CREATE TABLE IF NOT EXISTS date_records (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, date)
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id             SERIAL PRIMARY KEY,
      date_record_id INTEGER NOT NULL REFERENCES date_records(id) ON DELETE CASCADE,
      name           TEXT NOT NULL DEFAULT 'Challenge',
      expected_usd   REAL DEFAULT NULL,
      actual_usd     REAL DEFAULT NULL,
      actual_inr     REAL DEFAULT NULL,
      link           TEXT DEFAULT NULL,
      sort_order     INTEGER DEFAULT 0
    );
  `);
}

/* ── Auth middleware ─────────────────────────────────────────────── */
async function requireAuth(req, res, next) {
  try {
    const sid = req.cookies.session_id;
    if (!sid) return res.status(401).json({ error: 'Not authenticated' });
    const { rows } = await pool.query(
      'SELECT user_id FROM sessions WHERE id = $1 AND expires_at > NOW()',
      [sid]
    );
    if (!rows.length) return res.status(401).json({ error: 'Session expired' });
    req.userId = rows[0].user_id;
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ── Data helper ─────────────────────────────────────────────────── */
async function getAllData(userId) {
  const { rows: sRows } = await pool.query(
    'SELECT key, value FROM user_settings WHERE user_id = $1', [userId]
  );
  const settings = { usd_rate: 92.54 };
  sRows.forEach(({ key, value }) => {
    settings[key] = isNaN(value) ? value : parseFloat(value);
  });
  if (!sRows.find(r => r.key === 'usd_rate')) {
    await pool.query(
      'INSERT INTO user_settings (user_id,key,value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [userId, 'usd_rate', '92.54']
    );
  }

  const { rows: records } = await pool.query(
    `SELECT id, user_id, date::TEXT AS date, created_at
     FROM date_records WHERE user_id = $1 ORDER BY date ASC`,
    [userId]
  );
  const { rows: allChallenges } = await pool.query(
    `SELECT c.* FROM challenges c
     JOIN date_records dr ON dr.id = c.date_record_id
     WHERE dr.user_id = $1
     ORDER BY c.sort_order ASC, c.id ASC`,
    [userId]
  );
  records.forEach(r => {
    // Always normalize to bare YYYY-MM-DD string — guards against pg
    // returning a Date object (which JSON-serializes as UTC ISO string,
    // shifting the date by -1 in IST / UTC+5:30)
    r.date = String(r.date).substring(0, 10);
    r.challenges = allChallenges.filter(c => c.date_record_id === r.id);
  });
  return { settings, records };
}

/* ── Auth routes ─────────────────────────────────────────────────── */

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username?.trim() || !password)
      return res.status(400).json({ error: 'Username and password required' });
    if (username.trim().length < 3)
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username.trim().toLowerCase(), hash]
    );
    const user = rows[0];
    await pool.query(
      'INSERT INTO user_settings (user_id, key, value) VALUES ($1, $2, $3)',
      [user.id, 'usd_rate', '92.54']
    );

    const sid = crypto.randomBytes(32).toString('hex');
    const exp = new Date(Date.now() + 7 * 86400 * 1000);
    await pool.query(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)',
      [sid, user.id, exp]
    );
    res.cookie('session_id', sid, { httpOnly: true, expires: exp, sameSite: 'lax' });
    res.json({ user: { id: user.id, username: user.username } });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Username already taken' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1', [username.trim().toLowerCase()]
    );
    if (!rows.length) return res.status(400).json({ error: 'Invalid username or password' });
    const user = rows[0];
    if (!(await bcrypt.compare(password, user.password_hash)))
      return res.status(400).json({ error: 'Invalid username or password' });

    const sid = crypto.randomBytes(32).toString('hex');
    const exp = new Date(Date.now() + 7 * 86400 * 1000);
    await pool.query(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)',
      [sid, user.id, exp]
    );
    res.cookie('session_id', sid, { httpOnly: true, expires: exp, sameSite: 'lax' });
    res.json({ user: { id: user.id, username: user.username } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', async (req, res) => {
  const sid = req.cookies.session_id;
  if (sid) {
    await pool.query('DELETE FROM sessions WHERE id = $1', [sid]).catch(() => {});
    res.clearCookie('session_id');
  }
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const sid = req.cookies.session_id;
    if (!sid) return res.json({ user: null });
    const { rows } = await pool.query(
      `SELECT u.id, u.username FROM users u
       JOIN sessions s ON s.user_id = u.id
       WHERE s.id = $1 AND s.expires_at > NOW()`,
      [sid]
    );
    if (!rows.length) { res.clearCookie('session_id'); return res.json({ user: null }); }
    res.json({ user: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Data routes ─────────────────────────────────────────────────── */

app.get('/api/data', requireAuth, async (req, res) => {
  try { res.json(await getAllData(req.userId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/records', requireAuth, async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: 'Date is required' });
    const { rows } = await pool.query(
      `INSERT INTO date_records (user_id, date) VALUES ($1, $2)
       RETURNING id, user_id, date::TEXT AS date, created_at`,
      [req.userId, date]
    );
    const record = rows[0];
    record.challenges = [];
    res.json(record);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'A record for this date already exists.' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/records/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM date_records WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Clear all challenges for a date (server-side commit for clear-with-undo)
app.delete('/api/records/:id/challenges', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id FROM date_records WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Record not found' });
    await pool.query('DELETE FROM challenges WHERE date_record_id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Restore challenges (used by undo after clear-all)
app.post('/api/records/:id/challenges/restore', requireAuth, async (req, res) => {
  try {
    const drId = parseInt(req.params.id);
    const { rows: rec } = await pool.query(
      'SELECT id FROM date_records WHERE id = $1 AND user_id = $2', [drId, req.userId]
    );
    if (!rec.length) return res.status(404).json({ error: 'Record not found' });

    const { challenges } = req.body;
    if (!Array.isArray(challenges) || !challenges.length)
      return res.status(400).json({ error: 'challenges array required' });

    const inserted = [];
    for (const c of challenges) {
      const { rows } = await pool.query(
        `INSERT INTO challenges
           (date_record_id, name, expected_usd, actual_usd, actual_inr, link, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [drId, c.name || 'Source', c.expected_usd ?? null, c.actual_usd ?? null,
         c.actual_inr ?? null, c.link ?? null, c.sort_order ?? 0]
      );
      inserted.push(rows[0]);
    }
    res.json({ challenges: inserted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/records/:id/challenges', requireAuth, async (req, res) => {
  try {
    const drId = parseInt(req.params.id);
    const { rows: rec } = await pool.query(
      'SELECT id FROM date_records WHERE id = $1 AND user_id = $2', [drId, req.userId]
    );
    if (!rec.length) return res.status(404).json({ error: 'Record not found' });

    const { name, link } = req.body;
    const { rows: cnt } = await pool.query(
      'SELECT COUNT(*) AS count FROM challenges WHERE date_record_id = $1', [drId]
    );
    const count = parseInt(cnt[0].count);
    const { rows } = await pool.query(
      'INSERT INTO challenges (date_record_id, name, link, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
      [drId, name || `Source ${count + 1}`, link || null, count]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/challenges/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.* FROM challenges c
       JOIN date_records dr ON dr.id = c.date_record_id
       WHERE c.id = $1 AND dr.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Challenge not found' });

    const m = { ...rows[0], ...req.body };
    await pool.query(
      'UPDATE challenges SET name=$1, expected_usd=$2, actual_usd=$3, actual_inr=$4, link=$5 WHERE id=$6',
      [m.name, m.expected_usd ?? null, m.actual_usd ?? null, m.actual_inr ?? null, m.link ?? null, req.params.id]
    );
    const { rows: upd } = await pool.query('SELECT * FROM challenges WHERE id = $1', [req.params.id]);
    res.json(upd[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/challenges/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM challenges WHERE id = $1
       AND date_record_id IN (SELECT id FROM date_records WHERE user_id = $2)`,
      [req.params.id, req.userId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/settings/:key', requireAuth, async (req, res) => {
  try {
    const { value } = req.body;
    await pool.query(
      `INSERT INTO user_settings (user_id, key, value) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = $3`,
      [req.userId, req.params.key, String(value)]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Start ───────────────────────────────────────────────────────── */
const dbReady = initDB();

if (require.main === module) {
  // Local development — start the HTTP server
  dbReady
    .then(() => app.listen(PORT, () =>
      console.log(`\n  Earnings Record Book  →  http://localhost:${PORT}\n`)
    ))
    .catch(err => { console.error('DB init failed:', err); process.exit(1); });
} else {
  // Vercel serverless — DB is initialised when the module first loads
  dbReady.catch(err => console.error('DB init failed:', err));
}

module.exports = app;
