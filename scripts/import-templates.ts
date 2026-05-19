export {};
/**
 * 1. Imports standard workout templates from the Nyckelpass section of the training plan CSV.
 * 2. Updates existing planned workout colors based on intensity/race status.
 *
 * Usage: SEED_EMAIL=you@email.com npx tsx scripts/import-templates.ts
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Color scheme (user-specified)
const COLORS = {
  easy:    null,        // default sport color
  moderate:"#FBBF24",  // yellow-amber (moderate intensity)
  quality: "#818CF8",  // purple/indigo (high intensity)
  race:    "#FBBF24",  // yellow (races/competitions)
};

const TEMPLATES = [
  // name, sportKey, intensity, durationMin (avg), distanceKm (avg), description
  ["Easy run",              "run",   "easy",    52,  9.5,  "Utfyllnad och för att bygga volym. Läggs in emellan alla priopass i planen. Chill pace."],
  ["Easy run prep.",        "run",   "easy",    30,  6.0,  "För att hålla igång benen mellan dagar med högintensiva pass och tävlingar. Kan addera 3-6×1min strides."],
  ["Distans",               "run",   "easy",    97,  17.0, "Lugnt snackpass för att bygga volym och distansvana. Kan köras med gel."],
  ["Styrka",                "str",   "easy",    75,  0,    "Fokus på maxstyrka med tunga vikter på skivstång. Alltid fokus på knä och ledstabilitet."],
  ["Fartlek/segmentjakt",   "run",   "moderate",45,  8.0,  "Roligare pass med fart. Valfria distanser och tempon efter känsla. ~5-15 min aktiv tid."],
  ["OL teknik",             "ol",    "moderate",52,  7.5,  "Tränar OL-teknik och fokus in action. Körs i flytfart. Kan också köras socialt som easy run."],
  ["Fartlek skog a la pappa","ol",   "moderate",60,  9.0,  "Fartlek i skogen med lägre tempon och längre ökningar. 30-60 min tempozon, eller 5×3/3 on-off."],
  ["Mosse tröskel",         "ol",    "moderate",52,  7.0,  "Tröskel i mosse för att få högre puls vid lägre tempo. ~20-30 min aktivt på en 5-15 min slinga."],
  ["Fartlek 5k prio",       "run",   "quality", 42,  7.0,  "Träna på att racea 3-10k med jämna splits. 3000m @90% eller 4-5×800-1000m/1' @95% av 5k-pace."],
  ["Tempo",                 "run",   "quality", 50,  9.5,  "Lågtröskel. Längre distans ~10-20s under tröskeltempot. Exv 5km @tröskel+10. Kan köras stegrande."],
  ["Lång tröskel",          "run",   "quality", 57,  9.0,  "Längre intervaller i tröskeltempo för aerobisk bas. 2-3×10'/2' eller 3-4×1750m/2'."],
  ["Fartlek för 5k",        "run",   "quality", 42,  9.0,  "6-8×3'/45-60s hög intensitet. Bygger mjölksyrauthållighet och förmåga att hålla högt tempo."],
  ["4x4",                   "run",   "quality", 42,  9.0,  "4-5×4'/1'-2'. VO2max-intervaller @90%. Kan substitueras mot 1000m-intervaller. Bygger VO2max och aerobisk bas."],
  ["Korta intervaller",     "run",   "quality", 42,  7.5,  "3-4×2'/1'+6-8×1'/30s. Formtoppningsintervaller för fart och maxfart. Kan addera 30/30 efteråt."],
  ["Mosse korta intervaller","ol",   "quality", 45,  6.0,  "Mjölksyraintervaller i mosse. Hög laktathalt vid låg hastighet. 2×10×30/60."],
  ["Tabata",                "run",   "quality", 12,  2.5,  "Adderas till andra pass i slutet. Bygger överfart och VO2max. 5-20×20s/20s."],
] as const;

async function main() {
  const email = process.env.SEED_EMAIL ?? "admin@traininglab.local";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { console.error(`User ${email} not found.`); process.exit(1); }

  // ── Fetch sport categories ─────────────────────────────────────────
  const sports: { id: string; name: string }[] = await prisma.sportCategory.findMany({ where: { userId: user.id } });
  const sportId = (key: string): string | null => {
    const map: Record<string, string> = {
      run: sports.find((s: { name: string }) => s.name === "Running")?.id ?? "",
      ol:  sports.find((s: { name: string }) => s.name === "Orienteering")?.id ?? "",
      str: sports.find((s: { name: string }) => s.name === "Strength")?.id ?? "",
    };
    return map[key] ?? null;
  };

  // ── Import templates ──────────────────────────────────────────────
  let created = 0, skipped = 0;
  for (const [name, sportKey, intensity, durationMin, distanceKm, description] of TEMPLATES) {
    const existing = await prisma.workoutTemplate.findFirst({
      where: { userId: user.id, name },
    });
    if (existing) { skipped++; continue; }

    const sId = sportId(sportKey);
    if (!sId) { console.warn(`Sport not found for key: ${sportKey}`); skipped++; continue; }

    const color = COLORS[intensity as keyof typeof COLORS];

    await prisma.workoutTemplate.create({
      data: {
        userId: user.id,
        name,
        description,
        sportId: sId,
        color,
        estimatedDuration: durationMin * 60,
        estimatedDistance: distanceKm > 0 ? distanceKm * 1000 : null,
        sections: {
          create: [
            {
              order: 0,
              name: "Main session",
              durationType: "time",
              duration: durationMin * 60,
              zoneType: intensity === "easy" ? "hr_zone" : intensity === "moderate" ? "hr_zone" : "pace_zone",
              targetZone: intensity === "easy" ? 2 : intensity === "moderate" ? 3 : 4,
              notes: description,
            },
          ],
        },
      },
    });
    created++;
  }
  console.log(`✓ Templates: ${created} created, ${skipped} already existed`);

  // ── Fix planned workout colors ─────────────────────────────────────
  const updates = await prisma.$transaction([
    // Easy → null (no color override, use sport default)
    prisma.plannedWorkout.updateMany({
      where: { userId: user.id, targetIntensity: "easy" },
      data: { color: null },
    }),
    // Moderate → yellow-amber
    prisma.plannedWorkout.updateMany({
      where: { userId: user.id, targetIntensity: "moderate" },
      data: { color: "#FBBF24" },
    }),
    // Quality/high → purple
    prisma.plannedWorkout.updateMany({
      where: { userId: user.id, targetIntensity: "quality" },
      data: { color: "#818CF8" },
    }),
    // Races → yellow (already used same yellow but distinguish with status)
    prisma.plannedWorkout.updateMany({
      where: { userId: user.id, name: { contains: "tävling", mode: "insensitive" } },
      data: { color: "#FBBF24" },
    }),
  ]);
  const totalUpdated = updates.reduce((s: number, r: { count: number }) => s + r.count, 0);
  console.log(`✓ Updated ${totalUpdated} planned workout colors`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
