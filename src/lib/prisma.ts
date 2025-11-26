import { PrismaClient } from '@prisma/client';

// PrismaClient singleton to prevent multiple instances in development
// See: https://www.prisma.io/docs/guides/performance-and-optimization/connection-management#prismaclient-in-long-running-applications

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
