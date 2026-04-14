const { query } = require('../config/database');
const path       = require('path');

// ── GET /conversations/:id/messages ───────────────────────────
// Pagination: ?before=<message_id>&limit=50

async function listMessages(req, res) {
  const { id: conversationId } = req.params;
  const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before; // cursor: message id

  // Verify membership
  const memberCheck = await query(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, req.user.id]
  );
  if (!memberCheck.rows.length) return res.status(403).json({ error: 'Access denied' });

  try {
    let sql;
    let params;

    if (before) {
      // Get the created_at of the cursor message first
      const cursor = await query('SELECT created_at FROM messages WHERE id = $1', [before]);
      if (!cursor.rows.length) return res.status(400).json({ error: 'Invalid cursor' });

      sql = `
        SELECT m.*, u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = $1 AND m.created_at < $2
        ORDER BY m.created_at DESC
        LIMIT $3`;
      params = [conversationId, cursor.rows[0].created_at, limit];
    } else {
      sql = `
        SELECT m.*, u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2`;
      params = [conversationId, limit];
    }

    const result   = await query(sql, params);
    const messages = result.rows.reverse(); // oldest → newest

    // Mark conversation as read
    await query(
      `UPDATE conversation_participants
       SET last_read_at = NOW()
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, req.user.id]
    );

    return res.json({
      messages,
      has_more: result.rows.length === limit,
    });
  } catch (err) {
    console.error('listMessages error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /conversations/:id/messages ─────────────────────────
// Body: { content } OR multipart with file field "media"

async function sendMessage(req, res) {
  const { id: conversationId } = req.params;
  const { content }            = req.body;

  // Verify membership
  const memberCheck = await query(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, req.user.id]
  );
  if (!memberCheck.rows.length) return res.status(403).json({ error: 'Access denied' });

  let media_url  = null;
  let media_type = null;

  if (req.file) {
    const sub   = req.file.mimetype.startsWith('video/') ? 'videos' : 'images';
    media_url   = `/uploads/${sub}/${req.file.filename}`;
    media_type  = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
  }

  if (!content && !media_url) {
    return res.status(400).json({ error: 'Message must have content or a media file' });
  }

  try {
    const result = await query(
      `INSERT INTO messages (conversation_id, sender_id, content, media_url, media_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [conversationId, req.user.id, content || null, media_url, media_type]
    );
    const message = result.rows[0];

    // Attach sender info
    const senderResult = await query(
      'SELECT username, display_name, avatar_url FROM users WHERE id = $1',
      [req.user.id]
    );
    const sender = senderResult.rows[0];
    const fullMessage = {
      ...message,
      sender_username:     sender.username,
      sender_display_name: sender.display_name,
      sender_avatar:       sender.avatar_url,
    };

    // Emit via Socket.io if io is available
    const io = req.app.get('io');
    if (io) {
      io.to(`conversation:${conversationId}`).emit('new_message', fullMessage);
    }

    return res.status(201).json({ message: fullMessage });
  } catch (err) {
    console.error('sendMessage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /messages/:messageId ───────────────────────────────

async function deleteMessage(req, res) {
  const { messageId } = req.params;
  try {
    const result = await query(
      'DELETE FROM messages WHERE id = $1 AND sender_id = $2 RETURNING id',
      [messageId, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Message not found or not yours' });
    return res.json({ message: 'Message deleted' });
  } catch (err) {
    console.error('deleteMessage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { listMessages, sendMessage, deleteMessage };
