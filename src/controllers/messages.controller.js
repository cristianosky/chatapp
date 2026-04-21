const { query } = require('../config/database');
const { saveFile } = require('../config/mediaStorage');

// ── GET /conversations/:id/messages ───────────────────────────
// Pagination: ?before=<message_id>&limit=50

async function listMessages(req, res) {
  const { id: conversationId } = req.params;
  const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before; // cursor: message id

  try {
    // Verify membership
    const memberCheck = await query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, req.user.id]
    );
    if (!memberCheck.rows.length) return res.status(403).json({ error: 'Access denied' });
    let sql;
    let params;

    if (before) {
      // Fetch both created_at and id of the cursor message for stable pagination
      const cursor = await query('SELECT created_at, id FROM messages WHERE id = $1', [before]);
      if (!cursor.rows.length) return res.status(400).json({ error: 'Invalid cursor' });

      // Use (created_at, id) composite comparison to avoid skipping messages
      // with identical timestamps (rare but possible under high concurrency)
      sql = `
        SELECT m.*, u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = $1
          AND (m.created_at < $2 OR (m.created_at = $2 AND m.id < $3))
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $4`;
      params = [conversationId, cursor.rows[0].created_at, cursor.rows[0].id, limit];
    } else {
      sql = `
        SELECT m.*, u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = $1
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $2`;
      params = [conversationId, limit];
    }

    const result   = await query(sql, params);
    const messages = result.rows.map(row => ({
      id:              row.id,
      conversation_id: row.conversation_id,
      sender_id:       row.sender_id,
      content:         row.content,
      media_url:       row.media_url,
      media_type:      row.media_type,
      media_encrypted: row.media_encrypted || false,
      created_at:      row.created_at,
      sender: row.sender_id ? {
        id:           row.sender_id,
        username:     row.sender_username,
        display_name: row.sender_display_name,
        avatar_url:   row.sender_avatar,
      } : null,
    }));

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

  const isEncrypted = req.body.media_encrypted === 'true';

  if (req.file) {
    const isVideo = req.file.mimetype.startsWith('video/');
    try {
      // Guardar en disco local cifrado — nunca en Cloudinary para mensajes
      const fileId = saveFile(req.file.buffer);
      media_url  = `/api/media/${fileId}`;
      media_type = isEncrypted ? 'image' : (isVideo ? 'video' : 'image');
    } catch (err) {
      console.error('Media save error:', err);
      return res.status(500).json({ error: 'Error al guardar el archivo' });
    }
  }

  if (!content && !media_url) {
    return res.status(400).json({ error: 'Message must have content or a media file' });
  }

  try {
    const result = await query(
      `INSERT INTO messages (conversation_id, sender_id, content, media_url, media_type, media_encrypted)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [conversationId, req.user.id, content || null, media_url, media_type, isEncrypted && !!media_url]
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
      media_encrypted: message.media_encrypted || false,
      sender: {
        id:           req.user.id,
        username:     sender.username,
        display_name: sender.display_name,
        avatar_url:   sender.avatar_url,
      },
    };

    // Emit via Socket.io if io is available
    const io = req.app.get('io');
    if (io) {
      io.to(`conversation:${conversationId}`).emit('new_message', fullMessage);
    }

    return res.status(201).json(fullMessage);
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
