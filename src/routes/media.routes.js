const router = require('express').Router();
const fs     = require('fs');
const { authenticate } = require('../middleware/auth');
const { query }        = require('../config/database');
const { getFilePath }  = require('../config/mediaStorage');

// GET /api/media/:fileId  — descarga un archivo de media (requiere auth + participación)
router.get('/:fileId', authenticate, async (req, res) => {
  const { fileId } = req.params;
  try {
    // Verificar que el usuario es participante de la conversación dueña del archivo
    const msgResult = await query(
      `SELECT conversation_id FROM messages WHERE media_url = $1 LIMIT 1`,
      ['/api/media/' + fileId]
    );
    if (!msgResult.rows.length) return res.status(404).json({ error: 'Not found' });

    const memberCheck = await query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [msgResult.rows[0].conversation_id, req.user.id]
    );
    if (!memberCheck.rows.length) return res.status(403).json({ error: 'Access denied' });

    const filePath = getFilePath(fileId);
    if (!filePath) return res.status(404).json({ error: 'File not found or expired (48h TTL)' });

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('serveMedia error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
