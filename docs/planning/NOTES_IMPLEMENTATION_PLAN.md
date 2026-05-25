# TrainingLab — NOTES.md Implementations Plan

> Skapad: 2026-05-25  
> Baserad på: `docs/planning/NOTES.md`  
> Verifierade i kod före skrivning av plan — alla filer, radnummer och nulägen stämmer.

---

## Innehåll

1. [Bugg-audit](#1-bugg-audit)
2. [Snabbfixar — buggar](#2-snabbfixar--buggar)
3. [Medelstora features](#3-medelstora-features)
4. [Stora features](#4-stora-features)
5. [Avancerade / framtida](#5-avancerade--framtida)
6. [Dokumentationsuppdateringar](#6-dokumentationsuppdateringar)
7. [Verifiering, bygge och deployment](#7-verifiering-bygge-och-deployment)

---

## 1. Bugg-Audit

Genomgång av alla items i NOTES.md, verifierat mot källkod.

### BUG-01 — HR-zondiagram tooltip: svart text på mörk bakgrund ✅ Bekräftad
- **Fil:** `components/charts/HRZonesChart.tsx:37`
- **Nuläge:** `contentStyle={{ backgroundColor: "var(--surface)", border: ..., fontSize: 12 }}` — **saknar `color`**. Recharts ritar text med webbläsarens default (svart), syns knappt mot `var(--surface)` (mörk bakgrund).
- **Samma problem i:** `WeeklyVolumeChart.tsx:62`, `TrainingLoadChart.tsx:35`
- **Fix:** Lägg till `color: "var(--color-text-primary)"` i alla `contentStyle`.

### BUG-02 — Activity History: saknar länk till aktivitetsdetalj ✅ Bekräftad
- **Fil:** `app/(dashboard)/history/history-client.tsx:131–161`
- **Nuläge:** Aktivitetskort i dagsvyn är `<div>`, ej klickbara. `id`-fältet finns i Activity-interface och SELECT-queryn. `stravaId` saknas dock i queryn (behövs för extern länk).
- **Fix:** Wrappa varje aktivitetskort med `<Link href={/activities/${a.id}}>`. Lägg till `stravaId: true` i `history/page.tsx`-queryn om extern Strava-länk önskas.

### BUG-03 — Planner: drag/drop blockeras ej på historiska dagar ✅ Bekräftad
- **Fil:** `components/planner/PlannerCalendar.tsx:164–180`
- **Nuläge:** `isPast = key <= today` sätts korrekt, men `onDrop`-handleren (rad 175–180) kollar inte `isPast` innan drop accepteras. Templates kan således droppas på gamla dagar.
- **Fix:** Inuti `onDrop`: returnera tidigt om `key <= today`.

### BUG-04 — Splits chart: bars saknas för korta laps ✅ Bekräftad
- **Fil:** `app/(dashboard)/activities/[id]/splits-chart.tsx:34`
- **Nuläge:** `validSplits = splits.filter(s => s.average_speed > 0 && s.moving_time > 0 && s.distance > 200)` — kravet `distance > 200` silently filtrerar bort mycket korta laps (t.ex. sprint-intervaller < 200m, start-lap). Om detta tar bort majoriteten av bars ser chart ut att vara trasig.
- **Fix:** Sänk tröskeln till `distance > 50` (tillåter allt utom noll-rader), eller ta bort distansgränsen helt (speed/time-skyddet räcker).

### BUG-05 — Info-tooltips kan döljas av förälder med overflow:hidden ✅ Bekräftad
- **Fil:** `components/stats/metric-tooltip.tsx:25`
- **Nuläge:** Tooltip är `absolute z-50 bottom-full` — positioneras relativt närmaste `.relative`-förälder. Om något förälderelement i render-trädet har `overflow: hidden` klipps tooltip. Stats-kort har inte `overflow: hidden` men sidebar har `overflow-y-auto` (stänger av klippning för sidebar-items).
- **Konkret risk:** På smala viewports kan tooltip läcka utanför `main` och klippas av `overflow-y-auto` på `<main>`.
- **Fix:** Byt till portals med `fixed` positionering, eller sätt `overflow: visible` på samtliga container-föräldrarna. Enklast: ändra från `absolute` till `fixed` och beräkna position via `getBoundingClientRect()`.

### BUG-06 — Chat-sidebar: möjlig scroll-konflikt ⚠️ Delvis verifierad
- **Fil:** `components/coach/ChatInterface.tsx:224–283`
- **Nuläge:** Yttre sidebar-wrapper: `overflow-hidden`. Inner conversations-list: `flex-1 overflow-y-auto`. Korrekt isolering i teorin. Men om `ChatInterface` renderas inuti `<main className="overflow-y-auto">` utan fast höjd kan sidans scroll dominera istället för panelernas inre scroll.
- **Root cause:** `ChatInterface` använder `h-full` (rad 221) — kräver att föräldern har explicit höjd. Dashboard-layoutens `main` är `flex-1 overflow-y-auto` (fungerar) men `div.max-w-7xl p-6` inuti saknar `h-full` → ChatInterface:s `h-full` ärver 0 eller auto.
- **Fix:** Lägg till `h-full` på `div.max-w-7xl` i `app/(dashboard)/layout.tsx`, ELLER gör coach-sidan layout-specifik utan max-w-wrapper.

---

## 2. Snabbfixar — Buggar

Ordning: säkrast → mest komplex.

### Fix 1: HR-tooltip textfärg
**Fil:** `components/charts/HRZonesChart.tsx`, `WeeklyVolumeChart.tsx`, `TrainingLoadChart.tsx`  
**Ändring:** Lägg till `color: "var(--color-text-primary)"` i varje `contentStyle`-objekt.
```tsx
// Före
contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
// Efter
contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--color-text-primary)" }}
```
> **Notera:** Tailwind-temat exponerar CSS-variabler — kontrollera exakt variabelnamn i `globals.css` om `--color-text-primary` inte finns, alternativt använd `color: "white"`.

---

### Fix 2: Activity History — klickbara aktivitetskort
**Fil:** `app/(dashboard)/history/page.tsx` + `history-client.tsx`

**page.tsx:** Lägg till `stravaId: true` i select för att stödja extern länk.

**history-client.tsx:**
1. Lägg till `stravaId: bigint` i `Activity`-interface.
2. Wrappa aktivitetskort-`<div>` med `<Link href={/activities/${a.id}} className="block ...">`.
3. Lägg till Strava-länk-ikon (ExternalLink) i övre högra hörnet av kortet om `stravaId` finns.
```tsx
<Link href={`/activities/${a.id}`} className="block rounded-xl border border-border p-4 hover:border-accent/40 transition-colors" style={...}>
  {/* befintligt kortinnehåll */}
  <a href={`https://www.strava.com/activities/${a.stravaId}`} ... onClick={e => e.stopPropagation()}>
    <ExternalLink size={12} />
  </a>
</Link>
```

---

### Fix 3: Planner — blockera drop på historiska dagar
**Fil:** `components/planner/PlannerCalendar.tsx`

Inuti `onDrop`-handler:
```tsx
onDrop={e => {
  e.preventDefault();
  setDragOverDate(null);
  if (key <= today) return; // ← lägg till denna rad
  const templateId = e.dataTransfer.getData("templateId");
  if (templateId && onTemplateDrop) onTemplateDrop(templateId, key);
}}
```
Dessutom: visuellt markera förflutet datum som ej möjlig droptarget — ta bort `onDragOver`-highlight för `isPast`-dagar:
```tsx
onDragOver={e => {
  if (key <= today) return; // ← lägg till
  e.preventDefault();
  ...
}}
```

---

### Fix 4: Splits chart — sänk distanströskel
**Fil:** `app/(dashboard)/activities/[id]/splits-chart.tsx:34`
```tsx
// Före
const validSplits = splits.filter(s => s.average_speed > 0 && s.moving_time > 0 && s.distance > 200);
// Efter
const validSplits = splits.filter(s => s.average_speed > 0 && s.moving_time > 0 && s.distance > 10);
```

---

### Fix 5: Info-tooltip overflow-fix
**Fil:** `components/stats/metric-tooltip.tsx`

Ändra från `absolute` till `fixed` med positionering via JS `getBoundingClientRect`:
```tsx
// Nuläge
"use client";
import { useState, useRef } from "react";
// Tillstånd för position
const [pos, setPos] = useState<{top: number; right: number} | null>(null);
const btnRef = useRef<HTMLButtonElement>(null);

function show() {
  const r = btnRef.current?.getBoundingClientRect();
  if (r) setPos({ top: r.top - 8, right: window.innerWidth - r.right });
  setOpen(true);
}

// Tooltip-div: byt absolute → fixed, bottom-full → top beräknad
<div className="fixed z-[200] ..." style={{ top: pos.top, right: pos.right, transform: 'translateY(-100%)' }}>
```
> Alternativ snabbare fix: lägga `overflow: visible !important` på alla stat-kort-wrapprar. Välj den enklare om portals tar för lång tid.

---

### Fix 6: Chat-layout höjd
**Fil:** `app/(dashboard)/layout.tsx`

```tsx
// Före
<div className="max-w-7xl mx-auto p-6">{children}</div>
// Efter
<div className="max-w-7xl mx-auto p-6 h-full">{children}</div>
```
Kontrollera att coach-sidan fungerar efter detta (ChatInterface förlitar sig på `h-full`). Andra sidor påverkas ej negativt eftersom de inte har `h-full`-beroende.

---

## 3. Medelstora Features

### Feature A: Laps-tabell — lap-tid och kumulativ elapsed

**Fil:** `app/(dashboard)/activities/[id]/splits-table.tsx`

**Ny data som visas:**
- **Lap-tid** = `moving_time` formaterat som `m:ss` (redan i data, visas bara som pace idag — lägg till dedikerad kolumn)
- **Kumulativ tid** = löpande summa av `moving_time` för alla föregående laps, formaterat som `h:mm:ss`

**Implementering:**
```tsx
// Beräkna kumulativ tid
let cumulative = 0;
// I render-loopen:
cumulative += s.moving_time;
const cumulativeStr = formatDuration(cumulative);
const lapTimeStr = `${Math.floor(s.moving_time/60)}:${String(s.moving_time%60).padStart(2,'0')}`;
```
Lägg till kolumnhuvuden: `"Tid"` och `"Total"`.

**Kolumnordning (laps):** Lap | Dist | Tid | Total | Pace | [bar] | HR | Elev

---

### Feature B: Best Efforts i aktivitetsdetalj

**Vad:** Lista med aktivitetens snabbaste sträckor — samma distanser som spåras i PB-trackern (1500m, 3K, 5K, 10K, HM, Marathon m.fl.).

**Strava-data:** `bestEfforts`-fältet (JSON) lagras redan i DB från `backfill-descriptions/route.ts:50`. Fältet hämtas redan i `activity/[id]/page.tsx:32`.

**Strava best_efforts-struktur:**
```json
[{ "name": "5K", "elapsed_time": 1245, "distance": 5000, "start_date_local": "..." }]
```

**Implementering i `page.tsx`:**
```tsx
interface BestEffort { name: string; elapsed_time: number; distance: number; }
const bestEfforts = (activity.bestEfforts as BestEffort[] | null)
  ?.filter(e => e.elapsed_time > 0)
  ?.sort((a, b) => a.distance - b.distance) ?? null;
```

**Ny sektion i UI** (under laps-tabell):
```tsx
{bestEfforts && bestEfforts.length > 0 && (
  <div className="rounded-xl border border-border overflow-hidden">
    <div className="px-4 py-3 border-b border-border bg-surface-2">
      <p className="text-sm font-semibold text-primary">Bästa sträckor</p>
    </div>
    <table>...{bestEfforts.map(e => <tr><td>{e.name}</td><td>{formatDuration(e.elapsed_time)}</td></tr>)}</table>
  </div>
)}
```
Jämför mot PB (från `raceRecord`-tabellen) om möjligt — visa grön/röd indikator.

---

### Feature C: Performance charts — distans/tid-växling på x-axeln

**Fil:** `app/(dashboard)/activities/[id]/activity-charts.tsx`

**Nuläge:** Endast `distKm` som x-axel. Strava streams-APIet returnerar `time`-stream (sekunder från start) — redan hämtat i `streams/route.ts:33`.

**Implementering:**
1. Lägg till `timeSec: number` i `StreamPoint`-interface.
2. Spara `time[i]` i varje punkt från streams-svaret.
3. Lägg till toggle-state: `const [xMode, setXMode] = useState<"dist" | "time">("dist")`.
4. Byt `dataKey` och `tickFormatter` på `XAxis` baserat på `xMode`.
5. Visa toggle-knapp bredvid de befintliga serie-knapparna.
```tsx
// XAxis-switch
<XAxis
  dataKey={xMode === "dist" ? "distKm" : "timeSec"}
  tickFormatter={xMode === "dist" ? v => `${v}km` : v => `${Math.floor(v/60)}:${String(Math.round(v%60)).padStart(2,'0')}`}
/>
```

---

### Feature D: Activity History — UI som Planner-sidan

**Nuläge:** `history-client.tsx` är redan en månadskalender med dagsselektion. Planner är en veckokalender med WorkoutPills per dag. Användaren vill att History ska likna Planner visuellt.

**Skillnader att harmonisera:**
- Planner visar **vecka** (7 dagar, horisontell grid, `grid-cols-7`). History visar **månad** (~42 dagar).
- Planner: varje dag har WorkoutPills med sport-ikon, namn, kort info. History: bara färg-pills.
- Båda: selektion av dag visar detaljer.

**Plan:** Behåll månadsvisningen (naturlig för historik) men uppgradera dag-cellerna:
- Ersätt enkla färg-pills med mini-kort (liknar WorkoutPill `compact`-läge): sport-ikon, aktivitetens namn (trunkerat), distans/tid.
- Göm distans/tid på <400px celler med `hidden sm:block`.
- Bevara befintlig dag-detalj-panel (fungerar bra).
- Lägg till klickbara länkade aktivitetskort i dag-detaljpanelen (Fix 2).

---

## 4. Stora Features

### Feature E: Mobil-UX — responsiv navigation och layout

**Nuläge:** Sidebar är `w-56` fast, ingen hamburger-meny, inga `md:`-klasser.

**Strategi (progressiv):**

#### E1 — Kollapsbar sidebar på mobil (breakpoint `md:`)
**Fil:** `components/sidebar.tsx` + `app/(dashboard)/layout.tsx`

```tsx
// sidebar.tsx
<aside className={cn(
  "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-surface transition-transform duration-200",
  "w-56",
  mobileOpen ? "translate-x-0" : "-translate-x-full",
  "md:relative md:translate-x-0 md:shrink-0"
)}>
```

Lägg till hamburger-knapp i `layout.tsx` som sätter `mobileOpen`-state (delat via Context eller prop).

Overlay-backdrop: `<div onClick={close} className="fixed inset-0 bg-black/40 z-40 md:hidden" />` visas när mobileOpen = true.

#### E2 — Responsiva grids i stats-sidan
- `stats-client.tsx`: Metrics-grid byter från `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`
- Övriga grids: kontrollera och lägg till breakpoints

#### E3 — Responsiva tabeller
- Laps-tabell: `hidden md:table-cell` på kolumner som inte är kritiska på mobil (pace-bar, Elev)
- Race-records: göm sekundära kolumner

#### E4 — Responsiv `p-6` padding
- `layout.tsx`: `<div className="max-w-7xl mx-auto p-4 md:p-6">` — minskar padding på mobil

#### E5 — Touch-events för planner drag/drop
- HTML5 drag API fungerar ej på touch-skärmar. Lägg till `onTouchStart`/`onTouchMove`/`onTouchEnd` på TemplateCard och PlannerCalendar-celler för mobil drag-and-drop.

---

### Feature F: Planner — kopiera och flytta aktiviteter

**Nuläge:** Endast templates kan dras. PlannedWorkouts kan inte dras.

**Implementering:**

#### F1 — Drag existing workout to another day
**Fil:** `components/planner/WorkoutPill.tsx`

Lägg till `draggable` och `onDragStart`:
```tsx
draggable
onDragStart={e => {
  e.dataTransfer.setData("workoutId", workout.id);
  e.dataTransfer.setData("workoutDate", workout.date);
  e.dataTransfer.effectAllowed = "move";
}}
```

**Fil:** `components/planner/PlannerCalendar.tsx`

I `onDrop`, hantera `workoutId`:
```tsx
const workoutId = e.dataTransfer.getData("workoutId");
if (workoutId && onWorkoutMove) onWorkoutMove(workoutId, key);
```
Prop: `onWorkoutMove?: (workoutId: string, newDate: string) => void`

**Fil:** `app/(dashboard)/planner/planner-client.tsx`

Handler:
```tsx
async function handleMoveWorkout(workoutId: string, newDate: string) {
  await fetch(`/api/planner/workouts/${workoutId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: newDate }),
  });
  setWorkouts(prev => prev.map(w => w.id === workoutId ? { ...w, date: newDate } : w));
}
```

#### F2 — Copy (duplicate) workout
Lägg till "Kopiera"-knapp i `WorkoutEditModal.tsx` (eller kontextmeny på WorkoutPill).
Knapp öppnar datumväljare → POST `/api/planner/workouts` med samma innehåll på nytt datum.

---

## 5. Avancerade / Framtida

### Feature G: Ny HR-zon estimeringsmetod (Gemini/KDE-analys)

Tre metoder beskrivna i NOTES.md: KDE på volym, K-Means clustering, Cardiovascular Drift.

**Nuläge:** `lib/fitness/zones.ts` har `estimateZonesFromStatisticalAnalysis` som använder piecewise linjär regression med bucketing och GAP. Fungerar när R² ≥ 0.72.

**Plan:**

#### G1 — Cardiovascular Drift (lättast, mest datadrivet)
Implementera `detectLT1FromDrift(activities)`:
- Filtrera aktiviteter > 50 min med stabilt GAP (variansen < 5%)
- Dela varje i Halva A (min 5–25) och Halva B (min 25–45)
- Beräkna drift = (HR/GAP halva B) / (HR/GAP halva A) - 1
- Plotta drift vs snittpuls → LT1 = puls där drift konsekvent > 5%
- **Data som krävs:** streams-data per aktivitet (tid, HR, GAP). Kräver att streams cachas eller fetcha live för varje aktivitet — DYRT. Kräver förmodligen att man på förhand beräknar drift-värden och sparar i DB.

#### G2 — KDE på pulsdistribution (medel)
Implementera `estimateLT1FromKDE(allHRValues)`:
- Kör Kernel Density Estimation på alla pulsvärden från alla pass
- Hitta övre svansen av den stora "easy pace"-puckeln
- Inflektionspunkten ≈ LT1

Inget externt bibliotek behövs — KDE kan implementeras i ren TS med Gaussian kernel.

#### G3 — K-Means på [HR, GAP, effektivitet] (svårast)
Kräver antingen ett JS K-Means-bibliotek (`ml-kmeans`) eller en enkel implementation. Varje stabil minut av träning behöver vara en datapunkt → kräver streams-data eller per-minutaggregat.

**Implementation-strategi:**
- Skapa en separat endpoint `POST /api/coach/calibrate` med `method: "advanced-statistical"` 
- Ny knapp i stats-client bredvid "Estimera zoner": "Avancerad estimering"
- Knappen kör G1 eller G2 (KDE) som är genomförbar utan streams
- Visa ett jämförelseresultat: "Nuvarande metod: LT1=158bpm, Ny metod: LT1=162bpm"

> **Notera:** Denna feature kräver djupare analys och troligen 2–3 dedicerade sessioner. Implementera efter allt annat.

---

## 6. Dokumentationsuppdateringar

När implementeringen är klar:

| Dokument | Uppdatering |
|---|---|
| `docs/planning/NOTES.md` | Markera alla implementerade items som `- [x]` |
| `docs/planning/IMPLEMENTATION_PLAN.md` | Lägg till session-2026-05-25 ändringslogg |
| `docs/api/races.md` | Inga ändringar |
| `docs/fitness/hr_zones_current.md` | Uppdatera om ny estimeringsknapp implementeras |
| `docs/guides/workflows.md` | Uppdatera om layout.tsx ändras |

---

## 7. Verifiering, bygge och deployment

### Checklistor per feature

#### Buggar (krav för deploy)
- [ ] HR tooltip: öppna Stats → Fitness → hovra på donut-chart → vit text syns
- [ ] History länk: klicka aktivitet i history → navigeras till `/activities/[id]`
- [ ] Planner past-drop: försök droppa template på igår → inget händer
- [ ] Splits chart: kontrollera aktivitet med korta laps → alla bars visas
- [ ] Tooltips: hovra info-ikon i Stats → tooltip syns ej bakom annat element
- [ ] Chat scroll: scrolla konversationslistan utan att main-chatten scrollar

#### Features (acceptanstester)
- [ ] Laps: öppna aktivitet med laps → Tid-kolumn och Total-kolumn syns
- [ ] Best efforts: öppna aktivitet → "Bästa sträckor"-sektion visas om data finns
- [ ] Charts x-axis: klicka "Tid"-knapp → x-axeln visar mm:ss
- [ ] History UI: liknande visuell stil som Planner
- [ ] Mobil: 375px viewport → hamburger-meny syns, nav öppnas/stängs
- [ ] Planner drag workout: dra ett pass till en ny dag → passet flyttas
- [ ] Planner copy: "Kopiera"-knapp i edit-modal → pass dupliceras

### Bygge
```bash
pnpm build --no-lint    # måste kompilera rent
```
Inga TypeScript-fel accepteras.

### Commit-struktur (förslag)
```
fix: HR tooltip text color, planner past-drop block, splits chart filter
feat: activity history clickable, laps time columns, best efforts table
feat: performance charts time/distance toggle
feat: activity history UI harmonized with planner style
feat: chat layout height fix for independent scroll
feat(mobile): responsive sidebar with hamburger menu
feat(planner): drag and move existing workouts between days
```

### Deployment (localhost)
```bash
# Stoppa befintlig dev-server
Get-Process -Name "node" | Stop-Process -Force
# Starta om
pnpm dev
```

---

## Implementationsordning (rekommenderad)

```
Steg 1 — Buggar (Fix 1–6):       ~2h
Steg 2 — Laps + Best Efforts:    ~2h  
Steg 3 — Charts x-axis toggle:   ~1h
Steg 4 — History UI:             ~2h
Steg 5 — Chat layout:            ~30min
Steg 6 — Mobil E1–E4:            ~3h
Steg 7 — Planner F1–F2:          ~2h
Steg 8 — Mobil E5 (touch):       ~2h
Steg 9 — Ny HR-zon metod:        Separat session
```

**Total estimat (exkl. avancerad HR-zon):** ~14–16h

---

## Dubbel-check mot NOTES.md

| NOTES.md-punkt | Täckt i plan | Steg |
|---|---|---|
| Mobil-UX fullständig | ✅ | Feature E (E1–E5) |
| Activity History klickbar | ✅ | Fix 2 |
| HR tooltip svart text | ✅ | Fix 1 |
| Planner: kopiera/flytta aktiviteter | ✅ | Feature F (F1–F2) |
| Ny HR-zon estimering (KDE/K-Means/Drift) | ✅ | Feature G (framtida) |
| Aktiviteter öppnas från history | ✅ | Fix 2 (samma) |
| Laps: lap-tid + kumulativ elapsed | ✅ | Feature A |
| Laps: bästa sträckor (best efforts) | ✅ | Feature B |
| Splits chart bars syns ej | ✅ | Fix 4 |
| Performance charts dist/tid toggle | ✅ | Feature C |
| Activity History UI som Planner | ✅ | Feature D |
| Info-rutor döljs bakom annat | ✅ | Fix 5 |
| Planner ej drag/drop på gamla dagar | ✅ | Fix 3 |
| Chat sidebar scrollar självständigt | ✅ | Fix 6 |

**Alla 14 punkter täckta.** ✅
