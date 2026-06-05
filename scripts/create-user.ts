/**
 * Create a new user account in the database.
 * Usage: npx tsx scripts/create-user.ts <email> <password> [name]
 * Example: npx tsx scripts/create-user.ts friend@example.com mypassword123 "Erik"
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const [, , email, password, name] = process.argv;

  if (!email || !password) {
    console.error("Usage: npx tsx scripts/create-user.ts <email> <password> [name]");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error(`User with email ${email} already exists (id: ${existing.id}).`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, name: name ?? null },
  });

  console.log(`✓ User created: ${user.email} (id: ${user.id})`);
  console.log(`  They can now log in at /login and connect Strava in Settings.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
