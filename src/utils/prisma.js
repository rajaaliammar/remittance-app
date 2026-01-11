import { PrismaClient } from '@prisma/client';

// Create a singleton instance of Prisma Client
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Handle Prisma Client connection
prisma.$connect()
  .then(() => {
    console.log('✅ Prisma Client connected to database');
  })
  .catch((error) => {
    console.error('❌ Failed to connect to database:', error);
  });

export default prisma;

