/**
 * Creates the initial user account.
 * Run once: npx tsx scripts/seed-user.ts
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client");
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_EMAIL ?? "admin@traininglab.local";
  const password = process.env.SEED_PASSWORD ?? "changeme123";
  const name = process.env.SEED_NAME ?? "Athlete";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User ${email} already exists.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  // First user created is always admin
  const existingCount = await prisma.user.count();
  const isAdmin = existingCount === 0;
  const user = await prisma.user.create({
    data: { email, passwordHash, name, isAdmin },
  });
  if (isAdmin) console.log("  (first user — granted admin)");

  // Seed default sport categories
  const sports = [
    { name: "Running",       color: "#10B981", icon: "run",      order: 0 },
    { name: "Orienteering",  color: "#059669", icon: "compass",  order: 1 },
    { name: "Cycling",       color: "#6366F1", icon: "bike",     order: 2 },
    { name: "Nordic Skiing", color: "#38BDF8", icon: "ski",      order: 3 },
    { name: "Roller Skiing", color: "#0EA5E9", icon: "rski",     order: 4 },
    { name: "Strength",      color: "#F87171", icon: "dumbbell", order: 5 },
  ];
  for (const s of sports) {
    await prisma.sportCategory.create({ data: { ...s, userId: user.id, isDefault: true } });
  }

  console.log(`✓ Created user: ${email}`);
  console.log(`✓ Seeded ${sports.length} sport categories`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
