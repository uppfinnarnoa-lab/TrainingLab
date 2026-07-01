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

## DEL C — Fullständig bugaudit av hela plannern

**Bakgrund:** användaren bad om en full bugaudit av plannern ("allt som kan göra att planner inte fungerar perfekt"), utöver Del A/B. Granskningen täckte samtliga filer under `app/(dashboard)/planner/`, `components/planner/`, `app/api/planner/` och `lib/planner/`. Varje fynd nedan är verifierat genom att läsa den faktiska koden (inte bara antaget) — där två oberoende granskningar motsade varandra (se C1.2) löstes konflikten genom att läsa `prisma/schema.prisma` direkt innan något skrevs ner, per CLAUDE.md:s bug-audit-princip.

Fynden är grupperade efter prioritet. Var och en anger fil:rad, vad som är fel, och riktning för fix — exakt implementation lämnas till implementerande agent att verifiera mot koden vid det laget (koden kan ha ändrats av Del A/B:s arbete först).

### C1. Hög påverkan

#### C1.1 — Inkonsekvent "idag"-beräkning (UTC vs. lokal tid) över flera filer, verifierad

`app/(dashboard)/planner/planner-client.tsx:150` (`handleWorkoutClick`s `w.date > today`-grind, avgör edit- vs. status-läge) och rad 199 (`handleAddTemplateToDate`s default-datum) beräknar `today` via `new Date().toISOString().split("T")[0]` (**UTC**). Servern (`app/api/planner/workouts/[id]/route.ts:54`, grinden mot att markera framtida pass som klara) gör detsamma. Men `components/planner/PlannerCalendar.tsx:299` (`isPast`-styling på varje kort, rad 506, 638), `components/planner/BlockBanner.tsx:81`, `components/planner/WeekSummaryStrip.tsx:54` och `app/(dashboard)/planner/week/page.tsx:252` beräknar `today` via `format(new Date(), "yyyy-MM-dd")` från `date-fns` (**lokal tid**). Bekräftat genom grep — ingen spekulation.

Effekt: under fönstret runt UTC-midnatt (för svensk tid ca kl. 01–03 lokal tid) kan ett korts VISUELLA `isPast`-styling (lokal) och vad som faktiskt händer vid klick (UTC-grind i `handleWorkoutClick`) hamna i otakt — ett kort kan se "förflutet" ut men ändå öppna redigeringsläget, eller tvärtom.

**Fix:** standardisera på EN metod. Rekommenderas: `format(new Date(), "yyyy-MM-dd")` (`date-fns`, redan importerat i `planner-client.tsx:6`), eftersom det redan är majoritetsmönstret i resten av plannern. Byt `planner-client.tsx:150,199` och `workouts/[id]/route.ts:54-57` till samma metod. Obs: serverns `format(new Date(), ...)` använder serverns tidszon (Ubuntu-servern), inte nödvändigvis användarens — för en self-hosted enanvändar-app i samma tidszon som servern är detta ändå en förbättring jämfört med UTC, men inte en perfekt lösning; notera detta som en känd begränsning snarare än att bygga full klient-tidszon-medvetenhet om det inte är värt scope-ökningen.

#### C1.2 — Mallradering: motsägelse mellan två granskningar löst — `SetNull`, inte krasch

`prisma/schema.prisma:319`: `template WorkoutTemplate? @relation(fields: [templateId], references: [id])` saknar `onDelete`. Verifierat direkt i schemat (inte antaget): för en **valfri** relation (`templateId String?`) utan explicit `onDelete` defaultar Prisma till `SetNull` (Prisma-dokumentationens egen defaulttabell: optional relation → `onDelete: SetNull`, mandatory relation → `Restrict`). Att radera en `WorkoutTemplate` som har planerade pass kraschar alltså INTE — `app/api/planner/templates/[id]/route.ts:61-67`s `DELETE` lyckas, men **tyst nollar `PlannedWorkout.templateId` på varje pass som använde mallen**, utan varning till användaren.

Konkret effekt: de berörda passen tappar sin koppling till sektioner/zonfördelning (`WeekSummaryStrip`/`ZoneBar` läser `template.estimatedZoneDistribution` — den droppar tyst ur veckosammanfattningen), och `WorkoutPill`s färg faller tillbaka till den gamla `workoutColor()`-gissningen istället för mallens typfärg. Dessutom: `planner-client.tsx:367-371`s `handleDeleteTemplate` uppdaterar bara lokal `templates`-state, INTE `workouts`-arrayen — kalendern fortsätter visa de gamla mall-kopplade korten tills sidan laddas om, då de plötsligt ser annorlunda ut (synlig inkonsekvens pre/post-refresh).

**Fix:** (a) visa en bekräftelsedialog innan radering som varnar om hur många planerade pass som använder mallen (kräver en räkning, t.ex. ett litet API-anrop eller inkludera `_count.planned` i mall-listan); (b) i `handleDeleteTemplate`, även uppdatera `workouts`-state lokalt (`templateId: null, template: null` på matchande rader) så UI:t inte ljuger innan en refresh.

#### C1.3 — `buildData()`/`syncDefaultSection()`-desync: Total-fälten blir overksamma för EXAKT den dimension sektionen redan har (utökar/nyanserar Del B:s Bugg 1)

Verifierat genom att läsa `WorkoutBuilder.tsx:209-229` (`syncDefaultSection`) och `:353-378` (`buildData`) tillsammans. `syncDefaultSection` returnerar tidigt om `sectionsCustomized` är `true` (rad 215) — och `sectionsCustomized` initieras till `true` så fort den laddade mallen redan har ≥1 sektion (rad 169-171), vilket gäller praktiskt taget alla mall-länkade pass (efter `backfill-sections`-körningen nämnd i `planner-client.tsx:42-43`). Det betyder: när du redigerar ett mall-länkat pass, slutar `syncDefaultSection` synka Total-fälten till den underliggande sektionen — men `buildData()`s for-loop (rad 359-365) prioriterar ändå sektionens (nu inaktuella) `duration`/`distance` FÖRE de fält du faktiskt skrev i, **men bara för den dimension som matchar sektionens egen `durationType`**:

- Om sektionens `durationType === "time"` (vanligast — gäller varje mall där en tid någonsin satts): redigering av **Total time** sparas FEL (gammalt sektionsvärde vinner), men **Total distance** sparas rätt (faller igenom till `totalDistKm` eftersom `else if`-grenen för distance aldrig matchar när typen är "time").
- Om sektionens `durationType === "distance"` (rena distans-mallar, t.ex. "Långpass 20km" utan satt tid): redigering av **Total distance** sparas FEL, **Total time** sparas rätt.

Detta är en SEPARAT, mer direkt bugg än Del B:s Bugg 1 (som bara gäller mallens egen redundanta `estimatedDistance`/`estimatedDuration` via `resolveSegment`) — här sparas **själva passets `targetDuration`/`targetDistance`** fel, inte bara mallens cache-fält. Förklarar varför vissa användare upplever att "tiden jag ändrade sparades inte alls" specifikt för rena distans- eller rena tids-mallar.

**Fix:** ta bort `sectionsCustomized`-villkoret ur `syncDefaultSection`s tidiga retur (rad 215), behåll bara `sections.length !== 1`-kontrollen — så den enda standardsektionen alltid speglar de levande Total-fälten oavsett hur `sectionsCustomized` sattes. Kontrollera FÖRST om `sectionsCustomized` används någon annanstans i komponenten för att styra UI (t.ex. visa/dölja den avancerade sektionseditorn) — ändra inte den logiken, bara denna specifika tidiga-retur-gren.

#### C1.4 — Auto-save-race mot Cancel/Save/Delete i WorkoutBuilder, ingen sekvensering

Verifierat genom att läsa debounce-`useEffect` (`WorkoutBuilder.tsx:389-395`, 800ms) tillsammans med `planner-client.tsx`s `handleTemplateEditCancel` (306-320), `handleWorkoutEditCancel` (442-...), `handleEditBuilderSave`/`handleTemplateUpdate` och delete-handlarna. Den debouncerade auto-sparningen och en explicit Cancel/Save/Delete-åtgärd är två OBEROENDE `async fetch`-anrop utan någon `AbortController` eller in-flight-spärr mellan dem. Om en auto-save redan är i flykt (skickad strax innan användaren klickar Cancel/Delete) kan den **resolvas EFTER** cancel-/delete-anropet — vilket kan återställa en avsiktligt avbruten ändring, eller skicka en PATCH mot en redan raderad rad (404 i bästa fall, en "zombie"-skrivning i sämre fall om ordningen är omvänd).

**Fix:** lägg till en `AbortController` för den debouncerade auto-save-`fetch`en, avbryt den i `useEffect`s cleanup OCH explicit innan Cancel/Save/Delete-anropen körs; alternativt en enkel in-flight-flagga (`useRef<boolean>`) som Cancel/Delete kontrollerar/väntar in innan de kör sin egen PATCH.

#### C1.5 — Icke-atomisk sektionsersättning i `templates/[id]` PATCH kan tömma alla sektioner vid fel

`app/api/planner/templates/[id]/route.ts:42-52`: när `sections` skickas med, körs `deleteMany` → ev. `createMany` → `update` (omräknar `estimatedDuration`/`estimatedDistance`) som TRE separata, icke-transaktionella Prisma-anrop. Om steg 2 eller 3 misslyckas efter att steg 1 lyckats, står mallen kvar med NOLL sektioner och ett inaktuellt estimat. `templates/route.ts`s POST gör motsvarande sak atomiskt via en nested `create` (rad 64-74) — mönstret för en atomisk lösning finns redan i samma fil-familj.

**Fix:** wrappa `deleteMany`/`createMany`/`update`-blocket i `prisma.$transaction([...])`.

#### C1.6 — Träningsblock: överlapp valideras aldrig, senare block döljer tidigare på kalendern tyst

Verifierat: `components/planner/PlannerCalendar.tsx:253-266` (`blockByDate`) itererar `blocks` och gör `map.set(dateKey, block)` för varje dag i varje blocks intervall — om två block täcker samma dag vinner det SENARE blocket i iterationsordningen, det tidigare blocket försvinner helt från kalenderrutnätet (syns fortfarande i `BlockBanner` ovanför, men inte på själva rutnätet). Ingen validering av detta finns vare sig i `BlockEditorModal.tsx` eller i `app/api/planner/blocks/route.ts`/`blocks/[id]/route.ts` (som inte heller validerar att `endDate >= startDate`, samma fil).

**Fix:** lägg till en `.refine()` i blocks zod-schemat som säkerställer `endDate >= startDate`; överväg om överlappande block ska tillåtas alls (om ja, rendera dem staplat eller med en tydlig visuell prioritetsordning istället för tyst overwrite; om nej, validera och avvisa överlapp vid skapande/redigering).

#### C1.7 — Förflutna/redan avklarade pass kan dras till framtida datum utan spärr

`components/planner/PlannerCalendar.tsx`s `handleDndDragEnd` (167-178) och varje `<DraggableWorkout>` (rad 586) är okonditionellt dragbara oavsett `isPast`/`status`. `handleMoveWorkout` (`planner-client.tsx:270-278`) och API:ts PATCH (`workouts/[id]/route.ts`) validerar bara datum vid STATUS-ändring (rad 53-61), inte vid ren datum-flytt. Ett redan markerat "completed"/"missed" pass kan alltså dras till en framtida dag, där det sedan renderas i edit-läge istället för status-läge — bryter mot appens uttalade "framtid = redigera, förflutet = markera utfall"-modell.

**Fix:** antingen göra förflutna/icke-"planned"-pass icke-dragbara (enklast — matcha den regel som redan finns för klick-läge), eller, om att flytta historik avsiktligt ska vara tillåtet, nollställa `status`/`missedReason`/`missedNote`/`markedAt` när ett icke-"planned"-pass flyttas till ett framtida datum så det inte hamnar i ett inkonsekvent tillstånd.

### C2. Medel påverkan

| # | Fil:rad | Problem | Fix-riktning |
|---|---|---|---|
| C2.1 | `components/planner/WeekSummaryStrip.tsx:55` | `isPast` för en vecka = `workouts.some(w => w.date < today)` — den PÅGÅENDE veckan räknas som "past" och visar `completed/total` där `total` inkluderar ännu icke-passerade dagar, vilket underskattar completion-kvoten | Räkna nämnaren som bara redan passerade dagars pass, inte hela veckan |
| C2.2 | `app/(dashboard)/planner/week/page.tsx:63-99` vs. `WeekSummaryStrip.tsx` | `week/page.tsx` grupperar volym per RÅ `w.sportType` (slår inte ihop löprelaterade sporter), medan kalenderns `WeekSummaryStrip` slår ihop dem — samma vecka visar olika sportuppdelning beroende på vilken vy man öppnar | Återanvänd samma normaliserings-/ihopslagningslogik på båda ställena |
| C2.3 | `app/(dashboard)/planner/week/page.tsx:101,226-242` | "Zone distribution"-procenten delar mall-zonsekunder med `totalTimeSec` (summa av `targetDuration`) — två olika datakällor/nämnare som inte nödvändigtvis matchar samma pass, kan ge procent som inte summerar till 100% eller överstiger det | Säkerställ att täljare och nämnare kommer från samma underliggande mängd pass |
| C2.4 | `lib/planner/sectionSchema.ts:8-16` | Inga övre gränser på `duration`/`distance`/`repetitions`/HR/pace-fält, ingen `.min(0)` på `order`, ingen cross-field-validering som kräver att `duration`/`distance` faktiskt är satt när `durationType` pekar på den dimensionen, inga `restTargetZone`/`restDuration*`-fält knutna till att `restDurationType` faktiskt är satt | Lägg till rimliga `.max()`-gränser och `.superRefine()` för cross-field-konsistens |
| C2.5 | `app/api/planner/workouts/route.ts:12-13`, `workouts/[id]/route.ts:13-14` | Samma `.positive()`-spärr mot 0 som redan fixas i Del B finns även på POST-vägen (skapa nytt pass), inte bara PATCH | Inkludera POST-schemat i Del B:s fix |
| C2.6 | `app/api/planner/workouts/[id]/route.ts:10` | `sportType` har ingen `.max()`-gräns på PATCH (POST har `.min(1).max(60)`, PATCH saknar den) | Lägg till samma gräns på PATCH-schemat |
| C2.7 | `planner-client.tsx:516-523` (`handleBlockDelete`) och `handleMoveWorkout` (270-278) | Misslyckade DELETE/PATCH-anrop lämnar UI:t optimistiskt uppdaterat (blocket borttaget lokalt, eller draget kort) utan `showError` — vid fel "studsar" UI:t tillbaka förvirrande vid nästa `router.refresh()` istället för att direkt visa ett felmeddelande | Kontrollera `res.ok` innan/efter den optimistiska uppdateringen och anropa `showError(...)` konsekvent, som övriga handlers redan gör |
| C2.8 | `lib/google-calendar/sync.ts` via `workouts/route.ts:80`, `workouts/[id]/route.ts:73,89` | Bekräftat: alla tre Google Calendar-anrop är fire-and-forget (`.catch(console.error)`), ingen retry, ingen flagga på raden, ingen varning till användaren vid fel — permanent ur synk tills nästa lyckade skrivning råkar rätta till det. Vid DELETE raderas DB-raden (med `googleEventId`) FÖRE `deleteEvent()` anropas — om det anropet misslyckas finns ingen kvarvarande referens att försöka igen mot, så Calendar-eventet blir permanent föräldralöst | Inte en "tyst bugg" att fixa reflexmässigt — användarens beslut om det är värt att bygga en retry-kö/felindikator. Flaggas här som bekräftat beteende, inte åtgärdat |

### C3. Lägre påverkan / polering

- **Saknad `key`-prop** på alla tre `<WorkoutBuilder>`-anrop i `planner-client.tsx` (rad 639, 652, 677) — latent risk: skulle någon framtida ändring göra att komponenten byter `editTemplate`/`editWorkout` utan att gå via `null` emellan, återanvänds instansen och allt `useState`-seedat formulärtillstånd (namn, sektioner, totals) förblir från föregående pass/mall. Fix: lägg till `key={editTemplate?.id ?? editWorkout?.id ?? "new"}` på samtliga tre — billigt att göra nu innan det blir en verklig bugg.
- **`localSports`** (`WorkoutBuilder.tsx:153`) seedas en gång från `sportsProp` och synkas aldrig om — om `sports`-arrayen uppdateras i föräldern medan byggaren är öppen (t.ex. en sport/typ skapas i en annan flik) visas den gamla listan i dropdownen.
- **Sektionens duration rundas sekund↔minut** (`WorkoutBuilder.tsx:749`, `Math.round(s.duration / 60)` för visning, `parseInt(...) * 60` vid skrivning) — en sektion sparad som t.ex. 90 sekunder visas som "2 min" och blir 120 sekunder nästa gång raden redigeras, en tyst precisionsdrift.
- **Repetitions: `parseInt(e.target.value) || null`** (`WorkoutBuilder.tsx:767`) gör att en användare som skriver `0` tyst får `null` → tolkas som 1 repetition i `buildData()`/estimatet, utan att användaren informeras.
- **`durationType: "open"`-sektioner** bidrar med noll till både `totalSec`/`totalM` I ESTIMATET och till de FAKTISKT SPARADE `targetDuration`/`targetDistance` om alla sektioner är "open" och topp-fälten är tomma — ett pass kan tyst sparas helt utan mål, utan varning.
- **Två parallella drag-and-drop-system** på samma kalenderrutnät: `TemplateCard`/mall-drop använder native HTML5 drag (`dataTransfer`), pass-flytt använder `dnd-kit`. Fungerar idag utan konflikt men är skört vid framtida ändringar av endera systemet.
- **`week/page.tsx`** döljer "Volume by type"/"Volume by intensity"-sektionerna helt om bara EN kategori finns den veckan (rad 167, 196) — sannolikt avsiktligt (ingen poäng med en 100%-stapel) men värt att bekräfta är önskat, inte en bugg som råkat dölja data.

### C4. Granskat och bekräftat OK (ingen åtgärd)

Per CLAUDE.md:s bug-audit-princip dokumenteras även det som såg misstänkt ut men verifierades vara korrekt, så det inte omprövas i onödan senare:

- **IDOR/auktorisering:** samtliga `:id`-routes under `app/api/planner/` (blocks, templates, workouts) verifierar ägarskap (`userId === session.user.id`) INNAN någon skrivning/läsning — ingen cross-user-läcka hittades.
- **Backfill-/fix-routes** (`backfill-sections`, `fix-ol-colors`, `backfill-running-sports`, `backfill-shared-race-type`, `backfill-workout-colors`): samtliga är POST-only, auth-gated, scopade till `session.user.id`, och idempotenta vid omkörning.
- **`lib/planner/colors.ts`:** inga icke-skyddade array-index-åtkomster, alla `.find()`-resultat null-hanteras korrekt, alltid en giltig fallback-färg.
- **`OutcomeModal.tsx`:** till skillnad från `WorkoutBuilder`s redan kända stale-state-problem är denna modalens lokala state korrekt synkad — `planner-client.tsx`s `handleOutcomeSave` uppdaterar `workouts`-arrayen korrekt från serversvaret.
- **Sektion-drag-and-drop-omordning** i `WorkoutBuilder.tsx` (`moveSection`): korrekt indexhantering, inga race conditions hittade.

### C5. Validering (Del C)

1. **C1.1:** byt klockan/systemtid (eller testa nära midnatt UTC, ca 01-03 svensk tid) — bekräfta att ett korts visuella "förflutet"-styling och dess klick-beteende (edit vs. status) alltid stämmer överens efter fixen.
2. **C1.2:** skapa en mall, lägg den på en dag, radera mallen från biblioteket — bekräfta att en varning visas FÖRE radering, och att kalenderkortet omedelbart (utan refresh) visar korrekt fallback-färg/saknad mall-koppling.
3. **C1.3:** skapa en ren distans-mall (bara Total distance ifyllt, inget Total time), lägg på en dag, redigera Total distance, spara, ladda om — bekräfta att det NYA värdet faktiskt sparades (inte bara visas i fältet under redigering). Upprepa för en ren tids-mall och Total time.
4. **C1.4:** öppna ett mall-länkat pass, ändra ett fält, klicka Cancel SNABBT (inom 800ms) upprepade gånger — bekräfta att ändringen verkligen är borta efter en sidladdning, inte bara lokalt.
5. **C1.5:** simulera ett fel i `createMany` (t.ex. tillfälligt en ogiltig sektion) och bekräfta att mallen inte tappar alla sina sektioner permanent — efter transaktionsfixen ska ett fel lämna mallen OFÖRÄNDRAD, inte tom.
6. **C1.6:** skapa två träningsblock med överlappande datumintervall — bekräfta avsett beteende (avvisad överlapp, eller korrekt staplad visning — beroende på vilken lösning som valdes).
7. **C1.7:** markera ett pass som "completed", dra det till en framtida dag — bekräfta avsett beteende (antingen omöjligt att dra, eller status nollställs korrekt).
8. `pnpm build --no-lint` utan TypeScript-fel efter samtliga C1-fixar.

---

## Slutinstruktion till implementerande agent

1. Implementera Del A och Del B oberoende av varandra (de delar inga filer) — kan göras i valfri ordning eller parallellt.
2. **Implementera Del C i prioritetsordning:** C1 (hög påverkan) först, sedan C2, sedan C3 om tid finns. C1.3 hänger ihop med Del B:s Bugg 1 (samma användarupplevda symptomklass, olika kodväg) — gör dem i samma omgång för att undvika att testa samma scenario två gånger. C2.5 ska göras tillsammans med Del B:s Bugg 2-fix (samma `.positive()`-mönster, bara på en annan route).
3. Bekräfta öppna frågan i §B2 (mall-cascade-beteendet) med användaren innan ev. ändring där — den är INTE del av den begärda fixen.
4. **Dubbelkolla att implementationen fungerar korrekt** genom att faktiskt köra igenom alla valideringssteg i §A7, §B5 och §C5 i webbläsaren — inte bara att koden kompilerar. Reproducera bugg 1 i Del B och C1.3 explicit FÖRE fix för att bekräfta root cause-analyserna i §B2/§C1.3 stämmer, inte bara anta att de gör det.
5. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` med en sessionspost (en bullet per ändrad fil/funktion med konkret beteende, inte bara "uppdaterade X").
6. Flytta denna fil till `docs/planning/archive/` när allt ovan är bekräftat klart.
