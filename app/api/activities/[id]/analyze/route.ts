/**
 * POST /api/activities/[id]/analyze
 *
 * Streams an AI analysis of a single workout activity.
 * Only callable for activities with workoutType === 3 (Strava "workout").
 * Returns text/event-stream — each chunk is a plain text delta.
 */

import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { safeDecrypt } from "@/lib/encrypt";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

function formatPace(speedMs: number): string {
  if (!speedMs || speedMs <= 0) return "—";
  const secPerKm = 1000 / speedMs;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, "0")} /km`;
}

function formatDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;
  const { id } = await params;

  const [activity, fitnessCache, aiSettings] = await Promise.all([
    prisma.activity.findUnique({
      where: { id },
      select: {
        id: true, userId: true, name: true, sportType: true,
        startDate: true, distance: true, movingTime: true,
        averageHeartrate: true, maxHeartrate: true,
        averageSpeed: true, totalElevationGain: true,
        weatherTemp: true, weatherWind: true, weatherCode: true,
        workoutType: true, laps: true, splitsMetric: true,
        description: true,
      },
    }),
    prisma.fitnessCache.findUnique({ where: { userId }, select: { tsb: true, vdot: true, maxHR: true } }),
    prisma.aISettings.findUnique({ where: { userId } }),
  ]);

  if (!activity || activity.userId !== userId) return new Response("Not found", { status: 404 });
  if (activity.workoutType !== 3) return new Response("Not a workout activity", { status: 400 });

  // Build compact workout summary for the prompt
  interface LapRaw {
    lap_index: number; distance: number; moving_time: number;
    average_speed: number; average_heartrate?: number; total_elevation_gain?: number;
  }
  const lapsRaw = activity.laps as LapRaw[] | null;
  const lapsText = lapsRaw && lapsRaw.length >= 2
    ? lapsRaw.map((l, i) =>
        `  Lap ${i + 1}: ${(l.distance / 1000).toFixed(2)} km, ${formatDur(l.moving_time)}, ${formatPace(l.average_speed)}${l.average_heartrate ? `, ${Math.round(l.average_heartrate)} bpm` : ""}`
      ).join("\n")
    : "No lap data available";

  const tsb   = fitnessCache?.tsb ?? null;
  const vdot  = fitnessCache?.vdot ?? null;
  const maxHR = fitnessCache?.maxHR ?? activity.maxHeartrate ?? null;
  const totalDistKm = (activity.distance / 1000).toFixed(2);
  const avgPace = formatPace(activity.averageSpeed ?? 0);

  const prompt = `You are a running coach analyzing a workout session. Be concise and practical — 150–250 words.

Activity: ${activity.name} (${activity.sportType})
Date: ${activity.startDate.toISOString().split("T")[0]}
Total distance: ${totalDistKm} km | Moving time: ${formatDur(activity.movingTime)}
Average pace: ${avgPace} | Avg HR: ${activity.averageHeartrate ? Math.round(activity.averageHeartrate) + " bpm" : "n/a"} | Max HR: ${activity.maxHeartrate ? Math.round(activity.maxHeartrate) + " bpm" : "n/a"}
Elevation gain: ${Math.round(activity.totalElevationGain)} m
${activity.weatherTemp != null ? `Weather: ${Math.round(activity.weatherTemp)}°C${activity.weatherWind ? `, wind ${Math.round(activity.weatherWind)} km/h` : ""}` : ""}
${tsb != null ? `Training Stress Balance (TSB): ${tsb > 0 ? "+" : ""}${tsb.toFixed(0)} (${tsb > 5 ? "fresh" : tsb < -10 ? "fatigued" : "neutral"})` : ""}
${vdot != null ? `Current VDOT: ${vdot.toFixed(1)}` : ""}
${maxHR != null ? `Max HR reference: ${maxHR} bpm` : ""}
${activity.description ? `\nAthlete notes: ${activity.description}` : ""}

Lap breakdown:
${lapsText}

Analyze: (1) workout execution quality — were intervals consistent, was intensity appropriate? (2) what the data suggests about current fitness and readiness. (3) one specific recommendation for next time. Address the athlete directly.`;

  const provider = aiSettings?.provider ?? "gemini";
  const apiKey = provider === "claude"
    ? (safeDecrypt(aiSettings?.claudeApiKey) ?? process.env.ANTHROPIC_API_KEY ?? "")
    : (safeDecrypt(aiSettings?.geminiApiKey) ?? process.env.GOOGLE_AI_API_KEY ?? "");

  if (!apiKey) return new Response("No AI API key configured", { status: 503 });

  const encoder = new TextEncoder();

  if (provider === "claude") {
    const client = new Anthropic({ apiKey });
    const stream = await client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });
    return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } else {
    // Gemini
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
    const result = await model.generateContentStream(prompt);
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) controller.enqueue(encoder.encode(text));
        }
        controller.close();
      },
    });
    return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
