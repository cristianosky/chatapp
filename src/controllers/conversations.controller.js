const { query, getClient } = require('../config/database');
const { bulkIsOnline }     = require('../config/redis');

// ── GET /conversations ────────────────────────────────────────

async function listConversations(req, res) {
  try {
    const result = await query(
      `SELECT
         c.id,
         c.is_group,
         c.group_name,
         c.group_avatar,
         c.created_at,
         -- Last message
         lm.id          AS last_message_id,
         lm.content     AS last_message_content,
         lm.media_type  AS last_message_media_type,
         lm.created_at  AS last_message_at,
         lm.sender_id   AS last_message_sender_id,
         -- Unread count for current user
         (
           SELECT COUNT(*)
           FROM messages m2
           WHERE m2.conversation_id = c.id
             AND m2.sender_id <> $1
             AND m2.created_at > COALESCE(cp.last_read_at, '1970-01-01')
         ) AS unread_count
       FROM conversations c
       JOIN conversation_participants cp
         ON cp.conversation_id = c.id AND cp.user_id = $1
       LEFT JOIN LATERAL (
         SELECT id, content, media_type, created_at, sender_id
         FROM messages
         WHERE conversation_id = c.id
         ORDER BY created_at DESC
         LIMIT 1
       ) lm ON TRUE
       ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
      [req.user.id]
    );

    // For direct chats: attach the other participant's profile
    const convIds = result.rows.map((r) => r.id);
    let participants = [];
    if (convIds.length) {
      const pResult = await query(
        `SELECT cp.conversation_id, u.id, u.username, u.display_name, u.avatar_url
         FROM conversation_participants cp
         JOIN users u ON u.id = cp.user_id
         WHERE cp.conversation_id = ANY($1::uuid[])
           AND cp.user_id <> $2`,
        [convIds, req.user.id]
      );
      participants = pResult.rows;
    }

    // Check online status of all other participants
    const otherIds = [...new Set(participants.map((p) => p.id))];
    const online   = await bulkIsOnline(otherIds);

    // Map participants by conversation
    const participantMap = {};
    participants.forEach((p) => {
      if (!participantMap[p.conversation_id]) participantMap[p.conversation_id] = [];
      participantMap[p.conversation_id].push({ ...p, online: online.has(p.id) });
    });

    const conversations = result.rows.map((row) => ({
      ...row,
      participants: participantMap[row.id] || [],
    }));

    return res.json({ conversations });
  } catch (err) {
    console.error('listConversations error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /conversations ───────────────────────────────────────
// Body: { participant_id } for direct chat
//       { participant_ids: [], group_name } for group chat

async function createConversation(req, res) {
  const { participant_id, participant_ids, group_name } = req.body;
  const isGroup = !!participant_ids;

  const memberIds = isGroup
    ? [...new Set([req.user.id, ...participant_ids])]
    : [req.user.id, participant_id];

  if (!isGroup && !participant_id) {
    return res.status(400).json({ error: 'participant_id is required for direct chats' });
  }
  if (!isGroup && participant_id === req.user.id) {
    return res.status(400).json({ error: 'Cannot create chat with yourself' });
  }
  if (isGroup && (!participant_ids.length || !group_name)) {
    return res.status(400).json({ error: 'participant_ids and group_name are required for group chats' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // For direct chats: enforce accepted contact status, then check for existing conversation
    if (!isGroup) {
      const contactCheck = await client.query(
        `SELECT 1 FROM contacts
         WHERE user_id = $1 AND contact_id = $2 AND status = 'accepted'`,
        [req.user.id, participant_id]
      );
      if (!contactCheck.rows.length) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You must be accepted contacts to start a conversation' });
      }

      const existing = await client.query(
        `SELECT c.id FROM conversations c
         JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = $1
         JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = $2
         WHERE c.is_group = FALSE`,
        [req.user.id, participant_id]
      );
      if (existing.rows.length) {
        await client.query('ROLLBACK');
        return res.json(existing.rows[0]);
      }
    }

    const convResult = await client.query(
      `INSERT INTO conversations (is_group, group_name, created_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [isGroup, group_name || null, req.user.id]
    );
    const conversation = convResult.rows[0];

    // Add participants
    for (const uid of memberIds) {
      await client.query(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2)',
        [conversation.id, uid]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json(conversation);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createConversation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
}

// ── GET /conversations/:id ────────────────────────────────────

async function getConversation(req, res) {
  const { id } = req.params;
  try {
    // Verify membership
    const memberCheck = await query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!memberCheck.rows.length) return res.status(403).json({ error: 'Access denied' });

    const convResult = await query('SELECT * FROM conversations WHERE id = $1', [id]);
    if (!convResult.rows.length) return res.status(404).json({ error: 'Conversation not found' });

    const participants = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM conversation_participants cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.conversation_id = $1`,
      [id]
    );

    return res.json({ conversation: convResult.rows[0], participants: participants.rows });
  } catch (err) {
    console.error('getConversation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { listConversations, createConversation, getConversation };
