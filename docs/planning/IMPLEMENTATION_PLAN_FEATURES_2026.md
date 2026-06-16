# TrainingLab — Feature Implementation Plan (2026)

> Skapad 2026-06-16 baserad på IDEAS_AND_FEATURES.md + kodbas-analys.
> Täcker desktop **och** mobil genomgående.
> Redan implementerade delar noterade under respektive punkt.

---

## Redan klart — notera och skippa

> Uppdaterad efter fullständig kodbas-analys 2026-06-16.

| Punkt | Status |
|---|---|
| **8A Strava Webhook** | ✅ **Fullt klart** — backend (`/api/strava/webhook`, `/api/strava/webhook-subscription`) + Settings UI |
| **11A Rate-limit på AI-chat** | ✅ **Klart** — `checkRateLimit` appliceras i `/api/coach/chat/route.ts` |
| **@dnd-kit installerat** | ✅ `@dnd-kit/core` + `@dnd-kit/sortable` i package.json — behöver bara kopplas in |
| **1D Block-editor modal** | ✅ **Fullt klart** — `components/planner/BlockEditorModal.tsx` implementerad med namn, typ, färg, datum, km/v, target race, noteringar. Importerad och använd i `planner-client.tsx`. |
| **9G Dark/ljus karttiles** | ✅ **Fullt klart** — `activity-map.tsx` rad 49–51 använder CartoDB `dark_all`/`light_all` via `resolvedTheme`. Inget att göra. |
| **7D `/`-kommandon i coachen** | ✅ **Fullt klart** — ChatInterface.tsx: /plan, /taper, /analyze, /week, /compare i tool-picker + "Snabbkommandon"-sektion med namngivna kommandon + /summarize knapp. |
| **1F Period A vs B (volym)** | ✅ **Delvis klart** — `stats/volume/volume-client.tsx` har Period A/B-jämförelse för volym (km, tid, TSS) med bar-chart och summering + delta-tabell (km, sessions). CTL/VO2max-trend ej implementerat. |
| **3E GAP** | ✅ **Fullt klart** — `activities/[id]/page.tsx`: GAP stats-kort för löpning med ≥20m/km stigning. |
| **3C PB-banner** | ✅ **Fullt klart** — Trophy-pills vid ny best effort vs RaceRecord-tabell. |
| **3F Prev/next nav** | ✅ **Fullt klart** — parallella Prisma-queries för adjacent aktiviteter, länkning i header. |
| **1B/3D Pa:HR decoupling** | ✅ **Fullt klart** — computeDrift exporterad, decoupling-kort på aktivitetssidan (≥6 splits, ≥40min, löpning). |
| **2B PVI** | ✅ **Fullt klart** — Pace Variability Index i SplitsTable-footer (≥4 splits). |
| **1A Kadenstrender** | ✅ **Fullt klart** — 26-veckors kadensdiagram (spm + steglängd), fast+slow path i stats. |
| **2A EF-trend** | ✅ **Fullt klart** — Efficiency Factor trend (easy runs, HR < LT1), 4-veckors delta. |
| **2C Monotoni/Strain** | ✅ **Fullt klart** — Foster 1998 monotoni/strain, färgkodat kort i stats load-tab. |
| **2F Recovery speed** | ✅ **Fullt klart** — genomsnittliga återhämtningsdagar från TSB-troughs, kort i stats. |
| **7E /summarize-kommando** | ✅ **Fullt klart** — pre-fyller textarea med sammandragsuppmaningen + lång-konversationsbanderoll vid ≥20 meddelanden. |
| **5A DnD i planner** | ✅ **Fullt klart** — dnd-kit DndContext + PointerSensor/TouchSensor, DraggableWorkout/DroppableDay, DragOverlay, PATCH endpoint. |
| **5B Veckopanel** | ✅ **Fullt klart** — selectedWeek state, bottom sheet (mobil) / statisk panel (desktop) med planerat/utfört/TSS/procent. |
| **5C Taper-markering** | ✅ **Fullt klart** — skannar framtida Race-typ, beräknar taper-start (marathon: 3v, halv: 2v, 10k: 1v), visar ⚡ Taper start-chip. |
| **2I Stream-caching** | ✅ **Fullt klart** — ActivityStream-modell, cache-first i streams-route, HRR60 extraheras vid cache-tid. |
| **8C Token-race condition** | ✅ **Fullt klart** — Map<userId, Promise<token>> deduplicerar parallella token-refreshes. |
| **9D/9F Aktivitetsfilter** | ✅ **Fullt klart** — sort-dropdown + races-only-toggle + distance-range i activities-listan. |
| **4C paceUnit + annualGoals** | ✅ **Fullt klart** — paceUnit radio + annualGoals per sport i AthleteProfile. |
| **11B PWA** | ✅ **Fullt klart** — next-pwa, manifest.json, ikon-filer, manifest-länk i layout.tsx. |
| **Fler färger** | ✅ **Fullt klart** — utökade paletter i sports-manager, WorkoutBuilder, BlockEditorModal. |
| **1C Activity matching** | ✅ **Fullt klart** — lib/fitness/activity-matching.ts, tryMatchActivity() i sync.ts. |

---

## Fas 1 — Aktivitetssidan (alla isolerade, snabba vinster)

**Tidsuppskattning:** 1–2 dagar totalt · Driftsättning: inget schema-ändring

### 3E — Grade Adjusted Pace (GAP) på aktivitetssidan

**Vad:** `gradeAdjustedPace()` beräknas redan i `vo2max.ts`. Visa det som ett extra stats-kort.

**Implementering:**
```tsx
// app/(dashboard)/activities/[id]/page.tsx
// Beräkna på servern med befintlig funktion
import { gradeAdjustedPace } from "@/lib/fitness/vo2max";
const rawPaceSecPerKm = activity.averageSpeed ? 1000 / activity.averageSpeed : null;
const gap = rawPaceSecPerKm && activity.totalElevationGain > 0
  ? gradeAdjustedPace(rawPaceSecPerKm, activity.totalElevationGain, activity.distance)
  : null;
```

Lägg till i stats-grid bredvid "Avg pace":
```
GAP: 4:18/km    (vid ≥ 30m stigning per km, annars dölj)
```

**Mobil:** Rutnätet är redan 2×4 responsive — ett extra kort hanteras automatiskt.

---

### 3C — PB-highlight vid ny best effort

**Vad:** Om en aktivitets `bestEfforts` JSON innehåller ett effort snabbare än senaste `RaceRecord` för samma distans → visa banner.

**Implementering:**
```tsx
// app/(dashboard)/activities/[id]/page.tsx — server-sidan
const existingPBs = await prisma.raceRecord.findMany({
  where: { userId },
  select: { distanceM: true, time: true },
});
const pbMap = new Map(existingPBs.map(r => [Math.round(r.distanceM), r.time]));

const newPBs = (bestEffortsRaw).filter(e => {
  const existing = pbMap.get(Math.round(e.distance));
  return !existing || e.elapsed_time < existing;
}).map(e => ({ name: e.name, distance: e.distance, time: e.elapsed_time }));
```

Visa under header (före stats-grid):
```tsx
{newPBs.length > 0 && (
  <div className="flex gap-2 flex-wrap">
    {newPBs.map(pb => (
      <div key={pb.name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warning/10 border border-warning/30 text-xs font-semibold text-warning">
        <Trophy size={12} /> Nytt PB! {pb.name} — {formatTime(pb.time)}
      </div>
    ))}
  </div>
)}
```

**Mobil:** `flex-wrap` gör att pills radbryter naturligt.

---

### 3F — Prev/Next-navigering mellan aktiviteter

**Vad:** Pilar för att bläddra mellan aktiviteter utan att gå till listan.

**Implementering (server):**
```tsx
// Hämta id för föregående/nästa aktivitet sorterat på startDate
const [prevAct, nextAct] = await Promise.all([
  prisma.activity.findFirst({
    where: { userId, startDate: { lt: activity.startDate } },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true },
  }),
  prisma.activity.findFirst({
    where: { userId, startDate: { gt: activity.startDate } },
    orderBy: { startDate: "asc" },
    select: { id: true, name: true },
  }),
]);
```

Lägg till under "Back to activities"-länken:
```tsx
<div className="flex items-center gap-3">
  <Link href="/activities">← Alla aktiviteter</Link>
  <div className="ml-auto flex gap-2">
    {prevAct && <Link href={`/activities/${prevAct.id}`} className="text-sm text-muted hover:text-primary">← {prevAct.name.slice(0, 25)}</Link>}
    {nextAct && <Link href={`/activities/${nextAct.id}`} className="text-sm text-muted hover:text-primary">{nextAct.name.slice(0, 25)} →</Link>}
  </div>
</div>
```

**Mobil:** Fullbredd, radbryter naturligt. På mobil: klickyta ≥ 44px (padding).

---

### 1B/3D — Aerobic decoupling (Pa:HR) per aktivitet

**Vad:** Kör `computeDrift()` från `lib/fitness/decoupling.ts` på aktivitetens splits. Visa under splits-chart.

**Obs:** `computeDrift` är nu intern funktion på rad 52 — måste ändras till `export function computeDrift`.

**Implementering (server — ingen extra DB-query):**
```tsx
// Exportera computeDrift från decoupling.ts (ändra `function` → `export function` rad 52)
import { computeDrift } from "@/lib/fitness/decoupling";

const decoupling = splits && splits.length >= 6 && activity.movingTime >= 45 * 60
  ? computeDrift(splits as SplitWithHR[])
  : null;
```

Visa:
```
Pa:HR drift: +3.2%   🟢 Väl kopplad (<5%)
Första halvlek: 4:22/km GAP · 148 bpm → Andra halvlek: 4:19/km GAP · 152 bpm
```

Färgkodning: < 5% grön, 5–10% gul, > 10% röd.

Exportera `computeDrift` från `decoupling.ts` (är nu intern funktion).

**Mobil:** Kompakt 2-rads layout.

---

### 2B — Pace Variability Index (PVI) i splits

**Vad:** Beräkna CV% för splitpaces. Visa under splits-tabellen om ≥ 4 splits.

```typescript
const splitPaces = splits.map(s => 1000 / s.average_speed);
const mean = splitPaces.reduce((a, b) => a + b) / splitPaces.length;
const stddev = Math.sqrt(splitPaces.reduce((s, v) => s + (v - mean)**2, 0) / splitPaces.length);
const pvi = (stddev / mean * 100).toFixed(1);
// Tolkning: <3% utmärkt, 3–6% OK, >6% variabelt (för steady-state)
```

Visa som en rad under splitstabellen:
```
Pace variabilitet: 2.1%  Utmärkt pacingkontroll
```

Dölj för intervalltröpningar (om PaceGap i WorkoutAnalysis > 0.75 min/km).

---

## Fas 2 — Statistiksidan — nya fitness-metriker

**Tidsuppskattning:** 2–3 dagar · Inga schema-ändringar (all data finns)

### 1A — Kadens + Steglängdstrend

**Var:** Under "Fitness"-fliken i `stats-client.tsx`, efter LT/AT-trend.

**Beräkning (server-sidan i `stats/page.tsx`):**
```typescript
// Filtrera löpning med kadensdata senaste 52 veckor
const cadenceRuns = activities.filter(a =>
  /run/i.test(a.sportType) && a.averageCadence && a.averageCadence > 0
);

// Gruppera per vecka, beräkna medel-spm och steglängd
const cadenceByWeek = groupByWeek(cadenceRuns).map(({ week, acts }) => {
  const avgSpm = avg(acts.map(a => a.averageCadence! * 2));
  const avgStrideM = avg(acts.map(a => {
    if (!a.averageCadence || !a.averageSpeed) return null;
    return a.averageSpeed / (a.averageCadence * 2 / 60); // m/steg
  }).filter(Boolean) as number[]);
  return { week, spm: Math.round(avgSpm), strideM: +(avgStrideM.toFixed(2)) };
});
```

**Komponent:** Enkel Recharts linjediagram med två Y-axlar (spm vänster, m höger).

**Separat OL vs Road:** Om sportType = Orienteering (eller innehåller "OL"), separera i legend.

**Tooltip:** "Optimal kadens 170–185 spm. OL-löpning typiskt 155–170 spm (terräng). Stigande steglängd vid stabil kadens = ökad fart utan hårdare ansträngning."

**Mobil:** Enkelt linjediagram skalas bra. Ta bort dubbel-Y-axeln på mobil (<640px) — visa bara spm.

---

### 2A — Efficiency Factor (EF) trend

**Var:** Lägg till ny sektion i Fitness-fliken, bredvid AEI-trenden.

**Beräkning:**
```typescript
// EF = avgSpeed (m/min) / avgHR  — endast easy-runs (HR < LT1)
const lt1HR = fitnessCache?.lt1HR ?? maxHR * 0.76;
const efByWeek = groupByWeek(
  runs.filter(a => a.averageHeartrate && a.averageHeartrate < lt1HR && a.distance > 3000)
).map(({ week, acts }) => ({
  week,
  ef: avg(acts.map(a => (a.averageSpeed! * 60) / a.averageHeartrate!)) // m/min per bpm
}));
```

**Visa:** Rullande 16-veckors linjediagram. Aktuell EF-siffra prominant + % förändring vs 12 veckors snitt.

**Referens att visa i tooltip:** "EF 1.35–1.55 = vältränad löpare i easy-zon. +0.05 under en säsong = signifikant förbättring."

**OBS:** EF och AEI är besläktade men inte identiska (AEI = speed/HR, EF = normalized graded speed/HR). Visa båda om utrymme finns, annars slå ihop.

**Mobil:** Kompakt sparkline-variant under mobil — full chart på desktop.

---

### 2C — Training Monotony + Strain

**Var:** Load-fliken, under TSB-kortet.

**Beräkning:**
```typescript
// Senaste 28 dagar, per vecka
function weeklyMonotony(dailyTSS: Map<string, number>, weekStart: Date): number {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i);
    return dailyTSS.get(d.toISOString().split("T")[0]) ?? 0;
  });
  const mean = days.reduce((s, v) => s + v, 0) / 7;
  const stddev = Math.sqrt(days.reduce((s, v) => s + (v - mean)**2, 0) / 7);
  return stddev === 0 ? 999 : mean / stddev; // hög = monotont
}

const currentMonotony = weeklyMonotony(dailyTSS, currentWeekStart);
const currentStrain = weeklyTSS * currentMonotony;
```

**Visa:**
```
Träningsmonotoni: 1.8  ⚠️ Hög
Träningsstress (Strain): 520 TSS

Tolkning: Hög monotoni (>1.5) = alla träningsdagar likartade.
Variera intensiteten — hård/lätt/vila-mönster minskar skaderisk.
```

Färg: < 1.5 grön, 1.5–2.0 gul, > 2.0 röd.

**Nota om 2024-forskning:** Lägg till i tooltip: "ACWR och monotoni är generella riktmärken, inte individualiserade. Din personliga tolerans kan avvika."

**Mobil:** Enkel kort-layout vid sidan av ramp rate + injury risk (2 per rad).

---

### 2F — Personaliserad återhämtningshastighet

**Vad:** Visa hur många dagar TSB i snitt tar att gå från −20 till 0 (ATL > CTL → CTL > ATL).

**Beräkning (server):**
```typescript
// Hitta alla "trough → recovery"-sekvenser i load-kurvan (sista 2 åren)
const recoveries: number[] = [];
let inTrough = false, troughDay = 0;
for (let i = 1; i < loadCurve.length; i++) {
  if (!inTrough && loadCurve[i].tsb < -15) { inTrough = true; troughDay = i; }
  if (inTrough && loadCurve[i].tsb >= 0) {
    recoveries.push(i - troughDay);
    inTrough = false;
  }
}
const avgRecoveryDays = recoveries.length >= 3
  ? Math.round(avg(recoveries))
  : null;
```

**Visa:** Litet stats-kort: "Din snittliga återhämtningstid: **6 dagar** från TSB −15 till neutral (baserat på 8 tillfällen)"

**Jämförelse med föregående år:** Om data finns — "vs 8 dagar förra säsongen → du återhämtar dig snabbare"

---

### 2I — Heart Rate Recovery (HRR) — STRATEGI: Lazy + cachelagrat

**Svar på frågan:** Strömmar ska **INTE** hämtas för alla aktiviteter automatiskt. Det skulle vara 2000+ Strava API-anrop vid backfill.

**Strategi:**
1. Implementera stream-cache i DB (se Fas 7 / 11C)
2. Streams hämtas **lazy** — redan sker på aktivitetssidan via `ActivityCharts.tsx`
3. **När streams cachas:** extrahera HRR60 vid cache-tillfället → spara i `Activity.hrrSeconds` (nytt fält)
4. HRR60 = `maxHR_during_effort − HR_60s_after_effort_peak`

**Schema-addition (körs med 11C):**
```prisma
// Lägg till i Activity-modellen
hrrSeconds  Int?     // HR drop 60s after peak effort (Heart Rate Recovery)
```

**Beräkning från stream:**
```typescript
// Hitta peak HR-index → ta HR[peak+60s] → differens
const hrStream = streams.heartrate?.data ?? [];
if (hrStream.length > 70) {
  const peakIdx = hrStream.indexOf(Math.max(...hrStream));
  const hrAfter60 = hrStream[Math.min(peakIdx + 60, hrStream.length - 1)];
  const hrr = hrStream[peakIdx] - hrAfter60;
  // Spara till Activity.hrrSeconds
}
```

**Visa:** Per aktivitet (om stream är cachad): "HRR60: 34 bpm ✓ Bra kardiovaskulär kapacitet (>25 = bra, >35 = utmärkt)"

**Trend i stats:** Genomsnitt av HRR60 per månad (bara aktiviteter med cached streams).

---

## Fas 3 — Dashboard idag-panel + Readiness

**Tidsuppskattning:** 2 dagar · Kräver Garmin att vara aktiv för Readiness

### 4A — "Idag"-panel på dashboard

**Var:** Längst upp på dashboard-sidan, ovanför nuvarande kort.

**Innehåll:**

```tsx
// Server: hämta idag-relevant data
const todayActivities = /* aktiviteter med startDateLocal = idag */;
const todayPlan = /* PlannedWorkout med date = idag */;
const garminToday = /* GarminDailySummary för idag */;
const weatherToday = /* Open-Meteo för idag (framtida väder) */;
```

**Renderat:**
```
Tisdag 16 juni — Vecka 25 · BUILD block v3/5

┌─ Planerat idag ──────────────────────────────────┐
│ Tempolöpning 10 km · Z4 · ~55 min                │
│ [Visa i planner] [Markera klart]                  │
└───────────────────────────────────────────────────┘

Väder idag: 18°C · 12 km/h NV · Delvis molnigt
Din pacejustering: +0 sek/km (idealt temperaturfönster)

Form: TSB +6 🟢 · Rekommendation: Lämpligt för kvalitetspass
```

Om ingen plan: Visa bara väder + form-summary.

**Väder (Open-Meteo forecast):**
```typescript
// lib/weather/open-meteo.ts — lägg till forecast-endpoint
// https://api.open-meteo.com/v1/forecast?latitude=...&longitude=...&hourly=temperature_2m,...
// Hämta koordinater från senaste aktivitetens polyline (första punkten)
```

**Pasjustering baserat på BEFINTLIG tempSensitivity:**
```typescript
const adjustSec = analytics?.tempSensitivity
  ? Math.round((forecastTemp - 15) / 5 * analytics.tempSensitivity)
  : null;
```

**Mobil:** Panelen tar full bredd, stackas vertikalt. "Planerat idag" är framträdande — tap öppnar plannermodal.

---

### 4B — Readiness-score (kräver Garmin-data)

**Var:** En card i "Idag"-panelen (4A) eller bredvid TSB-kortet.

**Beräkning:**
```typescript
interface ReadinessInput {
  tsb: number;                    // −40..+40
  hvr7DayTrend: number | null;    // % förändring vs 7-dagarsnitt
  sleepScore: number | null;      // 0–100 (Garmin)
  restingHRVsBaseline: number | null; // bpm avvikelse från 30-dagars snitt
}

function computeReadiness(r: ReadinessInput): { score: number; color: string; label: string } {
  let score = 50; // neutral start
  // TSB component (30%)
  if (r.tsb > 10)       score += 15;
  else if (r.tsb > 0)   score += 8;
  else if (r.tsb < -25) score -= 20;
  else if (r.tsb < -10) score -= 10;
  // HRV trend (40%) — trend är viktigare än absolut värde
  if (r.hvr7DayTrend != null) {
    if (r.hvr7DayTrend > 5)   score += 20;    // stigande HRV = bra
    else if (r.hvr7DayTrend < -15) score -= 25; // kraftigt fall = varning
    else if (r.hvr7DayTrend < -7)  score -= 12;
  }
  // Sleep score (20%)
  if (r.sleepScore != null) {
    score += (r.sleepScore - 60) / 5; // 80 → +4, 60 → 0, 40 → −4
  }
  // RHR vs baseline (10%)
  if (r.restingHRVsBaseline != null) {
    if (r.restingHRVsBaseline > 5) score -= 8;  // >5bpm över baseline = trötthet
    else if (r.restingHRVsBaseline < -3) score += 5;
  }
  score = Math.min(100, Math.max(0, Math.round(score)));
  return {
    score,
    color: score >= 70 ? "#6EE7B7" : score >= 45 ? "#FBBF24" : "#F87171",
    label: score >= 70 ? "Redo" : score >= 45 ? "Moderat" : "Återhämta",
  };
}
```

**Visa:**
```
Readiness: 73/100  🟢 Redo
  HRV trend:  +6% (stigande, bra)
  Sömn:       7.1h, score 76
  TSB:        +6 (Fresh)
  Vila-HR:    42 bpm (normal)
```

**Utan Garmin:** Visa bara TSB-baserad version med disclaimer "Anslut Garmin för fullständig bild".

**Mobil:** Kompakt radlayout: `Readiness 73 🟢 | TSB +6 | HRV ↑ | Sömn 7.1h`.

---

### 4C — Automatiska träningsinsikter (utökade)

**Utöka `lib/fitness/insights.ts`:**

```typescript
// Lägg till i generateInsights():

// Kadensvarning
if (cadenceData && cadenceData.recentAvg < 170) {
  insights.push({ type: "neutral", text: `Kadens senaste veckan: ${cadenceData.recentAvg} spm — något under 170 spm-gränsen. Kan indikera trötthet eller tung terräng.` });
}

// EF-trend
if (efTrend && efTrend.deltaPercent > 5) {
  insights.push({ type: "positive", text: `Aerob effektivitet (EF) förbättrades +${efTrend.deltaPercent.toFixed(1)}% senaste 4 veckorna — tydlig fitnessutveckling.` });
}

// Polariseringsvarning
if (polarisation && polarisation.z2Pct > 25) {
  insights.push({ type: "warning", text: `${Math.round(polarisation.z2Pct)}% av träningstiden i tempozonen (LT1–LT2) — riskerar 'junk miles'. Ersätt med easy-löpning eller threshold.` });
}

// Skadmönster
if (recentInjuries && recentInjuries.kneeCount >= 2 && weeklyKm > 85) {
  insights.push({ type: "warning", text: `Du har haft ${recentInjuries.kneeCount} knärelaterade avbokningar de senaste 6 månaderna — alltid vid veckor >85 km. Aktuell vecka: ${weeklyKm} km.` });
}
```

**Mobil:** Insights visas som en scrollbar horizontal strip under "Idag"-panelen på mobil, som kollapsbar lista på desktop.

---

### 1E — Årsgoal-tracker

**Schema (minimal):**
```prisma
// Lägg till i AthleteProfile (som JSON — undviker ny tabell)
annualGoals  Json?   // { "2026": { "Run": 2000, "Ride": 3000 }, ... }
```

**UI (Settings → Athlete Profile):**
- Enkel tabell per sport: "Ditt mål 2026: [input] km"
- Sparas via `/api/settings/profile`

**Dashboard widget:**
```
2026 — Löpmål: 2000 km
  ████████████░░░░░░░░  825 km (41%)
  På spåret för: 1850 km  (−150 km från mål)

2026 — Cykelmål: 3000 km
  ████████░░░░░░░░░░░░  1180 km (39%)
  På spåret för: 2720 km  ✓
```

**Prognos:** `projectedKm = ytdKm / (dayOfYear / 365.25)`

**Mobil:** Stacked kompakta progress-bars under "Idag"-panelen.

---

## Fas 4 — Aktivitets–Planerat matchning (1C)

**Tidsuppskattning:** 2–3 dagar · Separat beräkningsmodul

### Algoritm — Intentionsklassificering

Nyckelprincipen: matcha baserat på **träningsintention** (stil, syfte, intensitetsnivå) — INTE exakt distans eller tid.

**Steg 1: Klassificera planerat pass-intention:**

```typescript
type WorkoutIntent = "easy" | "aerobic" | "threshold" | "vo2max" | "long" | "race" | "strength" | "other";

function classifyPlannedIntent(pw: PlannedWorkout, template?: WorkoutTemplate): WorkoutIntent {
  const name = (pw.name + " " + (pw.notes ?? "")).toLowerCase();

  // Sportbaserat
  if (/weight|gym|strength|styrka/i.test(pw.sportType)) return "strength";

  // Namnbaserat — tydliga nyckelord
  if (/race|tävl|lopp|sprint.*competition/i.test(name))  return "race";
  if (/long|lång.*löp|lång.*pass/i.test(name))           return "long";
  if (/interval|fartlek|VO2|bana\b/i.test(name))         return "vo2max";
  if (/tempo|tröskel|threshold|LT|tröskelfart/i.test(name)) return "threshold";
  if (/easy|lugn|återhämt|recovery|vila\b/i.test(name))  return "easy";

  // Zonbaserat (från template-sektioner)
  if (template?.estimatedZoneDistribution) {
    const z = template.estimatedZoneDistribution as Record<string, number>;
    const total = Object.values(z).reduce((s, v) => s + v, 0);
    if (total === 0) return "other";
    const z5pct = (z.z5 ?? 0) / total;
    const z4pct = (z.z4 ?? 0) / total;
    const z12pct = ((z.z1 ?? 0) + (z.z2 ?? 0)) / total;
    const totalMin = total / 60;
    if (z5pct > 0.10)              return "vo2max";
    if (z4pct > 0.15)              return "threshold";
    if (totalMin > 80 && z12pct > 0.75) return "long";
    if (z12pct > 0.75)             return "easy";
    return "aerobic";
  }

  // Varaktighetsbaserat (fallback)
  if (pw.targetDuration && pw.targetDuration > 80 * 60) return "long";
  return "other";
}
```

**Steg 2: Klassificera faktisk aktivitets-intention:**

```typescript
function classifyActivityIntent(
  act: Activity,
  maxHR: number,
  lt1HR: number,
  lt2HR: number,
): WorkoutIntent {
  if (/weight|gym|strength/i.test(act.sportType)) return "strength";
  if (act.isRace) return "race";

  const hrFraction = act.averageHeartrate ? act.averageHeartrate / maxHR : null;
  const durationMin = act.movingTime / 60;

  if (hrFraction) {
    if (hrFraction > 0.92 || (act.maxHeartrate ?? 0) > maxHR * 0.96) return "vo2max";
    if (hrFraction > 0.84)  return "threshold";
    if (hrFraction < 0.76 && durationMin > 80) return "long";
    if (hrFraction < 0.76)  return "easy";
    return "aerobic";
  }

  // Utan HR: namnbaserat
  if (/interval|bana|VO2|fartlek/i.test(act.name)) return "vo2max";
  if (/tempo|tröskel/i.test(act.name))             return "threshold";
  if (durationMin > 80) return "long";
  return "other";
}
```

**Steg 3: Matchningslogik med konfidenspoäng:**

```typescript
interface MatchResult {
  plannedId: string;
  activityId: string;
  confidence: number;  // 0–100
  method: "auto" | "intent";
}

function matchActivityToPlanned(
  act: Activity,
  candidates: PlannedWorkout[],  // ± 1 dag, samma sport
  maxHR: number, lt1HR: number, lt2HR: number,
): MatchResult | null {
  const actIntent = classifyActivityIntent(act, maxHR, lt1HR, lt2HR);

  let best: MatchResult | null = null;

  for (const pw of candidates) {
    const pwIntent = classifyPlannedIntent(pw);
    let score = 0;

    // Sport match (hård krav)
    if (!sportTypesCompatible(act.sportType, pw.sportType)) continue;
    score += 40;

    // Intentions-match
    const intentScore = intentCompatibility(actIntent, pwIntent);
    score += intentScore * 30; // 0–30

    // Optionella bonus-faktorer
    if (act.distance && pw.targetDistance) {
      const distRatio = act.distance / pw.targetDistance;
      if (distRatio > 0.8 && distRatio < 1.2) score += 15;
      else if (distRatio > 0.65 && distRatio < 1.35) score += 7;
    }
    if (act.movingTime && pw.targetDuration) {
      const timeRatio = act.movingTime / pw.targetDuration;
      if (timeRatio > 0.8 && timeRatio < 1.2) score += 15;
    }

    if (score > (best?.confidence ?? 0)) {
      best = { plannedId: pw.id, activityId: act.id, confidence: score, method: "intent" };
    }
  }

  return best && best.confidence >= 55 ? best : null;
}

function intentCompatibility(a: WorkoutIntent, b: WorkoutIntent): number {
  if (a === b) return 1.0;
  const compatible: [WorkoutIntent, WorkoutIntent, number][] = [
    ["easy", "aerobic", 0.7],
    ["aerobic", "threshold", 0.4],
    ["threshold", "vo2max", 0.3],
    ["long", "easy", 0.6],
    ["long", "aerobic", 0.5],
  ];
  for (const [x, y, score] of compatible) {
    if ((a === x && b === y) || (a === y && b === x)) return score;
  }
  return 0;
}
```

**Steg 4: Körning:**
- **Auto:** I Strava sync-jobbet (`lib/strava/sync.ts`) — kör matchning direkt efter varje ny aktivitet
- **Webhook:** I `handleEvent()` — kör matchning efter `syncSingleActivity()`
- **Nattlig cron:** Kör `matchUnmatchedActivities(userId)` för att fånga upp gamla

**Steg 5: Statistik-visualisering i Stats-sidan:**

**Heatmap (GitHub-stil, ny sektion i Overview-fliken):**
```typescript
// Beräkna per dag: planned / completed / missed / unplanned_only
type DayCompletion = "completed" | "partial" | "missed" | "unplanned" | "rest";
const completionMap: Map<string, DayCompletion> = buildCompletionMap(
  plannedWorkouts,  // alla planerade pass senaste 52 veckor
  activities,       // alla aktiviteter med matchedPlannedId
);
```

Färgkodning:
- 🟢 Grön = genomfört (auto-match eller manuellt "Completed")
- 🟡 Gul = partial
- 🔴 Röd = missat
- 🔵 Blå = oplanerad aktivitet (ingen plan, men körde)
- ⬜ Grå = vila / ingen data

**Kompletteringsgrad-linje (Week-by-week i Volume-fliken):**
```typescript
// Per vecka: completedPlanned / totalPlanned × 100
const completionRateByWeek = weeklyPlanned.map(({ week, planned, completed }) => ({
  week,
  rate: planned > 0 ? Math.round(completed / planned * 100) : null,
}));
```

Recharts combo: staplar för planerat/genomfört + linje för kompletteringsgrad %.

**Dubbel datakälla — hanteras transparent:**
```
Komplettering baseras på:
  ✓ Manuella markeringar i planner (OutcomeModal)
  ✓ Automatisk aktivitetsmatchning (intentionsbaserat)
  Konflikt: manuell status vinner
```

**Mobil:** Heatmap scrollas horisontellt (`overflow-x-auto`). Kompletteringsgrad visas som siffra + färgkodad punkt i veckosummeringsraden i planner-kalendern.

---

## Fas 5 — Planner-förbättringar

**Tidsuppskattning:** 3–4 dagar · 5A och 5B kan göras parallellt

### 1D — Block-editor modal

> ✅ **REDAN KLAR** — `components/planner/BlockEditorModal.tsx` är fullt implementerad.
> Har: namn, typ (base/build/peak/taper/custom/race), färg-swatch, datumintervall, mål km/v, target-race-dropdown, noteringar.
> Används i `planner-client.tsx` rad 572–574.
> **Inget att implementera.**

---

### 5A — Drag-and-drop i planner

`@dnd-kit/core` och `@dnd-kit/sortable` är **redan installerade**.

**Två DnD-interaktioner:**

**A) Flytta planerat pass till annan dag (kalender → kalender):**
```tsx
// PlannerCalendar.tsx — wrappa i <DndContext>
// Varje dag-cell = <Droppable> med id=dateString
// Varje WorkoutPill = <Draggable> med data = { workoutId, date }

function onDragEnd({ active, over }: DragEndEvent) {
  if (!over || active.id === over.id) return;
  const workoutId = active.data.current?.workoutId;
  const targetDate = over.id as string;
  // PATCH /api/planner/workouts/[id] → { date: targetDate }
  // Optimistisk UI: flytta lokalt, kör API i bakgrunden
}
```

**B) Dra template-kort till kalenderdag (sidebar → kalender):**
```tsx
// TemplateCard.tsx — gör till <Draggable> med type="template"
// Dag-celler accepterar drops från type="template"
// onDrop: skapar PlannedWorkout via POST /api/planner/workouts

function onDragEnd({ active, over }: DragEndEvent) {
  if (active.data.current?.type === "template" && over) {
    const templateId = active.data.current.templateId;
    const date = over.id as string;
    createWorkout({ templateId, date }); // befintlig funktion i planner-client.tsx
  }
}
```

**Visuell feedback:**
- Dragging: Workout pill halvtransparent
- Hover över dag: dag-cellen highlightas (blå border)
- Template-kort: cursor: grab

**Mobil:** DnD fungerar dåligt på touch utan extra arbete. Lägg till long-press som alternativ:
- Long press (500ms) på workout pill → visa "Flytta"-ikon → tap på target-dag
- `@dnd-kit/core` stöder `TouchSensor` — aktivera det

**OBS:** På mobil, prioritera long-press-to-move framför swipe-DnD (swipe kolliderar med sidscrollning).

---

### 5B — Detail Panel (Week/Block/Plan-flikar)

**Trigger:** Klick på veckosummering (`WeekSummaryStrip.tsx`) → slide-in panel från höger (desktop) eller bottom sheet (mobil).

**Komponent:** `DetailPanel.tsx` (skelettet finns, flikarna saknas)

**Datastruktur:**
```typescript
interface DetailPanelData {
  week: {
    start: Date; end: Date;
    volumeBySport: Record<string, { km: number; timeSec: number }>;
    zoneDistribution: Record<string, number>;
    plannedSessions: number; completedSessions: number;
    qualitySessions: number; totalTSS: number;
  };
  block?: {
    name: string; type: string; weekInBlock: number; totalWeeks: number;
    targetKmPerWeek: number; actualKmPerWeek: number;
    completionRate: number;
  };
  season?: {
    blocks: TrainingBlock[];
    nextRace: { name: string; date: Date; weeksOut: number } | null;
    estimatedPeakCTL: number;
  };
}
```

**Week-flik:**
```
Vecka 25 · 16–22 juni · BUILD block v3/5

Volym per sport:
  Löpning   ████████████░░  82 km · 6h 45min
  Cykling   ███░░░░░░░░░░░  45 km · 1h 20min

Zondistribution:
  Z1 Easy      ██████████  52%
  Z2 Aerobic   ████        18%
  Z3 Tempo     ██           8%
  Z4 Threshold █████       15%
  Z5 VO2max    ███          7%

Intensitet: Easy 70% · Hard 30%   (svagt hög, BUILD-fas)
Komplettering: 4/5 pass ✓  (1 missat - Trötthet)
```

**Block-flik:**
```
BUILD block · v3/5 veckor
Mål: 80 km/vecka · Polariserat

Faktiskt: 76 km snitt (−5%) · 78/80/82 km per vecka
Polarisering: 76% lätt (mål 80%) — nära

████████████░  vecka 1: 78km
█████████████  vecka 2: 80km
████████████░  vecka 3 (nu): 82km ← 
```

**Plan-flik:**
```
Säsongsöversikt

BASE     ████ Jan–Feb  ✓ 258 km · TSS 890
BUILD 1  ████ Mar      ✓ 312 km · TSS 1180
BUILD 2  ████ Apr–nu  ← nuvarande

🏁 Stockholm Marathon  25 maj — 6 veckor kvar

PEAK     ████ Apr 28–  2 veckor | Mål: 90 km/v
TAPER    ████ Maj 12–  2 veckor | −30% volym

Uppskattad peak-CTL: 72 (nu: 64)
```

**Mobil:** Bottom sheet (slides upp från botten, swipe-ner stänger). `framer-motion` för smooth animation, eller enkel CSS transition.

---

### 5D — Taper-automatik

**Vad:** Automatisk taper-startmarkering i kalendern baserat på närmaste A-tävlings datum och distans.

**Logik:**
```typescript
function taperStartDate(raceDate: Date, distanceLabel: string): Date {
  const weeks = distanceLabel.includes("Marathon") ? 3
    : distanceLabel.includes("Half") ? 2
    : distanceLabel.includes("10K") || distanceLabel.includes("15K") ? 1.5
    : 1; // 5K och kortare
  const d = new Date(raceDate);
  d.setDate(d.getDate() - Math.round(weeks * 7));
  return d;
}
```

**Visa i kalender:** En linje/markör i veckovyn med texten "Taper start" på rätt datum. Kräver att `PlannedRace` innehåller `distanceLabel` — lägg till om saknas.

**Mobil:** Detsamma som desktop — det är en kalendermarkering.

---

## Fas 6 — AI slash-kommandon

**Tidsuppskattning:** 1–2 dagar · Bygger på befintlig `lib/ai/tools.ts` och chat-UI

### 5C — /plan-kommando (AI-genererad träningsplan)

**Trigger:** Användaren skriver `/plan [tävling] [datum]` i coachen eller klickar "Planera träning"-knapp.

**Implementering i `ChatInterface.tsx`:**
```tsx
// Detektera /plan i input
if (input.startsWith("/plan")) {
  const args = input.slice(5).trim();
  // Ersätt med strukturerad prompt
  const enrichedMessage = `
    Skapa en träningsplan för: ${args}
    
    Nuläge: CTL ${ctx.ctl}, TSB ${ctx.tsb}, VDOT ${ctx.vdot}
    Tillgängliga veckor: ${weeksUntilRace} veckor
    Nuvarande block: ${ctx.currentBlock ?? "inget"}
    
    Svara med ett plan-action JSON-block för de närmaste veckorna.
  `;
  submitMessage(enrichedMessage);
}
```

**Parser för `plan-action`-svar** (finns i `lib/ai/tools.ts`):
```typescript
// Befintlig spec: ```plan-action\n[{date, name, sportType, ...}]```
// Utöka parsern att hantera veckovis struktur:
// [{ week: "2026-W25", sessions: [{...}, {...}] }]
```

**Preview-modal:** Innan import → visa alla genererade pass som en lista + `[Importera alla]` knapp.

**Mobil:** Knapparna visas som ett suggestions-fält under chat-input (scrollbart horisontellt): `[/plan] [/analyze] [/taper]`.

---

### 7D — Kontextuella promptmallar med /kommandon

> ✅ **Tool-picker-grunden är klar** — `ChatInterface.tsx` öppnar redan en dropdown vid `/` med 12 verktyg och exempeltexter.
> **Kvar att implementera:** Lägg till namngivna `/plan`, `/taper`, `/analyze`-templates med strukturerade mallar.

**Utöka befintlig `TOOLS`-lista i `ChatInterface.tsx`** med section för "Preset prompts":

```tsx
// Lägg till i tool-listan (efter befintliga verktyg, eget avsnitt)
{ name: "preset_plan",     label: "/plan — Träningsplan",
  desc: "Planera de närmaste veckorna mot din nästa tävling",
  hint: "Planera de närmaste 8 veckorna inför [tävling]. Jag vill jobba på [fart/volym/uthållighet]." },
{ name: "preset_analyze",  label: "/analyze — Analysera pass",
  desc: "Djupanalys av ett specifikt träningspass",
  hint: "Analysera mitt senaste [löpning/tempopass/intervall]. Vad gick bra och vad kan förbättras?" },
{ name: "preset_taper",    label: "/taper — Taper-schema",
  desc: "Optimalt taper-schema inför tävling",
  hint: "Skapa ett taper-schema inför [tävling] om [antal] dagar. Vad är mitt optimala TSB på tävlingsdagen baserat på mina tidigare resultat?" },
{ name: "preset_week",     label: "/week — Veckosummering",
  desc: "AI-summering av förra veckan + råd",
  hint: "Summera förra veckan och ge råd för den kommande veckan baserat på min form och plan." },
```

**Placeholders:** Markera `[tävling]`, `[antal]` etc med selectAll när texten inserteras, så användaren direkt kan skriva över dem.

**Mobil:** Befintlig dropdown fungerar på mobil — inga extra ändringar krävs.

**Notera:** `/`-interfacet stöder redan tangentbords-navigation (Enter, Escape) — detta återanvänds.

---

### 7E — /summarize — konversationssammandrag

**Trigger:** `/summarize` i chatten ELLER auto-trigger när konversationen > 20 meddelanden.

**Implementering:**
```typescript
// api/coach/summarize/route.ts — ny endpoint
async function summarizeConversation(conversationId: string, userId: string) {
  const messages = await prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
    take: 30,
  });
  
  const summary = await aiClient.chat([{
    role: "user",
    content: `Sammanfatta de viktigaste slutsatserna från denna träningsdiskussion i 5–8 punkter. 
    Fokusera på: beslut som togs, träningsrekommendationer, identifierade mönster.
    Konversation:\n${messages.map(m => `${m.role}: ${m.content}`).join("\n")}`
  }]);
  
  // Spara som ett system-message med role="summary"
  await prisma.message.create({
    data: { conversationId, role: "summary", content: summary, /* ... */ }
  });
}
```

**Visa:** Sammandrag-meddelanden visas med en speciell bakgrund (grå/indigo) och etikett "Sammanfattning".

**Auto-komprimering:** Om konversation > 20 meddelanden: bifoga bara de senaste 10 + senaste sammandraget till API-anrop (istf alla 30).

**Mobil:** Sammandragmeddelandet har `[Expandera]` toggle för att visa/dölja.

---

## Fas 7 — Infrastructure & Tech Debt

**Tidsuppskattning:** 2 dagar · Fundament för 2I (HRR)

### 11C — Activity stream-caching i DB

**Schema:**
```prisma
model ActivityStream {
  id         String   @id @default(cuid())
  activityId String   @unique
  fetchedAt  DateTime @default(now())
  // Strava stream arrays — JSON
  time       Json?    // seconds[]
  distance   Json?    // meters[]
  altitude   Json?    // meters[]
  heartrate  Json?    // bpm[]
  velocity   Json?    // m/s[]
  cadence    Json?    // rpm[]
  watts      Json?    // power[]
  
  activity   Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
}
```

**Lägg till relation i Activity:**
```prisma
stream ActivityStream?
```

**Modifiera `ActivityCharts.tsx`:**
- Kontrollera om `ActivityStream` finns i DB → använd direkt
- Annars: hämta från Strava → spara → returnera

```typescript
// api/activities/[id]/streams/route.ts
const cached = await prisma.activityStream.findUnique({ where: { activityId: id } });
if (cached) return Response.json(cached);

// Hämta från Strava
const streams = await stravaClient.getActivityStreams(stravaId, userId);
// Extrahera HRR60 och spara till activity
const hrr = extractHRR60(streams.heartrate?.data);
await prisma.$transaction([
  prisma.activityStream.create({ data: { activityId: id, ...streams } }),
  ...(hrr != null ? [prisma.activity.update({ where: { id }, data: { hrrSeconds: hrr } })] : []),
]);
return Response.json(streams);
```

**Storlek:** ~200 aktiviteter × ~50KB = 10MB. 2000 aktiviteter ≈ 100MB. Acceptabelt för PostgreSQL.

---

### 11B — Strava token refresh race condition

**Problem:** Om token expirar och två parallella anrop görs → dubbel refresh mot Strava.

**Fix i `lib/strava/client.ts`:**
```typescript
// Singleton per userId — dela pågående refresh-löfte
const refreshPromises = new Map<string, Promise<string>>();

async function ensureFreshToken(userId: string): Promise<string> {
  const account = await prisma.stravaAccount.findUnique({ where: { userId } });
  if (account && account.expiresAt > new Date(Date.now() + 60_000)) {
    return account.accessToken; // fortfarande giltig
  }
  
  // Återanvänd pågående refresh om det finns
  const existing = refreshPromises.get(userId);
  if (existing) return existing;
  
  const refreshPromise = doRefresh(userId).finally(() => {
    refreshPromises.delete(userId);
  });
  refreshPromises.set(userId, refreshPromise);
  return refreshPromise;
}
```

---

### 8C — Backfill-optimering

**Prioritering:** Senaste 90 dagarna genomförs ALLTID först.

Modifiera `lib/strava/backfill-runner.ts`:
```typescript
// Kör i två faser:
// Fas A: Aktiviteter senaste 90 dagar (prioritet, inkl. streams)
// Fas B: Äldre aktiviteter (bakgrund, bara metadata)
async function prioritizedBackfill(userId: string) {
  const recent = await getActivitiesWithoutSplits(userId, 90); // dagar
  for (const act of recent) {
    await backfillSplitsForActivity(act);
    await backfillWeatherForActivity(act);
  }
  // Sedan äldre
  const older = await getActivitiesWithoutSplits(userId, 9999);
  for (const act of older) {
    await backfillSplitsForActivity(act);
    // Väder kan vänta — körs i separat job
  }
}
```

**ETA i UI:** Beräkna baserat på Strava-rate-limit:
```
Återstår: 847 aktiviteter · Strava-limit: 200/15min → ~1.5h
```

---

### 9F — Aktivitetslista-förbättringar

**Sortering:** Lägg till dropdown `Sortera: Senaste | Distans ↓ | Distans ↑ | Pace ↓`

**Filter:** Lägg till en expanderbar filterrad:
- Datumintervall (from/to date picker)
- Min/max distans
- Bara tävlingar (checkbox)
- Bara med lap-data (checkbox)

**Snabb-stats per rad:**
```
Löpning lördag · 18 km · 1:22:14 · 4:34/km · HR 148  [VDOT-zon badge: Aerob]
```

Pace färgkodas mot användarens VDOT-zoner (grön = easy, orange = threshold, etc.)

**Mobil:** Filtren döljs bakom en "Filter"-knapp. Sortering via en kompakt dropdown.

---

### 9G — Kartlager (mörkt/ljust läge)

> ✅ **REDAN KLAR** — `activity-map.tsx` rad 49–51 använder redan CartoDB tiles:
> ```typescript
> const tileTheme = resolvedTheme === "light" ? "light_all" : "dark_all";
> L.tileLayer(`https://{s}.basemaps.cartocdn.com/${tileTheme}/{z}/{x}/{y}{r}.png`, ...)
> ```
> Mörkt och ljust läge fungerar korrekt. **Inget att implementera.**

---

### 9H — Paceenhet-inställning

**Schema:**
```prisma
// Lägg till i AthleteProfile eller AppConfig
paceUnit  String @default("min_per_km")  // "min_per_km" | "min_per_mi" | "km_h"
```

**Helpers i `lib/utils.ts`:**
```typescript
export function formatPaceUnit(mps: number, unit: string): string {
  if (unit === "km_h")      return `${(mps * 3.6).toFixed(1)} km/h`;
  if (unit === "min_per_mi") return formatMinPerMile(mps);
  return formatPace(mps); // befintlig min/km
}
```

**Tillämpning:** Ersätt alla `formatPace()` anrop med `formatPaceUnit(speed, user.paceUnit)`.

**Inställning:** Settings → Athlete Profile → "Paceenhet" radio: `min/km | min/mi | km/h`

---

### 9D — Progressive Web App (PWA)

**Implementering:**
```bash
pnpm add next-pwa
```

`next.config.ts`:
```typescript
import withPWA from "next-pwa";
export default withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
})(nextConfig);
```

`public/manifest.json`:
```json
{
  "name": "TrainingLab",
  "short_name": "TrainingLab",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0F1117",
  "theme_color": "#6EE7B7",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Skapa ikonerna (192×192 och 512×512) med TrainingLab-logotypen.

**Offline-cache:** Statiska assets + senaste stats-sidan (stale-while-revalidate).

**Mobil-effekt:** "Lägg till på hemskärm"-prompt på iOS/Android. Appen öppnas utan webbläsarens URL-fält — känns som native app.

---

## Fas 8 — Jämförelsevy (1F) — utökning

**Tidsuppskattning:** 1 dag (grundstrukturen finns)

> ✅ **Delvis klar** — `stats/volume/volume-client.tsx` har Period A/B-jämförelse med bar-chart och summering av km, tid och TSS. Period-väljare (month-inputs) + YTD-equalization fungerar.
> **Saknar:** CTL/ATL peak, VO2max-snitt per period, kompletteringsgrad.

**Kvar att lägga till i `stats/volume/volume-client.tsx`** (eller ny tab i stats-sidan):

Utöka `periodSummaries` med:
```typescript
const periodSummaries = useMemo(() => {
  // Befintliga fält: totalKm, totalTSS, sessions
  // NYA fält:
  const peakCTL = Math.max(...loadCurveForPeriod.map(d => d.ctl));
  const avgVO2max = avg(vo2maxByMonth.filter(v => v.month >= start && v.month <= end));
  const completionRate = completedPlanned / totalPlanned * 100;
  return { ...existing, peakCTL, avgVO2max, completionRate };
}, [records, periodA, periodB, ...]);
```

Visa i befintlig period-summary-tabell:
```
               Period A     Period B      Δ
Distans:       312 km       285 km       +9.5% ✓
CTL peak:       72           66          +9%
VO2max snitt:  53.2         51.8         +2.7%
Komplettering: 89%          82%          +7pp
```

**Mobil:** Befintlig layout är redan responsive — ny data läggs till i befintlig tabell.

---

## Fas 9 — Sammanfattning och prioriteringsordning

### Fas A: Snabbaste vinsterna (1–2 timmar styck)
1. **3E** GAP på aktivitetssidan
2. **3C** PB-highlight
3. **3F** Prev/Next navigation
4. **1B** Pa:HR per aktivitet (exportera `computeDrift`)
5. **2B** PVI i splits-tabellen
6. **7C** Svensk coach-toggle i UI (koden stöder redan SV)

### Fas B: Stats-metriker (1–2 dagars arbete, parallellt)
7. **1A** Kadens + steglängdstrend
8. **2A** Efficiency Factor trend
9. **2C** Training Monotony + Strain
10. **2F** Återhämtningshastighet
11. **1E** Årsgoal-tracker

### Fas C: Dashboard (2 dagar)
12. **4A** "Idag"-panel
13. **4B** Readiness-score
14. **4C** Utökade insikter

### Fas D: Planner (2–3 dagar, 1D är klar)
15. ~~**1D** Block-editor modal~~ ✅ KLAR
16. **5A** Drag-and-drop
17. **5B** Detail Panel flikar
18. **5D** Taper-automatik

### Fas E: AI + completion tracking (2–3 dagar)
19. **1C** Aktivitets-matchning + statistik
20. **5C** /plan-kommando
21. **7D** /taper, /analyze kommandon
22. **7E** /summarize

### Fas F: Infrastructure (2 dagar)
23. **11C** Stream-caching + **2I** HRR
24. **11B** Token refresh fix
25. **8C** Backfill-prioritering
26. **9F** Aktivitetslista-filter

### Fas G: Polish (< 1 dag, 9G är klar)
27. ~~**9G** Dark map tiles~~ ✅ KLAR
28. **9H** Paceenhet-toggle
29. **9D** PWA

### Fas H: Jämförelsevy (1 dag, grunden finns)
30. **1F** Period A vs B — utöka befintlig volymjämförelse med CTL/VO2max/completion

---

## Schema-ändringar totalt (samlade)

```prisma
// Activity — nya fält
hrrSeconds      Int?     // HRR60 — extraheras från stream vid caching

// Nytt: ActivityStream
model ActivityStream {
  id         String   @id @default(cuid())
  activityId String   @unique
  fetchedAt  DateTime @default(now())
  time       Json?
  distance   Json?
  altitude   Json?
  heartrate  Json?
  velocity   Json?
  cadence    Json?
  watts      Json?
  activity   Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
}

// AthleteProfile — nya fält
annualGoals Json?    // { "2026": { "Run": 2000 }, ... }
paceUnit    String   @default("min_per_km")

// AppConfig — redan existerande tabellen, om den saknar:
// (kontrollera om stravaAutoSyncMode, stravaWebhookSubscriptionId redan finns)
```

Deploy: `prisma db push` krävs (inga migrations i detta projekt).

---

## Mobil-first checklista (gäller alla faser)

- [ ] Touch-target ≥ 44×44px på alla knappar
- [ ] DnD: long-press 500ms på mobil (istf drag)
- [ ] Modaler: full-screen bottom sheet på mobil
- [ ] Charts: scrollbara horizontellt om för breda (`overflow-x-auto`)
- [ ] Date inputs: native `<input type="date">` på mobil
- [ ] Slash-commands: förslag-strip under chat-input
- [ ] Heatmap: scroll horizontellt (`overflow-x-auto`) på mobil
- [ ] "Idag"-panel: framträdande, first-fold på mobil
- [ ] PWA manifest + service worker (Fas G)

---

*Plan skapad 2026-06-16. Inga kod-ändringar gjorda.*
