import { prisma } from "@/lib/db/prisma";
import { garminFetch } from "./client";
import { format } from "date-fns";

export async function syncGarminDaily(userId: string, date: Date = new Date()) {
  const dateStr = format(date, "yyyy-MM-dd");

  // Garmin Wellness API: daily summaries
  let summary;
  try {
    const data = await garminFetch(userId, "/dailies", {
      startDate: dateStr,
      endDate: dateStr,
    });
    summary = Array.isArray(data) ? data[0] : data;
  } catch (e) {
    console.warn(`Garmin daily sync failed for ${dateStr}:`, e);
    return;
  }

  if (!summary) return;

  // Sleep data
  let sleep;
  try {
    const sleepData = await garminFetch(userId, "/sleep", {
      startDate: dateStr,
      endDate: dateStr,
    });
    sleep = Array.isArray(sleepData) ? sleepData[0] : sleepData;
  } catch {
    // Sleep data optional
  }

  await prisma.garminDailySummary.upsert({
    where: { userId_date: { userId, date } },
    create: {
      userId,
      date,
      restingHR: summary.restingHeartRateValue ?? null,
      hrvNightly: summary.averageStressLevel ?? null, // Garmin doesn't expose raw HRV easily
      hrvBalance: summary.bodyBatteryChargedValue != null
        ? (summary.bodyBatteryChargedValue > 50 ? "Balanced" : "Low")
        : null,
      sleepScore: sleep?.sleepScores?.overall ?? null,
      sleepDuration: sleep?.durationInSeconds ?? null,
      sleepDeep: sleep?.deepSleepDurationInSeconds ?? null,
      sleepLight: sleep?.lightSleepDurationInSeconds ?? null,
      sleepRem: sleep?.remSleepInSeconds ?? null,
      sleepAwake: sleep?.awakeDurationInSeconds ?? null,
      bodyBattery: summary.bodyBatteryChargedValue ?? null,
      respirationRate: summary.avgWakingRespirationValue ?? null,
    },
    update: {
      restingHR: summary.restingHeartRateValue ?? null,
      sleepScore: sleep?.sleepScores?.overall ?? null,
      sleepDuration: sleep?.durationInSeconds ?? null,
      bodyBattery: summary.bodyBatteryChargedValue ?? null,
    },
  });
}
