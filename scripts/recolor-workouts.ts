export {};
/**
 * Re-applies the new color scheme to all existing templates and planned workouts.
 * Run once: SEED_EMAIL=you@email.com npx tsx scripts/recolor-workouts.ts
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function workoutColor(sportName: string, typeName?: string | null): string {
  const s = sportName.toLowerCase();
  const t = (typeName ?? "").toLowerCase();
  if (/cycl|ride|cykel|bike/.test(s)) return "#FB923C";
  if (/orienteer|ol\b/.test(s))        return "#2DD4BF";
  if (/strength|styrka|gym|weight/.test(s)) return "#F97316";
  if (/nordicski|klassisk|backcountry/.test(s)) return "#BAE6FD";
  if (/rollerski|rullski/.test(s))     return "#38BDF8";
  if (/swim|sim/.test(s))              return "#60A5FA";
  if (/run|trail|virtual/.test(s)) {
    if (/tävl|race|lopp|mila|stafett|sic\b|sprint/.test(t)) return "#FBBF24";
    if (/tröskel|threshold|tempo|lång tröskel|lt\b/.test(t)) return "#F472B6";
    if (/intervall|interval|4x4|fartlek|tabata|korta|mosse/.test(t)) return "#818CF8";
    return "#7DD3FC";
  }
  return "#7DD3FC";
}

async function main() {
  const email = process.env.SEED_EMAIL ?? "admin@traininglab.local";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { console.error(`User ${email} not found.`); process.exit(1); }

  // ── Recolor templates ──────────────────────────────────────────────
  const templates = await prisma.workoutTemplate.findMany({
    where: { userId: user.id },
    include: { sport: true, type: true },
  });

  let tUpdated = 0;
  for (const tmpl of templates) {
    const color = workoutColor(tmpl.sport.name, tmpl.type?.name ?? null);
    await prisma.workoutTemplate.update({ where: { id: tmpl.id }, data: { color } });
    tUpdated++;
  }
  console.log(`✓ Recolored ${tUpdated} templates`);

  // ── Recolor planned workouts ───────────────────────────────────────
  // For workouts with a linked template, derive color from template sport+type
  const withTemplate = await prisma.plannedWorkout.findMany({
    where: { userId: user.id, templateId: { not: null } },
    include: { template: { include: { sport: true, type: true } } },
  });

  let wUpdated = 0;
  for (const w of withTemplate) {
    if (!w.template) continue;
    const color = workoutColor(w.template.sport.name, w.template.type?.name ?? null);
    await prisma.plannedWorkout.update({ where: { id: w.id }, data: { color } });
    wUpdated++;
  }

  // For workouts without template, use sportType + targetIntensity as proxy
  const noTemplate = await prisma.plannedWorkout.findMany({
    where: { userId: user.id, templateId: null },
  });

  for (const w of noTemplate) {
    // Map targetIntensity → type proxy
    const typeProxy = w.targetIntensity === "quality" ? "intervall" :
                      w.targetIntensity === "moderate" ? "tempo" : "easy";
    // Detect race by name keywords
    const isRace = /tävl|race|lopp|mila|stafett|sic\b|sprint/i.test(w.name);
    const typeName = isRace ? "tävling" : typeProxy;
    const color = workoutColor(w.sportType, typeName);
    await prisma.plannedWorkout.update({ where: { id: w.id }, data: { color } });
    wUpdated++;
  }

  console.log(`✓ Recolored ${wUpdated} planned workouts`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
