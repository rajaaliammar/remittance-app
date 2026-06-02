import './env-bootstrap.js';
import http from 'http';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma, {
  ensureLevelAndBalanceLimitColumns,
  ensureLevelsTable,
  ensureRegistrationSettingsTable,
  ensureComplianceColumnsAndTables,
} from './utils/prisma.js';
import { getUploadsBase, getWritableKycUploadDir, getWritableAgentKycUploadDir } from './utils/uploadPath.js';
import apiRoutes from './routes/index.js';
import { addSessionRequest } from './store/sessionRequestStore.js';
import { releaseChat } from './store/activeChatStore.js';
import { ensureDefaultFaqs } from './utils/ensureDefaultFaqs.js';
import { ensureDefaultKycForms } from './utils/ensureDefaultKycForms.js';
import {
  logAmlStartupConfig,
  verifyAmlConnectionAtStartup,
} from './services/amlProvider.service.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
// Default Express ETag on JSON breaks mobile clients: conditional GET → 304 with no body,
// while Axios/React Native typically do not replay the previous JSON → lists look empty.
app.set('etag', false);
const PORT = process.env.PORT || 3001;

// CORS configuration – allow portal/dev origins so browser requests succeed
const defaultAllowedOrigins = [
  'http://localhost:5176',
  'http://localhost:5175',
  'http://localhost:5174',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3000',
  'http://apibrandpay.appliedline.com',
  'https://apibrandpay.appliedline.com',
  'https://remittance.appliedline.com',
  'https://remit.appliedline.com',
];
// Optional: extra origins from env (comma-separated), e.g. CORS_ORIGINS=https://portal.example.com
const extraOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOriginsList = [...new Set([...defaultAllowedOrigins, ...extraOrigins])];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    if (allowedOriginsList.indexOf(origin) !== -1) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  optionsSuccessStatus: 200,
  preflightContinue: false,
};

// Middleware
app.use(cors(corsOptions));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve agent KYC uploads from the same dir we write to (so images load after onboarding)
app.use('/uploads/agentKyc', express.static(getWritableAgentKycUploadDir()));
// Serve other static files (customer KYC, notifications, etc.)
app.use('/uploads', express.static(getUploadsBase()));

// Health check route
app.get('/health', async (req, res) => {
  let push = { configured: false };
  let customerCount = null;
  try {
    const { getPushConfigStatus } = await import('./utils/push.js');
    push = getPushConfigStatus();
  } catch {
    /* ignore */
  }
  try {
    const prisma = (await import('./utils/prisma.js')).default;
    customerCount = await prisma.customer.count();
  } catch {
    /* ignore */
  }
  res.json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    push,
    stats: { customerCount },
  });
});

// API routes
app.use('/api', apiRoutes);

// Create HTTP server and attach Socket.io for chat
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: true },
  path: '/socket.io',
});
app.set('io', io);
io.on('connection', (socket) => {
  socket.on('join:user', (data) => {
    const userId = data?.userId != null ? String(data.userId) : null;
    if (userId) {
      socket.join(`user:${userId}`);
      console.log('[Socket] Client joined room user:' + userId);
    }
  });

  // WhatsApp-like: save every message to DB, then broadcast so both app and portal get it and history is complete
  socket.on('sendMessage', async (data, callback) => {
    try {
      const senderId = data?.senderId != null ? String(data.senderId) : null;
      const receiverId = data?.receiverId != null ? String(data.receiverId) : null;
      const message = data?.message != null ? String(data.message).trim() : '';
      if (!senderId || !receiverId || !message) {
        const err = new Error('senderId, receiverId and message are required');
        if (typeof callback === 'function') callback({ error: err.message });
        return;
      }
      const created = await prisma.message.create({
        data: { senderId, recipientId: receiverId, content: message },
      });
      const timestamp = created.createdAt.getTime ? created.createdAt.getTime() : Date.now();
      const payload = {
        id: created.id,
        senderId: created.senderId,
        receiverId: created.recipientId,
        message: created.content,
        timestamp,
      };
      io.emit('receiveMessage', payload);
      if (typeof callback === 'function') callback(null, payload);
      console.log('[Socket] Message saved and broadcast to all clients');
    } catch (err) {
      console.error('[Socket] sendMessage error:', err);
      if (typeof callback === 'function') callback({ error: err.message || 'Failed to send message' });
    }
  });

  // User (app) requests new session after chat was ended; admin must approve in portal
  socket.on('requestNewSession', (data, callback) => {
    try {
      const userId = data?.userId != null ? String(data.userId) : null;
      const supportUserId = data?.supportUserId != null ? String(data.supportUserId) : null;
      if (!userId || !supportUserId) {
        if (typeof callback === 'function') callback({ error: 'userId and supportUserId are required' });
        return;
      }
      const entry = addSessionRequest({ userId, supportUserId });
      if (!entry.alreadyPending) {
        io.emit('sessionRequestReceived', {
          requestId: entry.requestId,
          userId: entry.userId,
          supportUserId: entry.supportUserId,
          createdAt: entry.createdAt,
        });
      }
      if (typeof callback === 'function') {
        callback(null, { requestId: entry.requestId, alreadyPending: !!entry.alreadyPending });
      }
      console.log('[Socket] New session request from user:', userId, 'requestId:', entry.requestId);
    } catch (err) {
      console.error('[Socket] requestNewSession error:', err);
      if (typeof callback === 'function') callback({ error: err.message || 'Failed to submit request' });
    }
  });

  // End chat session: save system message and broadcast so app can disable input
  const CHAT_ENDED_CONTENT = '__CHAT_ENDED__';
  socket.on('endChat', async (data, callback) => {
    try {
      const senderId = data?.senderId != null ? String(data.senderId) : null;
      const receiverId = data?.receiverId != null ? String(data.receiverId) : null;
      if (!senderId || !receiverId) {
        const err = new Error('senderId and receiverId are required');
        if (typeof callback === 'function') callback({ error: err.message });
        return;
      }
      const created = await prisma.message.create({
        data: { senderId, recipientId: receiverId, content: CHAT_ENDED_CONTENT },
      });
      const timestamp = created.createdAt.getTime ? created.createdAt.getTime() : Date.now();
      const payload = {
        id: created.id,
        senderId: created.senderId,
        receiverId: created.recipientId,
        message: CHAT_ENDED_CONTENT,
        timestamp,
        sessionEnded: true,
      };
      io.emit('receiveMessage', payload);
      releaseChat(receiverId);
      if (typeof callback === 'function') callback(null, payload);
      console.log('[Socket] Chat ended, broadcast to all clients, released active chat for', receiverId);
    } catch (err) {
      console.error('[Socket] endChat error:', err);
      if (typeof callback === 'function') callback({ error: err.message || 'Failed to end chat' });
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Route not found' 
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

// Start server after DB is ready and level/balanceLimit columns exist
async function startServer() {
  try {
    await prisma.$connect();
    console.log('✅ Prisma Client connected to database');
    await ensureLevelAndBalanceLimitColumns();
    await ensureLevelsTable();
    await ensureRegistrationSettingsTable();
    await ensureComplianceColumnsAndTables();
    await ensureDefaultFaqs();
    await ensureDefaultKycForms();
    console.log('✅ Level & balance limit columns ready');
    console.log('✅ Registration settings table ready');
    console.log('✅ Compliance columns and alerts table ready');
  } catch (err) {
    console.error('❌ Database setup failed:', err);
    process.exit(1);
  }
  try {
    const kycDir = getWritableKycUploadDir();
    console.log('✅ KYC upload dir ready:', kycDir);
  } catch (err) {
    console.error('❌ KYC upload dir not writable:', err.message);
    process.exit(1);
  }
  const HOST = process.env.HOST || '0.0.0.0';
  server.listen(PORT, HOST, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📱 Android emulator: http://10.0.2.2:${PORT}/api`);
    console.log(`📱 iOS simulator: http://localhost:${PORT}/api`);
    console.log(`📱 Physical device (same WiFi): http://<your-mac-ip>:${PORT}/api`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 API base: http://localhost:${PORT}/api`);
    console.log(`🔌 Socket.io: http://localhost:${PORT}`);
    logAmlStartupConfig();
    void verifyAmlConnectionAtStartup().then((result) => {
      if (result.ok) {
        console.log('[AML] Startup login OK — token ready for onboard/save');
      } else {
        console.error(
          `[AML] Startup login FAILED: ${result.reason}\n` +
            '       Fix AML_CODE, AML_USERNAME, AML_PASSWORD in .env (quote passwords with #), then restart.',
        );
      }
    });
  });
}
startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

