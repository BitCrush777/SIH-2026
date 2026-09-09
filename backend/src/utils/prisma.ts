import { PrismaClient } from '@prisma/client';

// Singleton PrismaClient instance to avoid connection pool exhaustion
export const prisma = new PrismaClient();
