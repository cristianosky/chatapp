const bcrypt   = require('bcryptjs');
const { query } = require('../config/database');
const { isOnline } = require('../config/redis');
const { uploadToCloudinary } = require('../config/cloudinary');

// ── GET /users/search?q=username ──────────────────────────────

async function searchUsers(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  try {
    const result = await query(
      `SELECT id, username, display_name, avatar_url, bio
       FROM users
       WHERE username ILIKE $1
         AND id <> $2
       LIMIT 20`,
      [`%${q}%`, req.user.id]
    );
    return res.json({ users: result.rows });
  } catch (err) {
    console.error('searchUsers error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /users/:username ──────────────────────────────────────

async function getUserByUsername(req, res) {
  try {
    const result = await query(
      `SELECT id, username, display_name, avatar_url, bio, created_at
       FROM users WHERE username = $1`,
      [req.params.username.toLowerCase()]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    const user   = result.rows[0];
    const online = await isOnline(user.id);
    return res.json({ user: { ...user, online } });
  } catch (err) {
    console.error('getUserByUsername error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /users/me ───────────────────────────────────────────

async function updateProfile(req, res) {
  const { display_name, bio } = req.body;

  let avatar_url;
  if (req.file) {
    try {
      const result = await uploadToCloudinary(req.file.buffer, {
        folder:        'chatapp/avatars',
        resource_type: 'image',
      });
      avatar_url = result.secure_url;
    } catch (err) {
      console.error('Cloudinary upload error:', err);
      return res.status(500).json({ error: 'Error al subir la imagen' });
    }
  }

  const fields  = [];
  const values  = [];
  let   counter = 1;

  if (display_name !== undefined) { fields.push(`display_name = $${counter++}`); values.push(display_name); }
  if (bio          !== undefined) { fields.push(`bio = $${counter++}`);          values.push(bio); }
  if (avatar_url   !== undefined) { fields.push(`avatar_url = $${counter++}`);   values.push(avatar_url); }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  values.push(req.user.id);

  try {
    const result = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${counter} RETURNING id, email, username, display_name, avatar_url, bio, created_at, updated_at`,
      values
    );
    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /users/change-password ───────────────────────────────

async function changePassword(req, res) {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password are required' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const user   = result.rows[0];
    const match  = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    return res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('changePassword error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { searchUsers, getUserByUsername, updateProfile, changePassword };
