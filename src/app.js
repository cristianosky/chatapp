require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const path       = require('path');
const rateLimit  = require('express-rate-limit');

const { setupSocket }    = require('./socket/handler');

const authRoutes          = require('./routes/auth.routes');
const usersRoutes         = require('./routes/users.routes');
const contactsRoutes      = require('./routes/contacts.routes');
const conversationsRoutes = require('./routes/conversations.routes');
const keysRoutes          = require('./routes/keys.routes');

// ── App setup ─────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

// Allowed origins for CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ── Socket.io ─────────────────────────────────────────────────

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.set('io', io);
setupSocket(io);

// ── Express middleware ────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow serving uploads to other origins
}));

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : '*',
  credentials: true,
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(process.cwd(), process.env.UPLOADS_DIR || 'uploads')));

// ── Rate limiting ─────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Routes ────────────────────────────────────────────────────

app.use('/api/auth',          authLimiter, authRoutes);
app.use('/api/users',         apiLimiter,  usersRoutes);
app.use('/api/contacts',      apiLimiter,  contactsRoutes);
app.use('/api/conversations', apiLimiter,  conversationsRoutes);
app.use('/api/keys',          apiLimiter,  keysRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large. Max size is ${process.env.MAX_FILE_SIZE_MB || 50}MB` });
  }
  if (err.message && err.message.includes('Only')) {
    return res.status(415).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT) || 3000;

server.listen(PORT, () => {
  console.log(`\n🚀  ChatApp backend running on port ${PORT}`);
  console.log(`   REST API : http://localhost:${PORT}/api`);
  console.log(`   Socket.io: ws://localhost:${PORT}`);
  console.log(`   Health   : http://localhost:${PORT}/health\n`);
});

module.exports = { app, server };
