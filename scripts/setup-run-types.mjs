/**
 * Creates the 5 canonical running workout types and assigns them
 * to existing templates and planned workouts based on name keywords.
 * Run: node scripts/setup-run-types.mjs
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const USER_ID = "cmpcfsjn80000ru2wao5zjl4j";

// ── 1. Find running sport category ────────────────────────────────────────
const sports = await p.sportCategory.findMany({ where: { userId: USER_ID }, include: { workoutTypes: true } });
const runSport = sports.find(s => /run/i.test(s.name));
if (!runSport) { console.error("No running sport found"); process.exit(1); }
console.log(`Running sport: ${runSport.name} (${runSport.id})`);

// ── 2. Create the 5 canonical types if they don't exist ───────────────────
const TYPE_DEFS = [
  { name: "Easy run",  color: "#7DD3FC", order: 0 },
  { name: "Tempo",     color: "#2DD4BF", order: 1 },
  { name: "LT",        color: "#F472B6", order: 2 },
  { name: "AT",        color: "#818CF8", order: 3 },
  { name: "Speedwork", color: "#3B82F6", order: 4 },
];

const existingTypes = runSport.workoutTypes;
const typeMap = new Map(); // name → id

for (const def of TYPE_DEFS) {
  let existing = existingTypes.find(t => t.name === def.name);
  if (!existing) {
    existing = await p.workoutType.create({
      data: { userId: USER_ID, sportId: runSport.id, name: def.name, color: def.color, order: def.order },
    });
    console.log(`Created type: ${def.name}`);
  } else {
    console.log(`Existing type: ${def.name}`);
  }
  typeMap.set(def.name, existing.id);
}

// ── 3. Keyword matching ────────────────────────────────────────────────────
function inferType(name) {
  const n = (name ?? "").toLowerCase();
  if (/speed|speedwork|intervall|interval|fartlek|tisdagsbana|\dx\d|\d+x\d|5×|4×|3×|mosse|kortintervall/i.test(n)) return "Speedwork";
  if (/\bat\b|aerob tröskel|aerobic threshold/i.test(n)) return "AT";
  if (/\blt\b|tröskel|threshold|lång tröskel|lactate/i.test(n)) return "LT";
  if (/\btempo\b/i.test(n)) return "Tempo";
  if (/easy|lätt|distans|long|lång|recover|lugn|aerob/i.test(n)) return "Easy run";
  // Default for running workouts with no match
  return null;
}

// ── 4. Assign types to templates ──────────────────────────────────────────
const templates = await p.workoutTemplate.findMany({
  where: { userId: USER_ID, typeId: null },
  include: { sport: true },
});

let tmplUpdated = 0;
for (const t of templates) {
  if (!/run|trail/i.test(t.sport.name)) continue;
  const typeName = inferType(t.name);
  if (!typeName) continue;
  await p.workoutTemplate.update({ where: { id: t.id }, data: { typeId: typeMap.get(typeName) } });
  console.log(`Template "${t.name}" → ${typeName}`);
  tmplUpdated++;
}
console.log(`\nUpdated ${tmplUpdated}/${templates.filter(t => /run|trail/i.test(t.sport.name)).length} running templates`);

// ── 5. Assign types to planned workouts (those with template get type from template) ───
// For workouts without a template, infer from workout name
const workouts = await p.plannedWorkout.findMany({
  where: { userId: USER_ID },
  include: { template: { include: { type: true } } },
});

let wUpdated = 0;
for (const w of workouts) {
  if (!/run|trail/i.test(w.sportType)) continue;

  // If workout has a template with a type, copy the type to the workout's color
  // (workouts don't have typeId — color is derived at render time from template.type)

  // For workouts without template, if name matches a type, update the color field
  if (!w.templateId) {
    const typeName = inferType(w.name);
    if (typeName) {
      const colors = { "Easy run": "#7DD3FC", "Tempo": "#2DD4BF", "LT": "#F472B6", "AT": "#818CF8", "Speedwork": "#3B82F6" };
      await p.plannedWorkout.update({ where: { id: w.id }, data: { color: colors[typeName] } });
      wUpdated++;
    }
  }
}
console.log(`Updated colors for ${wUpdated} standalone planned workouts`);

console.log("\nDone! Types created and assigned.");
await p.$disconnect();
