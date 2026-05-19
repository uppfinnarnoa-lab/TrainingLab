// Run `pnpm db:generate` after setting DATABASE_URL to generate Prisma client types.
// The `any` cast here resolves before generation; types are restored after `pnpm db:generate`.
/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client");

const globalForPrisma = globalThis as unknown as { prisma: any };

export const prisma: any =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
