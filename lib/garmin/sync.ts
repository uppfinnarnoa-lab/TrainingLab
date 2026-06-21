// Garmin Connect daily wellness sync — mirrors the Python sidecar data extraction exactly.
// Uses unofficial Connect API endpoints; same data available as garminconnect Python library.

import { prisma } from "@/lib/db/prisma";
import { garminConnectFetch, getGarminToken } from "./client";
import { fetchDisplayName } from "./auth";
import { format } from "date-fns";

type AnyObj = Record<string, unknown>;

function safe(promise: Promise<unknown>, label: string): Promise<unknown> {
  return promise.catch(e => {
    console.error(`[garmin] ${label} fetch failed:`, e instanceof Error ? e.message : e);
    return null;
  });
}

/** Returns true if at least one real (non-null) field was fetched from Garmin for this date. */
export async function syncGarminDaily(userId: string, date: Date = new Date()): Promise<boolean> {
  const account = await prisma.garminAccount.findUnique({ where: { userId } });
  if (!account) return false;

  let dn        = account.displayName;
  const dateStr = format(date, "yyyy-MM-dd");

  // displayName is normally captured once at connect time (exchange-ticket/connect routes).
  // If that one-off fetch failed silently, the access/refresh tokens are still valid — self-heal
  // by retrying it here instead of forcing the user to disconnect and reconnect.
  if (!dn) {
    console.warn(`[garmin] No displayName cached for user ${userId} — attempting to recover it`);
    const token = await getGarminToken(userId).catch(e => {
      console.error("[garmin] getGarminToken failed while recovering displayName:", e instanceof Error ? e.message : e);
      return null;
    });
    if (token) {
      dn = await fetchDisplayName(token);
      if (dn) {
        await prisma.garminAccount.update({ where: { userId }, data: { displayName: dn } });
        console.log(`[garmin] Recovered displayName for user ${userId}: ${dn}`);
      }
    }
    if (!dn) {
      console.warn(`[garmin] Still no displayName for user ${userId} — reconnect Garmin in Settings`);
      return false;
    }
  }

  const [summaryRaw, sleepRaw, hrvRaw, readinessRaw, spo2Raw] = await Promise.all([
    safe(garminConnectFetch(userId, `/usersummary-service/usersummary/daily/${dn}`, { calendarDate: dateStr }), "summary"),
    safe(garminConnectFetch(userId, `/wellness-service/wellness/dailySleepData/${dn}`, { date: dateStr, nonSleepBufferMinutes: "60" }), "sleep"),
    safe(garminConnectFetch(userId, `/hrv-service/hrv/${dn}`, { startDate: dateStr, endDate: dateStr }), "hrv"),
    safe(garminConnectFetch(userId, `/metrics-service/metrics/trainingreadiness`, { startDate: dateStr }), "readiness"),
    safe(garminConnectFetch(userId, `/wellness-service/wellness/user/daily-wellness/spo2/details`, { startDate: dateStr, endDate: dateStr }), "spo2"),
  ]);

  const summary   = (summaryRaw as AnyObj | null)  ?? {};
  const sleepDTO  = ((sleepRaw  as AnyObj | null)?.dailySleepDTO as AnyObj | undefined) ?? {};
  const hrvSumm   = ((hrvRaw    as AnyObj | null)?.hrvSummary    as AnyObj | undefined) ?? {};
  const spo2      = (spo2Raw    as AnyObj | null)  ?? {};
  const allDay    = (spo2.allDay as AnyObj | undefined) ?? {};

  // Training readiness — response is a list; take the last (most recent) entry
  const readinessList = Array.isArray(readinessRaw) ? readinessRaw as AnyObj[] : [];
  const readinessEntry: AnyObj = readinessList.length ? readinessList[readinessList.length - 1] : {};

  // Sleep score — field name varies across Garmin firmware versions (same logic as Python sidecar)
  let sleepScore: number | null = null;
  for (const key of ["sleepScores", "overallScore", "sleepScore"]) {
    const raw = sleepDTO[key];
    if (raw !== null && typeof raw === "object") {
      const o = raw as AnyObj;
      const v = (o.overall as AnyObj | undefined)?.value ?? o.value ?? o.qualityScore;
      if (typeof v === "number") { sleepScore = Math.round(v); break; }
    } else if (typeof raw === "number") {
      sleepScore = Math.round(raw);
      break;
    }
  }

  // HRV balance status string
  const status     = String(hrvSumm.status ?? "").toUpperCase();
  const hrvBalance = status.includes("BALANCED")   ? "Balanced"
    : status.includes("LOW")        ? "Low"
    : status.includes("UNBALANCED") ? "Unbalanced"
    : null;

  const record = {
    restingHR:         toInt(summary.restingHeartRate),
    bodyBattery:       toInt(summary.bodyBatteryHighestValue),
    respirationRate:   toFloat(summary.avgWakingRespirationValue),
    stressAvg:         toInt(summary.averageStressLevel),
    steps:             toInt(summary.totalSteps),
    sleepScore,
    sleepDuration:     toInt(sleepDTO.sleepTimeSeconds),
    sleepDeep:         toInt(sleepDTO.deepSleepSeconds),
    sleepLight:        toInt(sleepDTO.lightSleepSeconds),
    sleepRem:          toInt(sleepDTO.remSleepSeconds),
    sleepAwake:        toInt(sleepDTO.awakeSleepSeconds),
    hrvNightly:        toFloat(hrvSumm.lastNight),
    hrvBalance,
    trainingReadiness: toInt(readinessEntry.trainingReadinessScore ?? readinessEntry.score),
    spo2Avg:           toFloat(allDay.averageSPO2 ?? spo2.averageSPO2),
  };

  // Only update fields that actually have data this sync — never overwrite a
  // previously stored non-null value with null (handles partial data days where
  // e.g. sleep was captured but readiness wasn't available yet, or the user
  // synced twice and one run returned fewer fields).
  const updateRecord = Object.fromEntries(
    Object.entries(record).filter(([, v]) => v !== null)
  );

  await prisma.garminDailySummary.upsert({
    where:  { userId_date: { userId, date } },
    create: { userId, date, ...record },
    update: updateRecord,
  });

  return Object.keys(updateRecord).length > 0;
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? Math.round(n) : null;
}

function toFloat(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
