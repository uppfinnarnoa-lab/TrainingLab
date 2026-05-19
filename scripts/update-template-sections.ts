export {};
/**
 * Replaces the single-section placeholder in each template with proper
 * structured sections derived from the CSV Nyckelpass descriptions.
 * Run: SEED_EMAIL=uppfinnarnoa@gmail.com npx tsx scripts/update-template-sections.ts
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

type Section = {
  order: number;
  name: string;
  durationType: "time" | "distance" | "open";
  duration?: number;       // seconds
  distance?: number;       // meters
  repetitions?: number;
  zoneType?: string;
  targetZone?: number;
  notes?: string;
};

// z = zone 1-5, d = duration in seconds, dist = meters, reps = repetitions
const sec = (order: number, name: string, z: number, d: number, reps?: number, dist?: number, notes?: string): Section => ({
  order, name, durationType: dist ? "distance" : "time",
  duration: dist ? undefined : d, distance: dist,
  repetitions: reps ?? undefined, zoneType: "hr_zone", targetZone: z, notes,
});
const open = (order: number, name: string, notes: string): Section => ({
  order, name, durationType: "open", zoneType: undefined, notes,
});

// Template name → sections
const SECTIONS: Record<string, Section[]> = {
  "Easy run": [
    sec(0, "Värm-upp",  1, 10*60),
    sec(1, "Easy run",  2, 35*60, undefined, undefined, "Chill pace, konversationstempo. Utfyllnad och volym."),
    sec(2, "Nedvarvning", 1, 5*60),
  ],
  "Easy run prep.": [
    sec(0, "Easy run",  1, 25*60, undefined, undefined, "Håller igång benen. Kan addera 3-6×1min strides på slutet."),
  ],
  "Distans": [
    sec(0, "Lång easy run", 2, 97*60, undefined, undefined, "Lugnt snackpass för volym och distansvana. Kan köras med gel."),
  ],
  "Styrka": [
    open(0, "Uppvärmning", "Dynamisk rörlighet och aktivering."),
    open(1, "Maxstyrka", "Tunga vikter på skivstång — knäböj, marklyft, bänkpress. Fokus på knäledsstabilitet."),
    open(2, "Accessoirer", "Knästabilitet, ledstabilitet, små muskler."),
  ],
  "Fartlek/segmentjakt": [
    sec(0, "Värm-upp",  1, 15*60),
    sec(1, "Fartlek",   3, 20*60, undefined, undefined, "Valfria distanser och tempon efter känsla. ~5-15 min aktiv tid."),
    sec(2, "Nedvarvning", 1, 10*60),
  ],
  "OL teknik": [
    sec(0, "Uppvärmning + karta", 2, 10*60),
    sec(1, "OL teknikpass",       3, 40*60, undefined, undefined, "Flytfart med fullt fokus på kartan. Kan köras socialt som easy run."),
    sec(2, "Nedvarvning",         1, 10*60),
  ],
  "Fartlek skog a la pappa": [
    sec(0, "Värm-upp",    1, 15*60),
    sec(1, "Skogsintervaller", 3, 45*60, undefined, undefined, "Lägre tempon och längre ökningar. Kan vara 30-60 min tempozon eller 5×3'/3' on-off."),
    sec(2, "Nedvarvning", 1, 10*60),
  ],
  "Mosse tröskel": [
    sec(0, "Värm-upp",       1, 10*60),
    sec(1, "Mosse tröskel",  4, 6*60,  4, undefined, "En slinga 5-15min lång i mosse. ~20-30 min aktivt totalt."),
    sec(2, "Vila mellan set", 1, 2*60),
    sec(3, "Nedvarvning",    1, 10*60),
  ],
  "Fartlek 5k prio": [
    sec(0, "Värm-upp",         1, 15*60),
    sec(1, "5k-intervaller",   5, 3*60,  5, 1000, "4-5×800-1000m/1' @95% 5k-pace. Jämna och pålitliga splits."),
    sec(2, "Återhämtning",     1, 1*60),
    sec(3, "Nedvarvning",      1, 10*60),
  ],
  "Tempo": [
    sec(0, "Värm-upp",       1, 15*60),
    sec(1, "Tempolöpning",   4, 25*60, undefined, undefined, "Löptempo ~10-20s under tröskel. Ex 5km @tröskel+10. Kan köras stegrande."),
    sec(2, "Nedvarvning",    1, 10*60),
  ],
  "Lång tröskel": [
    sec(0, "Värm-upp",        1, 15*60),
    sec(1, "Tröskelintervall",4, 10*60, 3, undefined, "2-3×10'/2' eller 3-4×1750m/2'. Bygger aerobisk bas."),
    sec(2, "Återhämtning",    1, 2*60),
    sec(3, "Nedvarvning",     1, 10*60),
  ],
  "Fartlek för 5k": [
    sec(0, "Värm-upp",     1, 15*60),
    sec(1, "6-8×3'/45-60s",5, 3*60,  7, undefined, "Hög intensitet, mjölksyrauthållighet. 45-60s aktiv återhämtning."),
    sec(2, "Återhämtning", 1, 1*60),
    sec(3, "Nedvarvning",  1, 10*60),
  ],
  "4x4": [
    sec(0, "Värm-upp",      1, 15*60),
    sec(1, "4-5×4'/1'-2'",  4, 4*60,  4, undefined, "VO2max-intervaller @90%. Kan substitueras mot 1000m-intervaller."),
    sec(2, "Återhämtning",  1, 90,    ),
    sec(3, "Nedvarvning",   1, 10*60),
  ],
  "Korta intervaller": [
    sec(0, "Värm-upp",      1, 15*60),
    sec(1, "Set 1: 3-4×2'", 5, 2*60,  4, undefined, "3-4×2'/1' — formtoppningsintervaller."),
    sec(2, "Återhämtning",  1, 1*60),
    sec(3, "Set 2: 6-8×1'", 5, 60,    7, undefined, "6-8×1'/30s — maxfart och överfart."),
    sec(4, "Återhämtning",  1, 30),
    sec(5, "Nedvarvning",   1, 10*60),
  ],
  "Mosse korta intervaller": [
    sec(0, "Värm-upp",          1, 15*60),
    sec(1, "10×30/60 set 1",    5, 30,    10, undefined, "2×10×30/60 — mjölksyraintervaller i mosse. Hög laktathalt vid låg hastighet."),
    sec(2, "Vila mellan set",   1, 3*60),
    sec(3, "10×30/60 set 2",    5, 30,    10, undefined, "Andra setet. Kroppen är nu mer belastad — fokus på teknik."),
    sec(4, "Nedvarvning",       1, 10*60),
  ],
  "Tabata": [
    sec(0, "Värm-upp",    1, 5*60),
    sec(1, "Tabata",      5, 20,    12, undefined, "5-20×20s/20s. Maximalt ansträngning varje rep. Adderas gärna efter annat pass."),
    sec(2, "Nedvarvning", 1, 5*60),
  ],
};

async function main() {
  const email = process.env.SEED_EMAIL ?? "admin@traininglab.local";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { console.error(`User ${email} not found.`); process.exit(1); }

  const templates = await prisma.workoutTemplate.findMany({
    where: { userId: user.id },
    include: { sections: true },
  });

  let updated = 0;
  for (const tmpl of templates) {
    const newSections = SECTIONS[tmpl.name];
    if (!newSections) {
      console.log(`  (no sections definition for "${tmpl.name}" — skipping)`);
      continue;
    }

    // Delete old sections
    await prisma.workoutSection.deleteMany({ where: { templateId: tmpl.id } });

    // Create new sections
    await prisma.workoutSection.createMany({
      data: newSections.map(s => ({
        templateId: tmpl.id,
        order:        s.order,
        name:         s.name,
        durationType: s.durationType,
        duration:     s.duration ?? null,
        distance:     s.distance ?? null,
        repetitions:  s.repetitions ?? null,
        zoneType:     s.zoneType ?? null,
        targetZone:   s.targetZone ?? null,
        notes:        s.notes ?? null,
      })),
    });

    // Update estimated duration (sum of all timed sections × reps)
    const totalSec = newSections.reduce((sum, s) => {
      const reps = s.repetitions ?? 1;
      return sum + (s.duration ? s.duration * reps : 0);
    }, 0);

    await prisma.workoutTemplate.update({
      where: { id: tmpl.id },
      data: { estimatedDuration: totalSec > 0 ? totalSec : null },
    });

    updated++;
    console.log(`  ✓ ${tmpl.name}: ${newSections.length} sections`);
  }
  console.log(`\n✓ Updated ${updated} templates`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
