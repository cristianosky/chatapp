const jwt = require('jsonwebtoken');
const { query }                        = require('../config/database');
const { setOnline, setOffline, bulkIsOnline } = require('../config/redis');

/**
 * Attach Socket.io event handlers to the given server.
 * @param {import('socket.io').Server} io
 */
function setupSocket(io) {
  // ── Auth middleware ───────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
      || socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) return next(new Error('Authentication required'));

    try {
      const payload  = jwt.verify(token, process.env.JWT_SECRET);
      socket.user    = { id: payload.sub, email: payload.email, username: payload.username };
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection ────────────────────────────────────────────────
  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    console.log(`[socket] ${socket.user.username} connected (${socket.id})`);

    // Personal room — used for direct notifications (contact requests, etc.)
    socket.join(`user:${userId}`);

    // Mark online in Redis
    await setOnline(userId);

    // Auto-join all conversation rooms the user belongs to
    try {
      const result = await query(
        'SELECT conversation_id FROM conversation_participants WHERE user_id = $1',
        [userId]
      );
      result.rows.forEach((r) => socket.join(`conversation:${r.conversation_id}`));
    } catch (err) {
      console.error('Error joining rooms:', err);
    }

    // Notify contacts that this user came online
    broadcastPresence(io, userId, true);

    // ── Heartbeat (keep Redis key alive) ─────────────────────────
    const heartbeatInterval = setInterval(() => setOnline(userId), 25_000);

    // ── Typing indicators ─────────────────────────────────────────
    socket.on('typing_start', ({ conversation_id }) => {
      socket.to(`conversation:${conversation_id}`).emit('typing_start', {
        conversation_id,
        user: { id: userId, username: socket.user.username },
      });
    });

    socket.on('typing_stop', ({ conversation_id }) => {
      socket.to(`conversation:${conversation_id}`).emit('typing_stop', {
        conversation_id,
        user: { id: userId, username: socket.user.username },
      });
    });

    // ── Mark messages as read ─────────────────────────────────────
    socket.on('mark_read', async ({ conversation_id }) => {
      try {
        await query(
          `UPDATE conversation_participants
           SET last_read_at = NOW()
           WHERE conversation_id = $1 AND user_id = $2`,
          [conversation_id, userId]
        );
        // Tell the conversation room that this user read up to now
        socket.to(`conversation:${conversation_id}`).emit('messages_read', {
          conversation_id,
          user_id: userId,
          read_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error('mark_read error:', err);
      }
    });

    // ── Join a new conversation room (e.g. after creating one) ────
    socket.on('join_conversation', (conversation_id) => {
      socket.join(`conversation:${conversation_id}`);
    });

    // ── Disconnect ────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`[socket] ${socket.user.username} disconnected`);
      clearInterval(heartbeatInterval);
      await setOffline(userId);
      broadcastPresence(io, userId, false);
    });
  });
}

// ── Helper: tell all sockets in shared conversations about presence ──

async function broadcastPresence(io, userId, online) {
  try {
    const result = await query(
      `SELECT DISTINCT cp2.user_id
       FROM conversation_participants cp1
       JOIN conversation_participants cp2
         ON cp2.conversation_id = cp1.conversation_id
        AND cp2.user_id <> cp1.user_id
       WHERE cp1.user_id = $1`,
      [userId]
    );

    result.rows.forEach(({ user_id }) => {
      // Emit to every socket owned by that user
      io.to(`user:${user_id}`).emit('presence', { user_id: userId, online });
    });

    // Also emit to user's own sockets
    io.to(`user:${userId}`).emit('presence', { user_id: userId, online });
  } catch (err) {
    console.error('broadcastPresence error:', err);
  }
}

module.exports = { setupSocket };
