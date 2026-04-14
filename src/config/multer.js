const multer = require('multer');
const path   = require('path');
const crypto = require('crypto');

const MAX_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024;

// ── Storage engines ───────────────────────────────────────────
// Multer 2.x: destination and filename return values (no callback)

function makeStorage(subfolder) {
  return multer.diskStorage({
    destination(req, file) {
      return path.join(process.env.UPLOADS_DIR || 'uploads', subfolder);
    },
    filename(req, file) {
      const ext    = path.extname(file.originalname).toLowerCase();
      const unique = crypto.randomBytes(16).toString('hex');
      return `${unique}${ext}`;
    },
  });
}

// ── File filters ──────────────────────────────────────────────
// Multer 2.x: fileFilter returns a boolean or throws

function imageFilter(req, file) {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowed.includes(file.mimetype)) return true;
  const err = new Error('Only JPEG, PNG, GIF and WebP images are allowed');
  err.status = 415;
  throw err;
}

function videoFilter(req, file) {
  const allowed = ['video/mp4', 'video/webm', 'video/quicktime'];
  if (allowed.includes(file.mimetype)) return true;
  const err = new Error('Only MP4, WebM and MOV videos are allowed');
  err.status = 415;
  throw err;
}

function mediaFilter(req, file) {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) return true;
  const err = new Error('Only image and video files are allowed');
  err.status = 415;
  throw err;
}

// ── Exported uploaders ────────────────────────────────────────

const uploadImage = multer({
  storage: makeStorage('images'),
  limits:  { fileSize: MAX_BYTES },
  fileFilter: imageFilter,
});

const uploadVideo = multer({
  storage: makeStorage('videos'),
  limits:  { fileSize: MAX_BYTES },
  fileFilter: videoFilter,
});

// Single field that accepts both images and videos
const uploadMedia = multer({
  storage: multer.diskStorage({
    destination(req, file) {
      const sub = file.mimetype.startsWith('video/') ? 'videos' : 'images';
      return path.join(process.env.UPLOADS_DIR || 'uploads', sub);
    },
    filename(req, file) {
      const ext    = path.extname(file.originalname).toLowerCase();
      const unique = crypto.randomBytes(16).toString('hex');
      return `${unique}${ext}`;
    },
  }),
  limits: { fileSize: MAX_BYTES },
  fileFilter: mediaFilter,
});

module.exports = { uploadImage, uploadVideo, uploadMedia };
