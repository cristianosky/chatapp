const fs   = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'enc');
const TTL_MS     = 48 * 60 * 60 * 1000; // 48 horas

// Crear directorio si no existe
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** Guarda un buffer en disco y devuelve el fileId (UUID). */
function saveFile(buffer) {
  const fileId   = randomUUID();
  const filePath = path.join(UPLOAD_DIR, fileId);
  fs.writeFileSync(filePath, buffer);
  return fileId;
}

/** Devuelve la ruta absoluta del archivo o null si no existe / fileId inválido. */
function getFilePath(fileId) {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) return null;
  const filePath = path.join(UPLOAD_DIR, fileId);
  return fs.existsSync(filePath) ? filePath : null;
}

/** Elimina archivos con más de 48 horas. Llamar periódicamente. */
function cleanupOldFiles() {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    const now   = Date.now();
    let deleted = 0;
    for (const file of fs.readdirSync(UPLOAD_DIR)) {
      const fp   = path.join(UPLOAD_DIR, file);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > TTL_MS) {
        fs.unlinkSync(fp);
        deleted++;
      }
    }
    if (deleted > 0) console.log(`[mediaStorage] Eliminated ${deleted} expired files`);
  } catch (err) {
    console.error('[mediaStorage] Cleanup error:', err);
  }
}

module.exports = { saveFile, getFilePath, cleanupOldFiles };
