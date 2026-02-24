const express = require('express');
const { Pool } = require('pg');
const path    = require('path');

const app  = express();

const dbUrl = process.env.DATABASE_URL;
console.log('DATABASE_URL present:', !!dbUrl);

// Private Railway network doesn't need SSL; public proxy does
const useSSL = dbUrl && !dbUrl.includes('railway.internal');

const pool = new Pool({
  connectionString: dbUrl,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Retry helper ─────────────────────────────────────────
async function query(text, params, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await pool.query(text, params);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
}

// ── Create table on startup ──────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS scores (
    id         SERIAL PRIMARY KEY,
    name       TEXT    NOT NULL,
    mode       TEXT    NOT NULL CHECK (mode IN ('trainee','idol','legend')),
    time_ms    BIGINT  NOT NULL,
    time_str   TEXT    NOT NULL,
    moves      INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).then(() => console.log('DB ready'))
  .catch(err => console.error('DB init error:', err.message));

// ── GET /api/scores/:mode  — top 5 for a difficulty ──────
app.get('/api/scores/:mode', async (req, res) => {
  const { mode } = req.params;
  if (!['trainee','idol','legend'].includes(mode))
    return res.status(400).json({ error: 'Invalid mode' });
  try {
    const { rows } = await query(
      `SELECT id, name, time_str, moves, created_at
         FROM scores
        WHERE mode = $1
        ORDER BY time_ms ASC, moves ASC
        LIMIT 5`,
      [mode]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

// ── POST /api/scores  — save a new score ────────────────
app.post('/api/scores', async (req, res) => {
  let { name, mode, time_ms, time_str, moves } = req.body;
  if (!name || !mode || time_ms == null || !time_str || moves == null)
    return res.status(400).json({ error: 'Missing fields' });
  if (!['trainee','idol','legend'].includes(mode))
    return res.status(400).json({ error: 'Invalid mode' });

  name = String(name).trim().slice(0, 16) || 'Hunter';
  time_ms = Math.round(Number(time_ms));
  try {
    const { rows } = await query(
      `INSERT INTO scores (name, mode, time_ms, time_str, moves)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, mode, time_ms, time_str, moves]
    );
    res.json({ id: rows[0].id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

// ── Fallback → serve index.html ──────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Laura's Game running on port ${PORT}`));
