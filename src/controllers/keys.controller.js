const { query } = require('../config/database');

// ── PUT /api/keys/me ──────────────────────────────────────────
// Body: { public_key: "<base64 X.509 EC public key>" }

async function registerKey(req, res) {
  const { public_key } = req.body;
  if (!public_key || typeof public_key !== 'string') {
    return res.status(400).json({ error: 'public_key is required' });
  }
  try {
    await query('UPDATE users SET public_key = $1 WHERE id = $2', [public_key, req.user.id]);
    return res.json({ message: 'Key registered' });
  } catch (err) {
    console.error('registerKey error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/keys/conversation/:conversationId ────────────────
// Returns { keys: [{ id, username, public_key }] } for all participants

async function getConversationKeys(req, res) {
  const { conversationId } = req.params;
  try {
    // Verify caller is a participant
    const memberCheck = await query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, req.user.id]
    );
    if (!memberCheck.rows.length) return res.status(403).json({ error: 'Access denied' });

    const result = await query(
      `SELECT u.id, u.username, u.public_key
       FROM conversation_participants cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.conversation_id = $1`,
      [conversationId]
    );
    return res.json({ keys: result.rows });
  } catch (err) {
    console.error('getConversationKeys error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { registerKey, getConversationKeys };
