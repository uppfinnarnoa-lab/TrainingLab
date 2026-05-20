import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { updateHRZones } from "@/lib/fitness/cache";
import { buildHRZones } from "@/lib/fitness/zones";
import { safeDecrypt } from "@/lib/encrypt";
import { subDays } from "date-fns";
import { secPerKmToPaceStr } from "@/lib/fitness/paces";

/**
 * POST /api/coach/calibrate?mode=algorithmic|ai
 *
 * mode=algorithmic: pure math, updates zones and returns them
 * mode=ai:          same math + sends a structured prompt to the AI;
 *                   AI returns JSON zone boundaries which are applied to the cache
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") ?? "algorithmic";

  // Always run algorithmic estimation first (ground truth)
  const result = await updateHRZones(userId);
  const cache = await prisma.fitnessCache.findUnique({ where: { userId } });
  if (!cache) return NextResponse.json({ error: "calibration_failed" }, { status: 500 });

  if (mode !== "ai") {
    return NextResponse.json({
      vo2max: cache.vo2max, vdot: cache.vdot,
      maxHR: cache.maxHR, restHR: cache.restHR,
      thresholdHR: cache.thresholdHR,
      zones: cache.zones, paces: cache.paces,
      computedAt: cache.computedAt,
      aiInsights: null,
    });
  }

  // ── AI path ────────────────────────────────────────────────────────────────
  const [aiSettings, racePBs, recentHard] = await Promise.all([
    prisma.aISettings.findUnique({ where: { userId } }),
    prisma.raceRecord.findMany({
      where: { userId, date: { gte: subDays(new Date(), 5 * 365) } },
      orderBy: [{ distanceM: "asc" }, { time: "asc" }],
      select: { distance: true, time: true, date: true },
    }),
    prisma.activity.findMany({
      where: {
        userId,
        startDate: { gte: subDays(new Date(), 90) },
        averageHeartrate: { gt: Math.round(result.maxHR * 0.72) },
        sportType: { in: ["Run", "TrailRun", "VirtualRun"] },
      },
      orderBy: { startDate: "desc" },
      take: 25,
      select: { name: true, startDate: true, distance: true, movingTime: true, averageHeartrate: true, maxHeartrate: true },
    }),
  ]);

  const apiKey = aiSettings?.provider === "claude"
    ? (safeDecrypt(aiSettings.claudeApiKey) ?? process.env.ANTHROPIC_API_KEY)
    : (safeDecrypt(aiSettings?.geminiApiKey ?? null) ?? process.env.GOOGLE_AI_API_KEY);

  if (!apiKey) {
    return NextResponse.json({
      vo2max: cache.vo2max, vdot: cache.vdot,
      maxHR: cache.maxHR, restHR: cache.restHR,
      thresholdHR: cache.thresholdHR,
      zones: cache.zones, paces: cache.paces,
      computedAt: cache.computedAt,
      aiInsights: "Ingen API-nyckel konfigurerad — algoritmisk estimering användes.",
    });
  }

  // Build the best 3 PBs summary
  type PBRow = { distance: string; time: number; date: Date };
  const pbLines = (racePBs as PBRow[]).slice(0, 6).map(r => {
    const mm = Math.floor(r.time / 60), ss = r.time % 60;
    return `  ${r.distance}: ${mm}:${String(ss).padStart(2, "0")} (${new Date(r.date).getFullYear()})`;
  }).join("\n");

  const hardLines = (recentHard as { name: string; startDate: Date; distance: number; movingTime: number; averageHeartrate: number | null; maxHeartrate: number | null }[])
    .map(a => {
      const pace = a.movingTime && a.distance ? secPerKmToPaceStr(a.movingTime / (a.distance / 1000)) : "?";
      return `  ${new Date(a.startDate).toISOString().slice(0, 10)}: ${a.name} — ${(a.distance / 1000).toFixed(1)}km @ ${pace}, avgHR ${a.averageHeartrate ?? "?"}bpm, maxHR ${a.maxHeartrate ?? "?"}bpm`;
    }).join("\n");

  const algoZones = cache.zones as Record<string, [number, number]>;

  const prompt = `Du är en fysiolog som estimerar träningshjärtfrekvenszoner för en uthållighetsidrottare.

Tillgänglig data:
- Tävlings-PBs (bästa tider, senaste 5 åren):
${pbLines || "  Inga PBs registrerade"}

- Uppmätt max HR: ${result.maxHR} bpm (från tävlingsaktiviteter)
- Vilopuls: ${result.restHR} bpm
- VO2max estimat: ${cache.vo2max.toFixed(1)} ml/kg/min (VDOT ${cache.vdot.toFixed(1)})

- Senaste 90 dagars hårda pass (>72% maxHR):
${hardLines || "  Inga hårda pass registrerade"}

Algoritmens förslag (baserat på LT1=78% och LT2=88% av maxHR):
  Z1: ${algoZones.z1?.[0]}–${algoZones.z1?.[1]} bpm
  Z2: ${algoZones.z2?.[0]}–${algoZones.z2?.[1]} bpm
  Z3: ${algoZones.z3?.[0]}–${algoZones.z3?.[1]} bpm
  Z4: ${algoZones.z4?.[0]}–${algoZones.z4?.[1]} bpm
  Z5: ${algoZones.z5?.[0]}–${algoZones.z5?.[1]} bpm

Baserat på tävlingstiderna (HM-tempo ≈ LT2-tempo, 10K-tempo ≈ LT2+5%), observerade HR-värden i hårda pass, och maxpuls:
1. Estimera LT1 (aerob tröskel, ~2 mmol/L laktat)
2. Estimera LT2 (anaerob tröskel, ~4 mmol/L laktat, ≈ halvmarathontempo)
3. Beräkna 5 zoner med olikbreda gränser förankrade i LT1/LT2

Beräkna konkreta HR-värden och returnera ENBART giltig JSON (inga kommentarer, inga förklaringar utanför JSON).
Zonerna ska byggas som: z1=[restHR, lt1-8], z2=[lt1-8, lt1], z3=[lt1, lt2], z4=[lt2, lt2+7], z5=[lt2+7, maxHR].
Alla värden ska vara heltal.

Exempel på korrekt format (ersätt med dina beräknade värden):
{"max_hr":190,"lt1_hr":152,"lt2_hr":167,"zones":{"z1":[47,144],"z2":[144,152],"z3":[152,167],"z4":[167,174],"z5":[174,190]},"reasoning":"LT2 estimerades från 10K-PBn..."}

Din JSON med rätt värden:`;

  let aiJson: { max_hr: number; lt1_hr: number; lt2_hr: number; zones: Record<string, [number, number]>; reasoning: string } | null = null;
  let aiInsights = "";

  try {
    let rawText = "";

    if (aiSettings?.provider === "claude") {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });
      const res = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      });
      rawText = res.content[0].type === "text" ? res.content[0].text : "";
    } else {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const res = await model.generateContent(prompt);
      rawText = res.response.text();
    }

    // Extract JSON from response (AI may wrap in markdown fences)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Validate: all zone boundaries must be ascending integers in physiological range
      const z = parsed.zones;
      const valid = parsed.lt1_hr > 100 && parsed.lt1_hr < 200
        && parsed.lt2_hr > parsed.lt1_hr && parsed.lt2_hr < parsed.max_hr
        && parsed.max_hr > 150 && parsed.max_hr <= 220
        && z.z1 && z.z2 && z.z3 && z.z4 && z.z5
        && z.z1[0] < z.z1[1] && z.z2[0] < z.z2[1]
        && z.z3[0] < z.z3[1] && z.z4[0] < z.z4[1] && z.z5[0] < z.z5[1];

      if (valid) {
        aiJson = parsed;
        aiInsights = parsed.reasoning ?? "";

        // Apply AI zones to cache
        const thresholdHR = Math.round((z.z4[0] + z.z4[1]) / 2);
        await prisma.fitnessCache.update({
          where: { userId },
          data: {
            maxHR: parsed.max_hr,
            thresholdHR,
            zones: z,
          },
        });
        await prisma.athleteProfile.upsert({
          where: { userId },
          create: { userId, maxHeartRate: parsed.max_hr },
          update: { maxHeartRate: parsed.max_hr },
        });
      } else {
        aiInsights = "AI returnerade ogiltiga zonvärden — algoritmiska zoner behålls.";
      }
    } else {
      aiInsights = "AI-svar kunde inte parsas — algoritmiska zoner behålls.";
    }
  } catch (e) {
    console.error("[calibrate/ai] failed:", e);
    aiInsights = "AI-estimering misslyckades — algoritmiska zoner behålls.";
  }

  const finalCache = await prisma.fitnessCache.findUnique({ where: { userId } });

  // Build zone display for response
  const finalZones = aiJson?.zones ?? algoZones;
  const hrZones = buildHRZones(finalCache?.maxHR ?? result.maxHR, result.restHR);

  return NextResponse.json({
    vo2max: finalCache?.vo2max ?? cache.vo2max,
    vdot: finalCache?.vdot ?? cache.vdot,
    maxHR: finalCache?.maxHR ?? cache.maxHR,
    restHR: result.restHR,
    thresholdHR: finalCache?.thresholdHR ?? cache.thresholdHR,
    zones: finalZones,
    paces: finalCache?.paces ?? cache.paces,
    computedAt: finalCache?.computedAt ?? cache.computedAt,
    hrZones: { z1: hrZones.z1, z2: hrZones.z2, z3: hrZones.z3, z4: hrZones.z4, z5: hrZones.z5 },
    aiInsights,
    aiApplied: aiJson !== null,
  });
}
