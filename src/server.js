import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma, { ensureLevelAndBalanceLimitColumns, ensureLevelsTable, ensureRegistrationSettingsTable } from './utils/prisma.js';
import apiRoutes from './routes/index.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, curl, etc.)
    if (!origin) return callback(null, true);
    
    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    // In production, only allow specific origins
    const allowedOrigins = [
      'http://localhost:5176',      // Dashboard frontend (Vite default)
      'http://localhost:5173',      // Alternative Vite port
      'http://localhost:3000',      // Alternative frontend port
      'http://apibrandpay.appliedline.com',
      'http://localhost:3001',
      'https://remittance.appliedline.com',
      'https://remit.appliedline.com'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

// Middleware
app.use(cors(corsOptions));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files (KYC uploads)
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Health check route
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// API routes
app.use('/api', apiRoutes);

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
    console.log('✅ Level & balance limit columns ready');
    console.log('✅ Registration settings table ready');
  } catch (err) {
    console.error('❌ Database setup failed:', err);
    process.exit(1);
  }
  const HOST = process.env.HOST || '0.0.0.0';
  app.listen(PORT, HOST, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📱 For mobile/device: http://<your-mac-ip>:${PORT}/api (e.g. http://192.168.100.167:${PORT}/api)`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 API endpoint: http://localhost:${PORT}/api`);
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

