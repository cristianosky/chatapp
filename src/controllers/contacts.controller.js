const { query }     = require('../config/database');
const { bulkIsOnline } = require('../config/redis');

// ── GET /contacts ─────────────────────────────────────────────

async function listContacts(req, res) {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, c.created_at AS added_at
       FROM contacts c
       JOIN users u ON u.id = c.contact_id
       WHERE c.user_id = $1
       ORDER BY u.display_name ASC`,
      [req.user.id]
    );

    const ids    = result.rows.map((r) => r.id);
    const online = await bulkIsOnline(ids);
    const rows   = result.rows.map((r) => ({ ...r, online: online.has(r.id) }));

    return res.json({ contacts: rows });
  } catch (err) {
    console.error('listContacts error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /contacts ────────────────────────────────────────────
// Body: { username }

async function addContact(req, res) {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username is required' });

  try {
    // Resolve username → id
    const userResult = await query(
      'SELECT id, username, display_name, avatar_url FROM users WHERE username = $1',
      [username.toLowerCase()]
    );
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });

    const contact = userResult.rows[0];
    if (contact.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot add yourself as a contact' });
    }

    await query(
      'INSERT INTO contacts (user_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, contact.id]
    );

    return res.status(201).json({ contact });
  } catch (err) {
    console.error('addContact error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /contacts/:contactId ───────────────────────────────

async function removeContact(req, res) {
  try {
    await query(
      'DELETE FROM contacts WHERE user_id = $1 AND contact_id = $2',
      [req.user.id, req.params.contactId]
    );
    return res.json({ message: 'Contact removed' });
  } catch (err) {
    console.error('removeContact error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { listContacts, addContact, removeContact };
