// Weather-pace, easy-pace, and cadence/stride analytics — shared between the main Stats
// page and the Performance Trends page so neither has to re-derive the other's copy.
import { format } from "date-fns";

export interface WeatherBand { label: string; count: number; avgPaceSecPerKm: number | null }
export interface WeatherScatterPoint { x: number; paceDeltaSec: number }
export interface WeatherStats {
  byTemp: WeatherBand[];
  byWind: WeatherBand[];
  byPrecip: WeatherBand[];
  hrNormByTemp: WeatherBand[];
  coldSensitivity: number | null;
  tempScatter: WeatherScatterPoint[];
  windScatter: WeatherScatterPoint[];
}

export type WeatherAct = {
  averageSpeed: number | null;
  weatherTemp: number | null;
  weatherWind: number | null;
  weatherPrecip: number | null;
  distance: number;
  startDate: Date;
  name: string;
  sportType: string;
  averageHeartrate: number | null;
};

// Excludes orienteering, indoor/virtual, and warmup/cooldown segments from pace-based
// aerobic analysis — terrain, navigation stops, and treadmill calibration all distort the
// pace/HR relationship that easy-pace and weather-pace trends depend on.
export function isOL(a: { sportType: string; name?: string | null }): boolean {
  return (
    /virtualrun/i.test(a.sportType) ||
    /indoor|inomhus/i.test(a.name ?? "") ||
    /orienteer|ol\b|ol-/i.test(a.sportType) ||
    /\bol\b|\borienteringsl|\bskogsl|\bolpass|\bmoc\b|stafett/i.test(a.name ?? "") ||
    /^\s*wu\b|^\s*cd\b|\bwarm.?up\b|\bcool.?down\b|\bnedvarvning\b|\buppvärmning\b/i.test(a.name ?? "")
  );
}

export function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function computeWeatherStats(acts: WeatherAct[], maxHR: number): WeatherStats {
  const clean = acts.filter(a =>
    a.averageSpeed && a.averageSpeed > 0 &&
    !isOL(a) &&
    /run|trail/i.test(a.sportType)
  );

  if (clean.length < 10) {
    return { byTemp: [], byWind: [], byPrecip: [], hrNormByTemp: [], coldSensitivity: null, tempScatter: [], windScatter: [] };
  }

  const sorted = [...clean].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const overallPaces = sorted.map(a => 1000 / a.averageSpeed!);
  const overallMedian = median(overallPaces);

  const adjustedPaces = sorted.map(a => {
    const rawPace = 1000 / a.averageSpeed!;
    const windowStart = a.startDate.getTime() - 42 * 86400_000;
    const windowEnd   = a.startDate.getTime() + 42 * 86400_000;
    const windowPaces = sorted
      .filter(b => b.startDate.getTime() >= windowStart && b.startDate.getTime() <= windowEnd)
      .map(b => 1000 / b.averageSpeed!);
    return rawPace - (median(windowPaces) - overallMedian);
  });

  const TEMP_BANDS = [
    { label: "< −10°C",  test: (t: number) => t < -10 },
    { label: "−10–−5°C", test: (t: number) => t >= -10 && t < -5 },
    { label: "−5–0°C",   test: (t: number) => t >= -5  && t < 0 },
    { label: "0–5°C",    test: (t: number) => t >= 0   && t < 5 },
    { label: "5–10°C",   test: (t: number) => t >= 5   && t < 10 },
    { label: "10–15°C",  test: (t: number) => t >= 10  && t < 15 },
    { label: "15–20°C",  test: (t: number) => t >= 15  && t < 20 },
    { label: "20–25°C",  test: (t: number) => t >= 20  && t < 25 },
    { label: "> 25°C",   test: (t: number) => t >= 25 },
  ];
  const WIND_BANDS = [
    { label: "Calm (< 10)",      test: (w: number) => w < 10 },
    { label: "Light (10–20)",    test: (w: number) => w >= 10 && w < 20 },
    { label: "Moderate (20–30)", test: (w: number) => w >= 20 && w < 30 },
    { label: "Strong (> 30)",    test: (w: number) => w >= 30 },
  ];
  const PRECIP_BANDS = [
    { label: "Dry (< 0.5 mm)",     test: (p: number) => p < 0.5 },
    { label: "Light (0.5–2 mm)",   test: (p: number) => p >= 0.5 && p < 2 },
    { label: "Rain (> 2 mm)",      test: (p: number) => p >= 2 },
  ];

  function computeBands(
    bands: { label: string; test: (v: number) => boolean }[],
    getValue: (a: WeatherAct) => number | null,
    controlFilter?: (a: WeatherAct) => boolean,
  ): WeatherBand[] {
    return bands.map(band => {
      const indices = sorted
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => {
          const v = getValue(a);
          if (v == null || !band.test(v)) return false;
          if (controlFilter && !controlFilter(a)) return false;
          return true;
        });
      if (indices.length < 3) return { label: band.label, count: 0, avgPaceSecPerKm: null };
      const avg = indices.reduce((s, { i }) => s + adjustedPaces[i], 0) / indices.length;
      return { label: band.label, count: indices.length, avgPaceSecPerKm: Math.round(avg) };
    });
  }

  // HR-normalized: pace at 70-80% maxHR — effort-controlled, no fitness drift correction needed
  const hrLo = Math.round(maxHR * 0.70), hrHi = Math.round(maxHR * 0.80);
  const hrNormByTemp: WeatherBand[] = TEMP_BANDS.map(band => {
    const matches = sorted.filter(a => {
      if (!a.averageHeartrate || !a.weatherTemp) return false;
      if (!band.test(a.weatherTemp)) return false;
      return a.averageHeartrate >= hrLo && a.averageHeartrate <= hrHi;
    });
    if (matches.length < 3) return { label: band.label, count: 0, avgPaceSecPerKm: null };
    const avg = matches.reduce((s, a) => s + 1000 / a.averageSpeed!, 0) / matches.length;
    return { label: band.label, count: matches.length, avgPaceSecPerKm: Math.round(avg) };
  });

  // Cold sensitivity: OLS regression on cold runs (< 10°C), sec/km per 5°C drop below 5°C
  let coldSensitivity: number | null = null;
  {
    const coldPts = sorted.filter(a => a.weatherTemp != null && a.weatherTemp < 10);
    if (coldPts.length >= 8) {
      const coldIdx = coldPts.map(a => sorted.indexOf(a));
      const temps = coldPts.map(a => a.weatherTemp!);
      const paces = coldIdx.map(i => adjustedPaces[i]);
      const mt = temps.reduce((s, t) => s + t, 0) / temps.length;
      const mp = paces.reduce((s, p) => s + p, 0) / paces.length;
      let num = 0, den = 0;
      for (let i = 0; i < coldPts.length; i++) {
        const dt = temps[i] - mt, dp = paces[i] - mp;
        num += dt * dp; den += dt * dt;
      }
      if (den > 0.01) {
        // Negative slope = slower at lower temps; report as positive penalty per 5°C drop
        coldSensitivity = Math.round(-num / den * 5 * 10) / 10;
      }
    }
  }

  // Raw scatter points (relative pace = adjustedPace − overall median, in s/km) for the
  // continuous temp/wind-vs-pace charts — same control filters as the binned bands above,
  // so the scatter and the annotated sensitivity slopes describe the same controlled dataset.
  function buildScatter(
    getValue: (a: WeatherAct) => number | null,
    controlFilter: (a: WeatherAct) => boolean,
  ): WeatherScatterPoint[] {
    return sorted.flatMap((a, i) => {
      const v = getValue(a);
      if (v == null || !controlFilter(a)) return [];
      return [{ x: v, paceDeltaSec: Math.round((adjustedPaces[i] - overallMedian) * 10) / 10 }];
    });
  }

  return {
    byTemp: computeBands(TEMP_BANDS, a => a.weatherTemp,
      a => a.weatherWind == null || a.weatherWind < 20),
    byWind: computeBands(WIND_BANDS, a => a.weatherWind,
      a => a.weatherTemp != null && a.weatherTemp >= 0 && a.weatherTemp < 25),
    // Precipitation: control for temperature (0–25°C) to avoid cold/rain conflation
    byPrecip: computeBands(PRECIP_BANDS, a => a.weatherPrecip ?? 0,
      a => a.weatherTemp != null && a.weatherTemp >= 0 && a.weatherTemp < 25),
    hrNormByTemp,
    coldSensitivity,
    tempScatter: buildScatter(a => a.weatherTemp, a => a.weatherWind == null || a.weatherWind < 20),
    windScatter: buildScatter(a => a.weatherWind, a => a.weatherTemp != null && a.weatherTemp >= 0 && a.weatherTemp < 25),
  };
}

// ── Easy run pace trend ──────────────────────────────────────────────────────

export type EasyPacePoint = { month: string; medianGap: number; avgHR: number; count: number };

export type EasyPaceAct = {
  sportType: string; startDate: Date; distance: number; movingTime: number;
  totalElevationGain: number; averageHeartrate: number | null; isRace: boolean; name: string;
};

export function computeEasyPaceTrend(acts: EasyPaceAct[], lt1HR: number): EasyPacePoint[] {
  const byMonth = new Map<string, Array<{ gap: number; hr: number }>>();
  for (const a of acts) {
    if (!a.averageHeartrate || a.isRace) continue;
    if (!/run|trail/i.test(a.sportType)) continue;
    if (isOL(a)) continue;
    if (a.averageHeartrate >= lt1HR) continue;
    if (a.distance < 6000 || a.movingTime < 1200) continue;
    const rawPace = a.movingTime / (a.distance / 1000);
    const grade = Math.min(0.15, Math.max(0, a.totalElevationGain / a.distance));
    const gap = rawPace / (1 + grade * 0.033);
    const month = format(a.startDate, "yyyy-MM");
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push({ gap, hr: a.averageHeartrate });
  }
  const result: EasyPacePoint[] = [];
  for (const [month, pts] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (pts.length < 3) continue;
    const sorted = [...pts].sort((a, b) => a.gap - b.gap);
    const mid = Math.floor(sorted.length / 2);
    const medianGap = sorted.length % 2 === 0
      ? (sorted[mid - 1].gap + sorted[mid].gap) / 2
      : sorted[mid].gap;
    result.push({
      month,
      medianGap: Math.round(medianGap),
      avgHR: Math.round(pts.reduce((s, p) => s + p.hr, 0) / pts.length),
      count: pts.length,
    });
  }
  return result;
}

// ── Cadence/stride length vs. pace ────────────────────────────────────────────
// Speed = Cadence × Stride Length is a mathematical identity, so cadence/stride drift
// week-to-week mostly reflects which mix of paces was run that week, not technique change.
// Plotting both against pace (the actual driving variable) instead of calendar time, split
// into a recent vs. older period, shows whether the cadence-at-a-given-pace curve itself is
// shifting — the physiologically meaningful signal.
export type CadenceScatterPoint = { paceSecPerKm: number; spm: number; strideM: number; period: "recent" | "older" };

export type CadenceAct = { sportType: string | null; averageSpeed: number | null; averageCadence: number | null; startDate: Date };

export function computeCadenceScatter(acts: CadenceAct[], now: Date): CadenceScatterPoint[] {
  const points: CadenceScatterPoint[] = [];
  for (const act of acts) {
    if (!act.sportType || !/run/i.test(act.sportType)) continue;
    if (!act.averageCadence || act.averageCadence < 50) continue;
    if (!act.averageSpeed || act.averageSpeed < 1) continue;
    const daysAgo = (now.getTime() - act.startDate.getTime()) / 86400_000;
    if (daysAgo > 112 || daysAgo < 0) continue; // 16 weeks — matches other recency windows
    const spm = act.averageCadence * 2;
    points.push({
      paceSecPerKm: Math.round(1000 / act.averageSpeed),
      spm: Math.round(spm),
      strideM: Math.round((act.averageSpeed / (spm / 60)) * 100) / 100,
      period: daysAgo <= 56 ? "recent" : "older",
    });
  }
  return points;
}
