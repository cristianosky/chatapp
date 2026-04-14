const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { query } = require('../config/database');

// ── Helpers ───────────────────────────────────────────────────

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function sanitizeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

// ── POST /auth/register ───────────────────────────────────────

async function register(req, res) {
  const { email, password, username, display_name } = req.body;

  if (!email || !password || !username) {
    return res.status(400).json({ error: 'email, password and username are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–30 chars (letters, numbers, underscores)' });
  }

  try {
    const exists = await query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username.toLowerCase()]
    );
    if (exists.rows.length) {
      return res.status(409).json({ error: 'Email or username already taken' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (email, password_hash, username, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [email.toLowerCase(), hash, username.toLowerCase(), display_name || username]
    );

    const user  = result.rows[0];
    const token = signToken(user);

    return res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /auth/login ──────────────────────────────────────────

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user   = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);
    return res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /auth/me ──────────────────────────────────────────────

async function me(req, res) {
  try {
    const result = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: sanitizeUser(result.rows[0]) });
  } catch (err) {
    console.error('me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { register, login, me };
