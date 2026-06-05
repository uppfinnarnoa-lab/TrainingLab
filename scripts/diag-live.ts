import { PrismaClient } from "@prisma/client";
import { subDays } from "date-fns";
import { gradeAdjustedPace } from "../lib/fitness/vo2max";

const prisma = new PrismaClient();

const olFilter = (name: string) =>
  !/\bol\b|\borienteringsl|\bskogsl|\bolpass|orienteer|\bmoc\b|stafett/i.test(name) &&
  !/indoor|inomhus/i.test(name) &&
  !/virtualrun/i.test(name);

const wuCdFilter = (name: string) =>
  !/^\s*wu\b|^\s*cd\b|\bwarm.?up\b|\bcool.?down\b|\bnedvarvning\b|\buppvärmning\b/i.test(name);

type LapRow = { average_heartrate?: number; distance: number; moving_time: number; total_elevation_gain?: number };

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("no user");
  const cache = await prisma.fitnessCache.findUnique({ where: { userId: user.id }, select: { maxHR: true, restHR: true } });
  const maxHR = cache?.maxHR ?? 184;
  console.log("maxHR:", maxHR);

  const fiveYearsAgo = subDays(new Date(), 5 * 365);
  const liveActs = await prisma.activity.findMany({
    where: { userId: user.id, startDate: { gte: fiveYearsAgo }, sportType: { contains: "run", mode: "insensitive" } },
    select: { name: true, startDate: true, laps: true, isRace: true, weatherTemp: true },
  });

  type Act = typeof liveActs[number];

  const liveLaps = (liveActs as Act[])
    .filter(a => olFilter(a.name) && wuCdFilter(a.name) && Array.isArray(a.laps))
    .flatMap(a =>
      (a.laps as LapRow[]).filter(l => l.average_heartrate && l.distance >= 800 && l.moving_time >= 180).map(l => ({
        avgHR: l.average_heartrate!,
        distanceM: l.distance,
        movingTimeSec: l.moving_time,
        totalElevationGain: l.total_elevation_gain ?? 0,
        startDate: a.startDate,
        isRace: a.isRace ?? false,
        weatherTemp: a.weatherTemp,
      }))
    );

  const refTime = Date.now();
  const recentCount = liveLaps.filter(r => (refTime - r.startDate.getTime()) / 86400000 < 90).length;
  const halfLife = recentCount >= 40 ? 90 : 180;
  console.log("recentCount:", recentCount, " halfLife:", halfLife);

  const points = liveLaps
    .filter(r =>
      r.avgHR > maxHR * 0.52 && r.avgHR < maxHR * 0.96 &&
      r.distanceM >= 800 && r.movingTimeSec >= 180 &&
      r.totalElevationGain / r.distanceM < 0.12
    )
    .map(r => {
      const rawPace = r.movingTimeSec / (r.distanceM / 1000);
      const gap = gradeAdjustedPace(rawPace, r.totalElevationGain, r.distanceM);
      const temp = r.weatherTemp ?? 15;
      if (temp > 30) return null;
      const tempWeight = temp > 25 ? 0.35 : temp > 20 ? 0.75 : 1.0;
      const daysAgo = (refTime - r.startDate.getTime()) / 86400000;
      const recency = Math.exp(-daysAgo / halfLife);
      const raceBoost = r.isRace ? 3.0 : 1.0;
      return { gap, hr: r.avgHR, weight: tempWeight * recency * raceBoost };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null && p.gap > 200 && p.gap < 391 && p.weight > 0.01);

  console.log("Points after all filters:", points.length);

  const binWidth = 15;
  const bucketMap = new Map<number, Array<{ hr: number; w: number }>>();
  for (const p of points) {
    const key = Math.round(p.gap / binWidth) * binWidth;
    if (!bucketMap.has(key)) bucketMap.set(key, []);
    bucketMap.get(key)!.push({ hr: p.hr, w: p.weight });
  }

  const MIN_COUNT = 10;
  interface BucketPoint { pace: number; medianHR: number; count: number; totalWeight: number }
  const buckets: BucketPoint[] = [...bucketMap.entries()]
    .filter(([, pts]) => pts.length >= MIN_COUNT)
    .map(([pace, pts]) => {
      const totalW = pts.reduce((s, p) => s + p.w, 0);
      const sortedHR = [...pts].map(p => p.hr).sort((a, b) => a - b);
      const pct80HR = sortedHR[Math.min(Math.floor(sortedHR.length * 0.80), sortedHR.length - 1)];
      return { pace, medianHR: pct80HR, count: pts.length, totalWeight: totalW };
    })
    .sort((a, b) => a.pace - b.pace);

  console.log("\nBuckets after MIN_COUNT filter (pace, HR, count, totalW):");
  for (const b of buckets) {
    const m = Math.floor(b.pace / 60), s = Math.round(b.pace % 60);
    console.log(`  ${m}:${String(s).padStart(2,"0")}/km  HR=${b.medianHR}  count=${b.count}  totalW=${b.totalWeight.toFixed(1)}`);
  }

  // Pool adjacent violators
  const out = buckets.map(b => ({ ...b }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i].medianHR < out[i + 1].medianHR) {
        const tc = out[i].count + out[i + 1].count;
        const tw = out[i].totalWeight + out[i + 1].totalWeight;
        out.splice(i, 2, {
          pace: (out[i].pace * out[i].count + out[i + 1].pace * out[i + 1].count) / tc,
          medianHR: (out[i].medianHR * out[i].count + out[i + 1].medianHR * out[i + 1].count) / tc,
          count: tc,
          totalWeight: tw,
        });
        changed = true;
        break;
      }
    }
  }

  console.log("\nAfter poolAdjacentViolators:", out.length, "buckets");
  for (const b of out) {
    const m = Math.floor(b.pace / 60), s = Math.round(b.pace % 60);
    console.log(`  ${m}:${String(s).padStart(2,"0")}/km  HR=${b.medianHR.toFixed(1)}`);
  }

  if (out.length < 6) {
    console.log("→ FAILS: mono.length < 6");
    return;
  }

  // Check sanity conditions
  // (simplified: just show where bp1 would land)
  const paceArr = out.map(b => b.pace);
  const hrArr = out.map(b => b.medianHR);
  const bucketWeights = out.map(b => 1 / Math.sqrt(b.totalWeight));

  const nb = out.length;
  let bestErr = Infinity, bp1 = 2, bp2 = Math.min(4, nb - 2);

  function segErr(paces: number[], hrs: number[], from: number, to: number, ws: number[]) {
    if (to - from < 2) return 0;
    const xs = paces.slice(from, to + 1), ys = hrs.slice(from, to + 1), w = ws.slice(from, to + 1);
    const totalW = w.reduce((s, x) => s + x, 0);
    const mx = xs.reduce((s, x, i) => s + x * w[i], 0) / totalW;
    const my = ys.reduce((s, y, i) => s + y * w[i], 0) / totalW;
    const sxy = xs.reduce((s, x, i) => s + w[i] * (x - mx) * (ys[i] - my), 0);
    const sxx = xs.reduce((s, x, i) => s + w[i] * (x - mx) ** 2, 0);
    if (sxx === 0) return 0;
    const b = sxy / sxx;
    return ys.reduce((s, y, i) => s + w[i] * (y - (my + b * (xs[i] - mx))) ** 2, 0);
  }

  for (let i = 1; i < nb - 2; i++) {
    for (let j = i + 1; j < nb - 1; j++) {
      const err = segErr(paceArr, hrArr, 0, i, bucketWeights) +
                  segErr(paceArr, hrArr, i, j, bucketWeights) +
                  segErr(paceArr, hrArr, j, nb - 1, bucketWeights);
      if (err < bestErr) { bestErr = err; bp1 = i; bp2 = j; }
    }
  }

  const lt2PaceSecPerKm = paceArr[bp1];
  const lt2HR = Math.round(hrArr[bp1]);
  const lt1PaceTarget = lt2PaceSecPerKm / 0.844;
  const lt1BucketIdx = paceArr.findIndex(p => p >= lt1PaceTarget);
  const lt1HR = lt1BucketIdx === -1
    ? Math.round(hrArr[bp2])
    : lt1BucketIdx === 0
      ? Math.round(hrArr[0])
      : Math.round(hrArr[lt1BucketIdx - 1] + ((lt1PaceTarget - paceArr[lt1BucketIdx - 1]) / (paceArr[lt1BucketIdx] - paceArr[lt1BucketIdx - 1])) * (hrArr[lt1BucketIdx] - hrArr[lt1BucketIdx - 1]));
  const lt1Pace = lt1BucketIdx === -1 ? Math.round(paceArr[bp2]) : Math.round(lt1PaceTarget);

  function fmt(s: number) { const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2,"0")}`; }
  console.log(`\nbp1=${bp1}  bp2=${bp2}`);
  console.log(`LT2: ${lt2HR}bpm @ ${fmt(lt2PaceSecPerKm)}/km`);
  console.log(`LT1: ${lt1HR}bpm @ ${fmt(lt1Pace)}/km`);

  if (lt1HR >= lt2HR - 8) console.log("→ FAILS sanity: lt1HR >= lt2HR - 8");
  else if (lt2HR >= maxHR * 0.98) console.log("→ FAILS sanity: lt2HR >= maxHR*0.98");
  else if (lt1HR < maxHR * 0.60 || lt2HR < maxHR * 0.70) console.log("→ FAILS sanity: thresholds too low");
  else if (lt1Pace < 240 || lt1Pace > 380) console.log("→ FAILS sanity: lt1 pace out of range", lt1Pace);
  else if (lt2PaceSecPerKm < 200 || lt2PaceSecPerKm > 420) console.log("→ FAILS sanity: lt2 pace out of range");
  else if (lt2PaceSecPerKm >= lt1Pace) console.log("→ FAILS sanity: lt2 not faster than lt1");
  else console.log("→ All sanity checks pass");
}

main().finally(() => prisma.$disconnect());
