const multer = require('multer');

const MAX_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024;

// ── File filters ──────────────────────────────────────────────

function imageFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  const err = new Error('Only JPEG, PNG, GIF and WebP images are allowed');
  err.status = 415;
  cb(err);
}

function videoFilter(req, file, cb) {
  const allowed = ['video/mp4', 'video/webm', 'video/quicktime'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  const err = new Error('Only MP4, WebM and MOV videos are allowed');
  err.status = 415;
  cb(err);
}

function mediaFilter(req, file, cb) {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    return cb(null, true);
  }
  const err = new Error('Only image and video files are allowed');
  err.status = 415;
  cb(err);
}

// ── Exported uploaders (memory storage — no files written to disk) ────────────

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_BYTES },
  fileFilter: imageFilter,
});

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_BYTES },
  fileFilter: videoFilter,
});

const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_BYTES },
  fileFilter: mediaFilter,
});

module.exports = { uploadImage, uploadVideo, uploadMedia };
