# Intervalltoggle i aktivitetsvisaren + plannerns sparbugg

**Status:** Research klar, redo för implementation
**Skapad:** 2026-06-30
**Källa:** `docs/planning/Planerattköra/prompt3.md`

Denna plan täcker två orelaterade ändringar som användaren bad om i samma prompt:

- **Del A** — en ny "visa hela intervaller"-toggle i aktivitetsvisaren, som slår ihop Strava-laps (som kan vara fragmenterade av klockans autolap) till logiska träningssegment (uppvärmning/intervall/vila/nedvarvning).
- **Del B** — en verifierad sparbugg i plannern där en redigerad distans/tid "studsar tillbaka" till ett gammalt värde när passet öppnas igen, plus att distans/tid inte går att sätta till 0.

---

## DEL A — Intervalltoggle i aktivitetsvisaren

### A1. Mål

I aktivitetsvisaren (`app/(dashboard)/activities/[id]/page.tsx`) för ett intervallpass (t.ex. 4×4min) ska det finnas en toggle som växlar mellan:
- **Laps** (dagens läge) — varje rått Strava-lap visas som en egen rad/stapel, inklusive ev. autolap-fragment (en 4-minutersintervall med autolap på 1km kan idag visas som två rader: ett ~1km-lap + ett kort resterande lap).
- **Intervaller** (nytt läge) — alla laps som tillhör samma logiska segment (uppvärmning, en given intervall, en given vila, nedvarvning) slås ihop till EN rad, oavsett hur många råa Strava-laps som faktiskt ligger bakom den.

I båda komponenter som redan visar lapsen (tabell + stapeldiagram) ska den sammanslagna raden visa aggregerad distans, tid och tempo för hela segmentet — samma typ av information som visas per lap idag.

### A2. Befintlig kod — vad som redan finns

| Vad | Var | Detaljer |
|---|---|---|
| Rådata | `prisma/schema.prisma:175` | `Activity.laps: Json?` — rå Strava-laps-array, satt vid sync (`lib/strava/sync.ts:36`: `laps: raw.laps ?? null`) |
| Parsning till `Split[]` | `app/(dashboard)/activities/[id]/page.tsx:65-91` | `LapRaw` → `Split` mappning. `isLaps = !!(lapsRaw && lapsRaw.length >= 2)` (rad 81) avgör om riktiga laps eller bara auto-km-splits (`splitsMetric`) används. |
| Lap-tabell | `app/(dashboard)/activities/[id]/splits-table.tsx` | Ren tabell, en rad per `Split`. Inga hover-popups — bara `hover:bg-surface-2` bakgrundsfärg (rad 61). Kolumner (när `isLaps`): Dist, Pace, Lap time, Elapsed (rad 42-49). Elapsed beräknas som löpande summa av `moving_time` (rad 32, 59) — fungerar oförändrat om man matar in sammanslagna segment istället för råa laps, eftersom det bara summerar raderna i given ordning. |
| Lap-diagram | `app/(dashboard)/activities/[id]/splits-chart.tsx` | Stapeldiagram, en stapel per `Split`, med en RIKTIG hover-tooltip (rad 154-167) som idag visar pace, lap-nummer, HR, höjd — **men inte distans eller tid**. Har redan ett etablerat toggle-mönster (`xMode`, rad 42, 111-126) att följa för UI-konsistens. |
| Befintlig pace-baserad klassificering | `app/(dashboard)/activities/[id]/workout-analysis.tsx:46-188` (`computeRating`) | Hittar redan "arbets-laps" vs "lätta laps" via ett bimodalt gap-test: sorterar lap-paces och letar första gap ≥ 30 sek/km från den snabba änden (rad 58-67), slår sedan ihop på varandra följande "work"-laps till `intervalGroups` (rad 98-124). Detta är EN global tröskel över hela passet, inte den sekventiella logik användaren bad om — men 30 sek/km-tröskeln och mönstret för att summera distance/moving_time/HR över en grupp av laps (rad 106-111) är direkt återanvändbart. Denna funktion körs bara när `activity.workoutType === 3` (page.tsx rad 288). |

**Ingen befintlig kod slår idag ihop autolap-fragmenterade laps till färre, logiska rader** — `computeRating` identifierar bara vilka laps som är "work" i sin poängsättning, den ändrar inte vad som faktiskt renderas i tabellen/diagrammet.

### A3. Algoritm för segmentsammanslagning

Användarens spec, omsatt till en tillståndsmaskin som går igenom laps i kronologisk ordning:

- Tillstånd: `"easy"` (uppvärmning/vila/nedvarvning — positionellt avgör vi vilket) eller `"work"` (intervall).
- Börja i `"easy"`.
- För varje nytt lap, jämför dess tempo (sek/km) mot **det pågående öppna segmentets ackumulerade snittempo hittills** (inte bara föregående enskilda lap — mer robust mot GPS-brus mellan autolap-fragment av samma intervall).
  - Om aktuellt tillstånd är `"easy"` och det nya lapets tempo är **tillräckligt mycket snabbare** (≥ tröskel) → stäng det öppna segmentet, öppna ett nytt `"work"`-segment med detta lap som första medlem.
  - Om aktuellt tillstånd är `"work"` och det nya lapets tempo är **tillräckligt mycket långsammare** (≥ tröskel) → stäng det öppna segmentet, öppna ett nytt `"easy"`-segment.
  - Annars → lägg lapet till det redan öppna segmentet (detta är vad som slår ihop autolap-fragment av samma intervall/vila till en rad).
- **Tröskel:** återanvänd 30 sek/km-konstanten från `workout-analysis.tsx:63` för konsekvens i appen — extrahera den till en delad konstant (t.ex. `lib/activity/interval-detection.ts`) som båda `workout-analysis.tsx` och den nya sammanslagningsfunktionen importerar, istället för att duplicera magic number 30.
- **Etikettering** (positionellt, inte tillstånd-baserat):
  - Första `"easy"`-segmentet (om det finns ett innan första `"work"`) → "Uppvärmning".
  - Sista `"easy"`-segmentet (om passet slutar med ett `"easy"`-segment efter sista `"work"`) → "Nedvarvning".
  - `"easy"`-segment mellan två `"work"`-segment → "Vila N".
  - `"work"`-segment → "Intervall N" (numrerat löpande).
  - Edge case: pass utan inledande lätt lap (kör direkt på intervall) → inget Uppvärmnings-segment, första segmentet är Intervall 1.
  - Edge case: pass utan avslutande lätt lap → sista segmentet förblir Intervall N eller Vila N, inte felaktigt märkt "Nedvarvning".

### A4. Ny modul

`lib/activity/interval-segments.ts` (ny fil):

```ts
export interface MergedSegment {
  label: string;        // "Uppvärmning" | "Intervall 1" | "Vila 1" | "Nedvarvning" | …
  distance: number;      // summerad meter
  moving_time: number;    // summerad sekunder
  average_speed: number;  // distance / moving_time
  average_heartrate?: number; // tidsviktat snitt av underliggande laps med HR
  elevation_difference?: number; // summerad
  lapCount: number;       // antal råa laps som slogs ihop (för ev. framtida bruk/debug)
}

export function mergeLapsIntoSegments(
  laps: { distance: number; moving_time: number; average_speed: number; average_heartrate?: number; elevation_difference?: number }[],
  thresholdSecPerKm?: number, // default importerad från lib/activity/interval-detection.ts
): MergedSegment[]
```

HR-aggregering följer samma mönster som `workout-analysis.tsx:108-111,119-122` (tidsviktat snitt, filtrera bort laps utan HR).

`Split.split`-fältet (number) i `splits-table.tsx` och `splits-chart.tsx` behöver typas om till `number | string` för att kunna bära beskrivande etiketter ("Uppvärmning", "Vila 1", …) istället för bara lap-nummer — en liten, lågrisk typändring i båda komponenterna (används bara för visning + `key`).

### A5. UI-integration

- Ny klientkomponent `app/(dashboard)/activities/[id]/splits-section.tsx` ("use client") som äger toggle-state och wrap:ar både `SplitsChart` och `SplitsTable`, så de alltid visar samma läge synkront (de är idag två separata serverrenderade block i `page.tsx:246-251` och `277-280` utan delat state).
  - `const [mergeIntervals, setMergeIntervals] = useState(false)`
  - Toggle-knapp i samma visuella stil som `SplitsChart`s befintliga `xMode`-toggle (rad 111-126 i splits-chart.tsx) för konsekvens.
  - `displaySplits = mergeIntervals ? mergeLapsIntoSegments(splits, threshold) : splits`
  - Skicka `displaySplits` till båda barnkomponenterna istället för rå `splits`.
- Toggle ska bara visas när det är meningsfullt: `isLaps === true` OCH `activity.workoutType === 3` (samma gate som `WorkoutAnalysis` använder idag, page.tsx:288) OCH tillräckligt många laps (matcha `computeRating`s `valid.length < 3`-gräns) för att undvika en poänglös toggle på ett steady-pass.
- `page.tsx` byter ut de två separata render-blocken (rad 246-251, 277-280) mot ett enda anrop till `SplitsSection`.
- **Hover-info:** Utöka `SplitsChart`s befintliga tooltip (splits-chart.tsx:154-167) med distans och segmenttid — idag visas bara pace/lapnummer/HR/höjd. `SplitsTable` visar redan distans, tempo och tid som statiska kolumner per rad (rad 63-69) — detta fungerar oförändrat för sammanslagna segment utan ändringar i tabellkomponenten, eftersom den bara konsumerar `Split[]`-formen.

### A6. Filer som skapas/ändras

- `lib/activity/interval-detection.ts` (ny) — delad tröskelkonstant, ev. delad med `workout-analysis.tsx`
- `lib/activity/interval-segments.ts` (ny) — `mergeLapsIntoSegments()`
- `app/(dashboard)/activities/[id]/splits-section.tsx` (ny) — toggle-wrapper
- `app/(dashboard)/activities/[id]/page.tsx` — byt ut rad 246-251 + 277-280 mot `<SplitsSection .../>`
- `app/(dashboard)/activities/[id]/splits-table.tsx` — `split: number` → `split: number | string`
- `app/(dashboard)/activities/[id]/splits-chart.tsx` — `split: number` → `split: number | string`; tooltip utökas med distans + tid
- (valfritt, ej krav) `workout-analysis.tsx` skulle kunna återanvända `interval-detection.ts`s tröskelkonstant istället för sin egen `30`-literal — gör det bara om det inte komplicerar diffen nämnvärt

### A7. Validering

1. Importera/öppna ett riktigt 4×4min-pass med autolap (ett intervall som fragmenterats i flera laps). Slå på togglen, bekräfta att varje uppvärmning/intervall/vila/nedvarvning visas som EN rad i tabellen och EN stapel i diagrammet, med korrekt summerad distans/tid och rimligt snittempo.
2. Bekräfta att hover på en sammanslagen stapel visar distans, tid och tempo för hela segmentet.
3. Testa ett pass med ojämnt antal autolap-fragment per intervall (t.ex. en 10-minutersintervall med tre laps) — bekräfta att alla tre slås ihop korrekt.
4. Testa ett pass UTAN uppvärmning (kör rakt in i intervaller) och ett UTAN nedvarvning — bekräfta korrekt etikettering utan felaktiga "Uppvärmning"/"Nedvarvning"-taggar på fel plats.
5. Testa ett steady-pass (inget `workoutType === 3`, eller för få laps) — bekräfta att togglen INTE visas.
6. Slå av togglen igen — bekräfta att rå lap-vyn återställs identiskt med hur den ser ut idag (ingen regression i default-läget).
7. `pnpm build --no-lint` utan TypeScript-fel.

---

## DEL B — Plannerns sparbugg

### B1. Buggrapport (från användaren)

> I plannern, om man redigerar distansen på ett planerat pass och trycker Save, ändras distansen visuellt i plannern — men öppnar man samma pass igen för att redigera är ändringen borta, originalvärdena ligger kvar. Man ska även kunna sätta distans och tid till 0.

### B2. Bugg 1 — Värdet "studsar tillbaka" vid återöppning (VERIFIERAD, root cause hittad)

**Detta är reproducerbart specifikt för planerade pass som är länkade till en sparad `WorkoutTemplate`** (dvs. passet skapades genom att dra en mall från biblioteket till en dag i kalendern — `PlannedWorkout.templateId` är satt). Pass som byggts ad-hoc direkt på en dag (utan mall-koppling) påverkas INTE av denna specifika bugg.

**Exakt orsakskedja:**

1. Användaren öppnar ett mall-länkat pass → `app/(dashboard)/planner/planner-client.tsx:152-178` (`editTemplate`-memo) returnerar `editWorkout.template` rakt av (rad 157-159) — dvs. **den DELADE mallens fält**, inte det enskilda passets egna `targetDistance`/`targetDuration`.
2. `components/planner/WorkoutBuilder.tsx:161-166` initierar `totalDistKm`/`totalDurMin`-state EN gång från `editTemplate?.estimatedDistance`/`estimatedDuration` (mallens fält).
3. Användaren ändrar Total distance, trycker Save → `planner-client.tsx:390-431` (`handleWorkoutAutoSave`) gör TVÅ saker:
   - PATCH till `/api/planner/workouts/${id}` (rad 395) — sparar `targetDistance` korrekt på SJÄLVA PASS-INSTANSEN. Detta är varför kalenderkortet visuellt uppdateras direkt (`setWorkouts` rad 411).
   - Om `editWorkout.templateId` finns (rad 418): PATCH till `/api/planner/templates/${templateId}` (rad 419-430) med `sections: data.sections` — **men INTE** `estimatedDistance`/`estimatedDuration` direkt.
4. I `app/api/planner/templates/[id]/route.ts:42-51`: när `sections` skickas med, räknas mallens `estimatedDuration`/`estimatedDistance` om via `computeTemplateEstimate(sections, paceZoneRanges)` (`lib/planner/estimate.ts:95-102`) — **istället för att läsa av sektionens egna explicita `distance`/`duration`-fält rakt av.**
5. Roten: `lib/planner/estimate.ts:43-61` (`resolveSegment`) — när en sektions `durationType === "time"` (vilket är fallet så fort en duration är satt, se `syncDefaultSection` i WorkoutBuilder.tsx:209-229 som sätter `durationType: durationSec ? "time" : …`), beräknas segmentets distans via **tempo-uppskattning** (`(duration / pace) * 1000`, rad 54) — **det kastar bort den faktiska, redan ifyllda `distance`-fältet helt**, även när den literalt innehåller exakt det värde användaren just skrev in. Samma sak omvänt för `durationType === "distance"`: duration uppskattas från tempo, den faktiska `duration` ignoreras.
6. Resultat: mallens persisterade `estimatedDistance` blir en tempo-uppskattning (baserad på `paceZones` härledda från användarens VDOT), inte det literala värdet användaren skrev in. Öppnar man passet igen läser `editTemplate.estimatedDistance` (steg 1-2) detta felaktiga/oförändrade-liknande värde — vilket upplevs som "originalvärdena är kvar".

`resolveSegment()` är designad för att uppskatta EN dimension när bara den ANDRA är explicit känd (t.ex. ett rent tidsbaserat intervall utan känd distans) — det är korrekt beteende för `estimateSections()`s ursprungliga syfte (live-förhandsvisning + mall-uppskattning när bara en dimension är ifylld). Buggen är att samma funktion även används för att skriva över mallens fält när BÅDA dimensionerna redan var explicit kända (det enkla Total distance + Total time-läget fyller alltid i båda via `syncDefaultSection`).

**Föreslagen fix:** I `resolveSegment()` (`lib/planner/estimate.ts:43-61`), föredra det literala motsvarande fältet när det redan finns, och uppskatta bara när det verkligen saknas:
```ts
if (durationType === "time" && duration) {
  if (distance) return { sec: duration, m: distance }; // båda kända — använd literalt, gissa inget
  const pace = resolvePace(...);
  return { sec: duration, m: pace > 0 ? (duration / pace) * 1000 : 0 };
}
if (durationType === "distance" && distance) {
  if (duration) return { sec: duration, m: distance };
  const pace = resolvePace(...);
  return { sec: (distance / 1000) * pace, m: distance };
}
```
Detta är en delad funktion (kommentaren i filen, rad 1-3, bekräftar den används av både server och klient) — fixen korrigerar alltså både den klientsidiga live-förhandsvisningen i WorkoutBuilder OCH den serversidiga mall-persisteringen i ett enda ställe.

**Öppen fråga att flagga för implementerande agent (inte del av denna fix, men värd att bekräfta avsiktlighet):** `handleWorkoutAutoSave` (planner-client.tsx:418-430) propagerar ALLTID namn/sport/typ/färg/sektioner från en enskild pass-redigering till den DELADE mallen, vilket påverkar alla andra dagar/framtida placeringar av samma mall. Om detta är oavsiktligt (användaren tänkte bara redigera den ENA dagens pass) är det en separat, större bugg än vad som efterfrågades — men det kan också vara avsiktligt (mallen ska reflektera senaste redigering). Bekräfta med användaren om detta är önskat beteende innan något ändras här; ändra inte utan att fråga, per CLAUDE.md:s bug-audit-princip.

### B3. Bugg 2 — Kan inte sätta distans/tid till 0 (VERIFIERAD, fyra separata spärrar)

Samtliga måste fixas för att 0 ska gå att spara och visas korrekt:

| # | Fil:rad | Problem | Fix |
|---|---|---|---|
| 1 | `app/api/planner/workouts/[id]/route.ts:13-14` | `targetDistance: z.number().positive()…`, `targetDuration: z.number().int().positive()…` — `.positive()` kräver strikt > 0, avvisar 0 med 400 | Byt till `.nonnegative()` |
| 2 | `components/planner/WorkoutBuilder.tsx:530` | `<input type="number" min={1} …>` för Total time — HTML-spärr mot 0 | Byt `min={1}` → `min={0}` |
| 3 | `components/planner/WorkoutBuilder.tsx:542` | `<input type="number" min={0.1} …>` för Total distance | Byt `min={0.1}` → `min={0}` |
| 4 | `components/planner/WorkoutBuilder.tsx:532,544` | `onChange={e => handleTotalDurChange(parseFloat(e.target.value) \|\| "")}` / samma för distance — `0 \|\| ""` utvärderas till `""` eftersom `0` är falsy i JS, så fältet töms istället för att visa 0 | Byt till explicit NaN-check: `const v = parseFloat(e.target.value); handleTotalDurChange(Number.isNaN(v) ? "" : v)` |
| 5 | `components/planner/WorkoutBuilder.tsx:366-369` (`buildData()`) | `if (!totalDuration && typeof totalDurMin === "number" && totalDurMin > 0)` — `totalDurMin > 0` utesluter explicit 0 från att någonsin skickas vidare | Byt till `totalDurMin >= 0` (samma för distance-grenen) — men bara när du AVSIKTLIGT vill tillåta 0 som ett riktigt värde, inte som "tomt"; säkerställ att `""` (tomt fält) fortfarande tolkas som "inget värde", inte 0 |
| 6 | `components/planner/WorkoutBuilder.tsx:221-222` (`syncDefaultSection`) | `dur > 0 ? … : null`, `dist > 0 ? … : null` — samma `> 0`-spärr i sektionssynken | Byt till `>= 0` med samma försiktighet som ovan för tom-vs-noll |
| 7 | `components/planner/WorkoutBuilder.tsx:749,758` (sektionsfält) | `min={1}` på Duration (min), `min={100}` på Distance (m) för enskilda intervallsektioner | Bedöm om 0 är meningsfullt här också (en sektion med 0 duration/distance är troligen aldrig användbart) — användaren bad specifikt om Total distance/tid, inte sektionsfälten; ändra bara om det är konsekvent att göra så, annars lämna oförändrat |

**Distinktion tomt fält vs. explicit 0:** Eftersom `totalDurMin`/`totalDistKm` är typade `number | ""` används redan tom sträng som "inget värde ifyllt". Fixen ovan måste bevara den distinktionen (`""` ≠ `0`) — annars riskerar man att ett tomt fält tolkas som 0 och sparas som `targetDistance: 0` istället för `null`, vilket vore en ny bugg.

### B4. Filer som ändras (Del B)

- `lib/planner/estimate.ts` — `resolveSegment()` föredrar literala fält framför tempo-uppskattning när båda är kända
- `app/api/planner/workouts/[id]/route.ts` — `.positive()` → `.nonnegative()` för `targetDistance`/`targetDuration`
- `components/planner/WorkoutBuilder.tsx` — `min`-attribut, `onChange`-handlers, `buildData()`- och `syncDefaultSection()`-spärrar enligt tabellen ovan

### B5. Validering

1. **Reproducera bugg 1 INNAN fix:** skapa ett mall-länkat pass (dra mall från biblioteket till en dag), öppna det, ändra Total distance, spara, stäng, öppna samma pass igen — bekräfta att det FELAKTIGA (gamla/uppskattade) värdet visas. Implementera fixen i `estimate.ts`. Upprepa samma steg — bekräfta att det NU korrekta, literalt sparade värdet visas vid återöppning.
2. Upprepa samma test för ett pass som INTE är mall-länkat (ad-hoc-byggt direkt i kalendern) — bekräfta att det redan fungerade korrekt innan och fortfarande gör det efter fixen (ingen regression).
3. Testa att sätta Total distance till 0 och Total time till 0 var för sig och tillsammans — spara, ladda om sidan, bekräfta att 0 visas (inte tomt fält, inte gammalt värde).
4. Testa att lämna ett fält tomt (inte 0) — bekräfta att det fortfarande sparas/visas som tomt/null, inte som 0.
5. Testa mallbiblioteket separat (redigera en mall direkt, inte via ett planerat pass) — bekräfta att `estimatedDistance`/`estimatedDuration` fortfarande beräknas rätt för sektionsbaserade (intervall-)mallar där bara EN dimension är explicit ifylld (verifiera att uppskatta-fallet i `resolveSegment` fortfarande fungerar när det verkligen behövs).
6. `pnpm build --no-lint` utan TypeScript-fel.

---

## Slutinstruktion till implementerande agent

1. Implementera Del A och Del B oberoende av varandra (de delar inga filer) — kan göras i valfri ordning eller parallellt.
2. Bekräfta öppna frågan i §B2 (mall-cascade-beteendet) med användaren innan ev. ändring där — den är INTE del av den begärda fixen.
3. **Dubbelkolla att implementationen fungerar korrekt** genom att faktiskt köra igenom alla valideringssteg i §A7 och §B5 i webbläsaren — inte bara att koden kompilerar. Reproducera bugg 1 i Del B explicit FÖRE fix för att bekräfta root cause-analysen i §B2 stämmer, inte bara anta att den gör det.
4. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` med en sessionspost (en bullet per ändrad fil/funktion med konkret beteende, inte bara "uppdaterade X").
5. Flytta denna fil till `docs/planning/archive/` när allt ovan är bekräftat klart.
