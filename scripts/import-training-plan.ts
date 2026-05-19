/**
 * Import training plan from CSV file into the database.
 * Usage: SEED_EMAIL=you@email.com npx tsx scripts/import-training-plan.ts
 *
 * CSV format: Swedish training plan with weeks (VECKA XX), Mon-Sun sessions,
 * intensity (låg/med/hög/Race), duration (min), and km per day.
 */
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────────

function isoWeekMonday(weekNum: number, year: number): Date {
  // Jan 4 is always in week 1 (ISO 8601)
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // 1=Mon
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - (dayOfWeek - 1));
  const result = new Date(week1Monday);
  result.setDate(week1Monday.getDate() + (weekNum - 1) * 7);
  return result;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Map Swedish workout names → sport type
function mapSport(name: string): string {
  const n = name.toLowerCase();
  if (/gym|styrka|crossfit|vikt/.test(n)) return "Strength";
  if (/skidor|klassisk|skate|stak|längdskid|ski/.test(n)) return "NordicSki";
  if (/rullisar|rullskidor|rskidor/.test(n)) return "RollerSki";
  if (/cykel|mtb|bike/.test(n)) return "Ride";
  if (/ol|orientering|tisdagsbana|bana/.test(n)) return "Orienteering";
  if (/sim|pool|vatten/.test(n)) return "Swim";
  return "Run";
}

// Map intensity → target intensity label
function mapIntensity(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (s === "hög" || s === "race" || s === "tävling") return "quality";
  if (s === "med") return "moderate";
  return "easy";
}

// Determine year for week number (weeks 43+ = 2025, weeks 1-42 = 2026 in this plan)
function resolveYear(weekNum: number, seenHighWeek: boolean): number {
  // Plan starts at week 43 (2025). After week 52, we roll to 2026.
  return (weekNum >= 43 && !seenHighWeek) ? 2025 : 2026;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const email = process.env.SEED_EMAIL ?? "admin@claudetrainer.local";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User ${email} not found. Run seed-user.ts first.`);
    process.exit(1);
  }

  const csvPath = path.join(process.cwd(), "Träningsplan - Träning 26.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("CSV file not found:", csvPath);
    process.exit(1);
  }

  // Parse CSV lines
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));

  // ── Parse week blocks ─────────────────────────────────────────────────
  interface WeekBlock {
    weekNum: number;
    pass: string[];      // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
    intensity: string[];
    duration: number[];  // minutes
    km: number[];
    info: string[];
  }

  const weeks: WeekBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const row = lines[i];
    const veckaCell = row[1] ?? "";

    if (veckaCell.startsWith("VECKA ")) {
      const weekNum = parseInt(veckaCell.replace("VECKA ", ""));
      if (isNaN(weekNum)) { i++; continue; }

      // Collect rows until next VECKA or EOF
      const block: string[][] = [];
      let j = i + 1;
      while (j < lines.length && !(lines[j][1] ?? "").startsWith("VECKA ")) {
        block.push(lines[j]);
        j++;
      }

      // Find rows by label
      const find = (label: string) => block.find(r => r[1]?.toLowerCase() === label.toLowerCase());
      const passRow = find("Pass");
      const intensRow = find("Intensitet");
      const tidRow = find("Tid");
      const kmRow = find("KM");
      const infoRow = find("Info");

      if (passRow) {
        weeks.push({
          weekNum,
          pass:      [2,3,4,5,6,7,8].map(ci => passRow[ci] ?? ""),
          intensity: [2,3,4,5,6,7,8].map(ci => intensRow?.[ci] ?? ""),
          duration:  [2,3,4,5,6,7,8].map(ci => { const v = parseFloat((tidRow?.[ci] ?? "").replace(",",".")); return isNaN(v) ? 0 : Math.round(v * 60); }),
          km:        [2,3,4,5,6,7,8].map(ci => { const v = parseFloat((kmRow?.[ci] ?? "").replace(",",".")); return isNaN(v) ? 0 : v; }),
          info:      [2,3,4,5,6,7,8].map(ci => infoRow?.[ci] ?? ""),
        });
      }

      i = j;
    } else {
      i++;
    }
  }

  console.log(`Parsed ${weeks.length} weeks from CSV`);

  // ── Get default sport category (Running) ──────────────────────────────
  const sports: { id: string; name: string }[] = await prisma.sportCategory.findMany({ where: { userId: user.id } });
  const sportMap: Record<string, string | null> = {};
  for (const s of sports) {
    sportMap[s.name.toLowerCase()] = s.id;
  }
  sportMap["run"] = sports.find((x: { name: string }) => x.name === "Running")?.id ?? null;
  sportMap["ride"] = sports.find((x: { name: string }) => x.name === "Cycling")?.id ?? null;
  sportMap["nordicski"] = sports.find((x: { name: string }) => x.name === "Nordic Skiing")?.id ?? null;
  sportMap["rollerski"] = sports.find((x: { name: string }) => x.name === "Roller Skiing")?.id ?? null;
  sportMap["strength"] = sports.find((x: { name: string }) => x.name === "Strength")?.id ?? null;
  sportMap["orienteering"] = sports.find((x: { name: string }) => x.name === "Orienteering")?.id ?? null;

  // ── Create planned workouts ───────────────────────────────────────────
  const DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  let created = 0;
  let skipped = 0;
  let crossedWeek52 = false; // true once week 52 has been processed → subsequent weeks are in 2026

  for (const wk of weeks) {
    const year = (wk.weekNum >= 43 && !crossedWeek52) ? 2025 : 2026;
    if (wk.weekNum === 52) crossedWeek52 = true; // set AFTER using, so week 52 itself is 2025
    const monday = isoWeekMonday(wk.weekNum, year);

    for (let d = 0; d < 7; d++) {
      const rawName = wk.pass[d];
      if (!rawName || rawName === "" || rawName === "0") { skipped++; continue; }

      const date = addDays(monday, d);
      const dateStr = toDateStr(date);
      const sportType = mapSport(rawName);
      const intensity = mapIntensity(wk.intensity[d]);
      const durationSec = wk.duration[d] > 0 ? wk.duration[d] : null;
      const km = wk.km[d] > 0 ? wk.km[d] : null;
      const notes = wk.info[d] || null;

      const isRace = /race|tävling|lopp|mila|sprint.*sl|sic|2dagars|milen|stafett/i.test(rawName)
        || wk.intensity[d].toLowerCase() === "race";

      // Skip if already exists
      const existing = await prisma.plannedWorkout.findFirst({
        where: { userId: user.id, date: new Date(dateStr), name: rawName },
      });
      if (existing) { skipped++; continue; }

      await prisma.plannedWorkout.create({
        data: {
          userId: user.id,
          date: new Date(dateStr),
          name: rawName,
          sportType,
          notes,
          targetDistance: km ? km * 1000 : null,
          targetDuration: durationSec,
          targetIntensity: intensity,
          status: new Date(dateStr) < new Date() ? "planned" : "planned",
          color: isRace ? "#EF4444" : null,
        },
      });
      created++;
    }
  }

  console.log(`✓ Created ${created} planned workouts (${skipped} skipped / empty)`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
