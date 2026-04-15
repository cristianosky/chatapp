const multer = require('multer');
const path   = require('path');
const crypto = require('crypto');

const MAX_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024;

// ── Storage engines ───────────────────────────────────────────

function makeStorage(subfolder) {
  return multer.diskStorage({
    destination(req, file, cb) {
      cb(null, path.join(process.env.UPLOADS_DIR || 'uploads', subfolder));
    },
    filename(req, file, cb) {
      const ext    = path.extname(file.originalname).toLowerCase();
      const unique = crypto.randomBytes(16).toString('hex');
      cb(null, `${unique}${ext}`);
    },
  });
}

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

const uploadMedia = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const sub = file.mimetype.startsWith('video/') ? 'videos' : 'images';
      cb(null, path.join(process.env.UPLOADS_DIR || 'uploads', sub));
    },
    filename(req, file, cb) {
      const ext    = path.extname(file.originalname).toLowerCase();
      const unique = crypto.randomBytes(16).toString('hex');
      cb(null, `${unique}${ext}`);
    },
  }),
  limits: { fileSize: MAX_BYTES },
  fileFilter: mediaFilter,
});

module.exports = { uploadImage, uploadVideo, uploadMedia };
