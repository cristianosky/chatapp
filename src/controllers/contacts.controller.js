const { query } = require('../config/database');
const { bulkIsOnline } = require('../config/redis');

// ── GET /contacts ──────────────────────────────────────────────
// Returns accepted contacts only

async function listContacts(req, res) {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, c.created_at AS added_at
       FROM contacts c
       JOIN users u ON u.id = c.contact_id
       WHERE c.user_id = $1 AND c.status = 'accepted'
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

// ── GET /contacts/pending ──────────────────────────────────────
// Requests received by the current user (they are the contact_id)

async function listPending(req, res) {
  try {
    const result = await query(
      `SELECT c.id AS request_id, u.id, u.username, u.display_name, u.avatar_url, c.created_at AS requested_at
       FROM contacts c
       JOIN users u ON u.id = c.user_id
       WHERE c.contact_id = $1 AND c.status = 'pending'
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    return res.json({ requests: result.rows });
  } catch (err) {
    console.error('listPending error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /contacts/sent ─────────────────────────────────────────
// Requests sent by the current user that are still pending

async function listSent(req, res) {
  try {
    const result = await query(
      `SELECT c.id AS request_id, u.id, u.username, u.display_name, u.avatar_url, c.created_at AS requested_at
       FROM contacts c
       JOIN users u ON u.id = c.contact_id
       WHERE c.user_id = $1 AND c.status = 'pending'
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    return res.json({ sent: result.rows });
  } catch (err) {
    console.error('listSent error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /contacts/request ─────────────────────────────────────
// Body: { username }

async function sendRequest(req, res) {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username is required' });

  try {
    const userResult = await query(
      'SELECT id, username, display_name, avatar_url FROM users WHERE username = $1',
      [username.toLowerCase()]
    );
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });

    const target = userResult.rows[0];
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot add yourself as a contact' });
    }

    // Check for any existing relationship in either direction
    const existing = await query(
      `SELECT id, user_id, contact_id, status, requested_by
       FROM contacts
       WHERE (user_id = $1 AND contact_id = $2) OR (user_id = $2 AND contact_id = $1)`,
      [req.user.id, target.id]
    );

    if (existing.rows.length) {
      const row = existing.rows[0];
      if (row.status === 'accepted') {
        return res.status(400).json({ error: 'Already contacts' });
      }
      if (row.status === 'blocked') {
        return res.status(400).json({ error: 'Cannot send request' });
      }
      if (row.status === 'pending') {
        // I already sent it
        if (row.user_id === req.user.id) {
          return res.status(400).json({ error: 'Request already sent' });
        }
        // They already sent me one — tell the client to accept instead
        return res.status(400).json({
          error: 'This user already sent you a contact request. Accept it instead.',
          request_id: row.id,
        });
      }
    }

    const result = await query(
      `INSERT INTO contacts (user_id, contact_id, status, requested_by)
       VALUES ($1, $2, 'pending', $1)
       RETURNING id`,
      [req.user.id, target.id]
    );

    // Real-time notification to the target
    const io = req.app.get('io');
    io.to(`user:${target.id}`).emit('contact_request', {
      request_id: result.rows[0].id,
      from: { id: req.user.id, username: req.user.username },
    });

    return res.status(201).json({
      message: 'Contact request sent',
      request_id: result.rows[0].id,
    });
  } catch (err) {
    console.error('sendRequest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /contacts/:id/accept ──────────────────────────────────
// :id is the contacts row id (request_id from listPending)

async function acceptRequest(req, res) {
  const { id } = req.params;
  try {
    // Fetch the pending row where I am the recipient (contact_id)
    const result = await query(
      `SELECT c.id, c.user_id, c.requested_by,
              u.username, u.display_name, u.avatar_url
       FROM contacts c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = $1 AND c.contact_id = $2 AND c.status = 'pending'`,
      [id, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Pending request not found' });
    }

    const request = result.rows[0];

    // Mark the original row as accepted
    await query(`UPDATE contacts SET status = 'accepted' WHERE id = $1`, [id]);

    // Create the reverse row so both sides see each other in their contacts list
    await query(
      `INSERT INTO contacts (user_id, contact_id, status, requested_by)
       VALUES ($1, $2, 'accepted', $3)
       ON CONFLICT (user_id, contact_id) DO UPDATE SET status = 'accepted'`,
      [req.user.id, request.user_id, request.requested_by]
    );

    // Real-time notification to the original requester
    const io = req.app.get('io');
    io.to(`user:${request.user_id}`).emit('contact_accepted', {
      by: { id: req.user.id, username: req.user.username },
    });

    return res.json({
      message: 'Contact request accepted',
      contact: {
        id:           request.user_id,
        username:     request.username,
        display_name: request.display_name,
        avatar_url:   request.avatar_url,
      },
    });
  } catch (err) {
    console.error('acceptRequest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /contacts/:id/reject ──────────────────────────────────

async function rejectRequest(req, res) {
  const { id } = req.params;
  try {
    const result = await query(
      `DELETE FROM contacts
       WHERE id = $1 AND contact_id = $2 AND status = 'pending'
       RETURNING user_id`,
      [id, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Pending request not found' });
    }

    // Real-time notification to the requester
    const io = req.app.get('io');
    io.to(`user:${result.rows[0].user_id}`).emit('contact_rejected', {
      by: { id: req.user.id, username: req.user.username },
    });

    return res.json({ message: 'Contact request rejected' });
  } catch (err) {
    console.error('rejectRequest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /contacts/:contactId ────────────────────────────────
// :contactId is the other user's UUID
// Body (optional): { block: true } → block instead of remove

async function removeContact(req, res) {
  const { contactId } = req.params;
  const block = req.body?.block === true;

  try {
    if (block) {
      // Upsert my side to 'blocked'
      await query(
        `INSERT INTO contacts (user_id, contact_id, status, requested_by)
         VALUES ($1, $2, 'blocked', $1)
         ON CONFLICT (user_id, contact_id) DO UPDATE SET status = 'blocked'`,
        [req.user.id, contactId]
      );
      // Remove the reverse row so the blocked user loses us from their list
      await query(
        'DELETE FROM contacts WHERE user_id = $1 AND contact_id = $2',
        [contactId, req.user.id]
      );
      return res.json({ message: 'Contact blocked' });
    }

    // Remove both directions
    await query(
      `DELETE FROM contacts
       WHERE (user_id = $1 AND contact_id = $2)
          OR (user_id = $2 AND contact_id = $1)`,
      [req.user.id, contactId]
    );
    return res.json({ message: 'Contact removed' });
  } catch (err) {
    console.error('removeContact error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listContacts,
  listPending,
  listSent,
  sendRequest,
  acceptRequest,
  rejectRequest,
  removeContact,
};
