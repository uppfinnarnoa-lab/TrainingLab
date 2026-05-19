import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { computeAndCacheFitness } from "@/lib/fitness/cache";
import { safeDecrypt } from "@/lib/encrypt";
import { subDays } from "date-fns";

/**
 * POST /api/coach/calibrate
 * Recomputes HR zones, VO2max, and paces from broad training data.
 * Returns the new estimates for the user to review before saving.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = session.user.id;

  // Recompute fitness cache from scratch
  const result = await computeAndCacheFitness(userId);
  const cache = await prisma.fitnessCache.findUnique({ where: { userId } });

  if (!cache) return NextResponse.json({ error: "calibration_failed" }, { status: 500 });

  // Optionally ask AI for a second opinion on zones (if API key configured)
  const aiSettings = await prisma.aISettings.findUnique({ where: { userId } });
  let aiInsights: string | null = null;

  if (aiSettings) {
    const apiKey = aiSettings.provider === "claude"
      ? (safeDecrypt(aiSettings.claudeApiKey) ?? process.env.ANTHROPIC_API_KEY)
      : (safeDecrypt(aiSettings.geminiApiKey) ?? process.env.GOOGLE_AI_API_KEY);

    if (apiKey) {
      // Fetch recent training data for AI analysis
      const recentActivities = await prisma.activity.findMany({
        where: { userId, startDate: { gte: subDays(new Date(), 90) } },
        orderBy: { startDate: "desc" },
        take: 30,
        select: {
          name: true, sportType: true, startDate: true,
          distance: true, movingTime: true,
          averageHeartrate: true, maxHeartrate: true, isRace: true,
        },
      });

      type RecentA = { name: string; sportType: string; startDate: Date; distance: number; movingTime: number; averageHeartrate: number | null; maxHeartrate: number | null; isRace: boolean };
      const activitySummary = (recentActivities as RecentA[]).map(a => {
        const pace = a.averageHeartrate && a.distance && a.movingTime
          ? `${Math.round(a.movingTime / (a.distance / 1000))}s/km` : "";
        return `${a.name}: ${a.sportType}, ${Math.round(a.distance / 1000)}km, ${a.averageHeartrate ?? "?"}bpm avg${a.isRace ? " [RACE]" : ""} ${pace}`;
      }).join("\n");

      const prompt = `You are analyzing training data to validate HR zone estimates.

Computed estimates:
- Max HR: ${result.maxHR} bpm
- Resting HR: ${result.restHR} bpm
- VO2max: ${cache.vo2max.toFixed(1)} ml/kg/min (VDOT ${cache.vdot.toFixed(1)})
- Method: ${cache.method}

Recent 90 days of activities (last 30):
${activitySummary}

In 2-3 sentences: Do these estimates seem reasonable given the training data?
Note anything suspicious (e.g. if max HR seems too low/high, if VDOT conflicts with observed paces).
Be specific and data-driven.`;

      try {
        if (aiSettings.provider === "gemini") {
          const { GoogleGenerativeAI } = await import("@google/generative-ai");
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
          const res = await model.generateContent(prompt);
          aiInsights = res.response.text();
        } else {
          const Anthropic = (await import("@anthropic-ai/sdk")).default;
          const client = new Anthropic({ apiKey });
          const res = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 300,
            messages: [{ role: "user", content: prompt }],
          });
          aiInsights = res.content[0].type === "text" ? res.content[0].text : null;
        }
      } catch (e) {
        console.warn("AI insights failed:", e);
      }
    }
  }

  return NextResponse.json({
    vo2max:      cache.vo2max,
    vdot:        cache.vdot,
    confidence:  cache.confidence,
    method:      cache.method,
    maxHR:       cache.maxHR,
    restHR:      cache.restHR,
    thresholdHR: cache.thresholdHR,
    zones:       cache.zones,
    paces:       cache.paces,
    computedAt:  cache.computedAt,
    aiInsights,
  });
}
