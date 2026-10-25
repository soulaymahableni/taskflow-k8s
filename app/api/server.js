'use strict';
// TaskFlow API : inscription / connexion (JWT), tâches par utilisateur, statistiques.
// Toute la configuration vient des variables d'environnement (aucune valeur en dur).
const express = require('express');
const { Pool, types } = require('pg');
types.setTypeParser(1082, (v) => v); // colonnes DATE renvoyées telles quelles (AAAA-MM-JJ)
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const log = (...a) => console.log(new Date().toISOString(), ...a);

const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Variables d'environnement manquantes : ${missing.join(', ')}`);
  process.exit(1);
}

const PORT = parseInt(process.env.API_PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 3000,
});
pool.on('error', (e) => log('Erreur PostgreSQL :', e.message));

// ---------- Migration automatique ----------
let migrated = false;
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          TEXT        NOT NULL,
      email         TEXT        NOT NULL UNIQUE,
      password_hash TEXT        NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT        NOT NULL,
      description TEXT        NOT NULL DEFAULT '',
      priority    TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
      done        BOOLEAN     NOT NULL DEFAULT false,
      due_date    DATE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks(user_id);
  `);
  migrated = true;
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.on('finish', () => {
    if (!['/health', '/ready'].includes(req.path)) log(req.method, req.originalUrl, res.statusCode);
  });
  next();
});
const h = (fn) => (req, res, next) => fn(req, res).catch(next);

// ---------- Sondes Kubernetes ----------
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    if (!migrated) await migrate();
    res.json({ status: 'ready' });
  } catch (e) {
    res.status(503).json({ status: 'not ready', error: e.message });
  }
});

// ---------- Authentification ----------
const sign = (u) => jwt.sign({ id: u.id, name: u.name, email: u.email }, JWT_SECRET, { expiresIn: '7d' });
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, created_at: u.created_at });

app.post('/auth/register', h(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name || !email || !password) return res.status(400).json({ error: 'Nom, email et mot de passe sont obligatoires' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Adresse email invalide' });
  if (password.length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rowCount) return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *', [name, email, hash]);
  log('Nouvel utilisateur inscrit :', rows[0].id);
  res.status(201).json({ token: sign(rows[0]), user: publicUser(rows[0]) });
}));

app.post('/auth/login', h(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }
  log('Connexion utilisateur :', rows[0].id);
  res.json({ token: sign(rows[0]), user: publicUser(rows[0]) });
}));

function auth(req, res, next) {
  const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: 'Authentification requise' });
  try {
    req.user = jwt.verify(m[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expirée, reconnectez-vous' });
  }
}

app.get('/auth/me', auth, h(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows.length) return res.status(401).json({ error: 'Utilisateur introuvable' });
  res.json(publicUser(rows[0]));
}));

// ---------- Tâches (CRUD, limitées à l'utilisateur connecté) ----------
const PRIORITIES = ['low', 'medium', 'high'];

app.get('/tasks', auth, h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM tasks WHERE user_id = $1
     ORDER BY done, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date NULLS LAST, id DESC`,
    [req.user.id]);
  res.json(rows);
}));

app.post('/tasks', auth, h(async (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Le titre est obligatoire' });
  const priority = PRIORITIES.includes(req.body.priority) ? req.body.priority : 'medium';
  const { rows } = await pool.query(
    `INSERT INTO tasks (user_id, title, description, priority, due_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.id, title, String(req.body.description || ''), priority, req.body.due_date || null]);
  log('Tâche créée :', rows[0].id, 'par utilisateur', req.user.id);
  res.status(201).json(rows[0]);
}));

app.put('/tasks/:id', auth, h(async (req, res) => {
  const b = req.body;
  const priority = PRIORITIES.includes(b.priority) ? b.priority : null;
  const { rows } = await pool.query(
    `UPDATE tasks SET
       title       = COALESCE($1, title),
       description = COALESCE($2, description),
       priority    = COALESCE($3, priority),
       done        = COALESCE($4, done),
       due_date    = CASE WHEN $5::boolean THEN $6::date ELSE due_date END
     WHERE id = $7 AND user_id = $8 RETURNING *`,
    [b.title ? String(b.title).trim() : null,
     b.description !== undefined ? String(b.description) : null,
     priority,
     typeof b.done === 'boolean' ? b.done : null,
     b.due_date !== undefined, b.due_date || null,
     req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Tâche introuvable' });
  res.json(rows[0]);
}));

app.delete('/tasks/:id', auth, h(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ error: 'Tâche introuvable' });
  log('Tâche supprimée :', req.params.id);
  res.status(204).end();
}));

// ---------- Statistiques du dashboard ----------
app.get('/stats', auth, h(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      count(*)::int                                                         AS total,
      count(*) FILTER (WHERE done)::int                                     AS done,
      count(*) FILTER (WHERE NOT done)::int                                 AS pending,
      count(*) FILTER (WHERE NOT done AND due_date < CURRENT_DATE)::int     AS overdue,
      count(*) FILTER (WHERE NOT done AND priority = 'high')::int           AS high
    FROM tasks WHERE user_id = $1`, [req.user.id]);
  res.json(rows[0]);
}));

app.use((err, req, res, next) => {
  log('Erreur :', err.message);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

const server = app.listen(PORT, () => log(`API TaskFlow à l'écoute sur le port ${PORT}`));

(async function initDb() {
  for (;;) {
    try {
      await migrate();
      log(`Connexion à la base réussie (${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME}), tables prêtes`);
      return;
    } catch (e) {
      log('Base indisponible, nouvel essai dans 3 s :', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
})();

process.on('SIGTERM', () => {
  log('SIGTERM reçu, arrêt propre');
  server.close(async () => { await pool.end(); process.exit(0); });
});
