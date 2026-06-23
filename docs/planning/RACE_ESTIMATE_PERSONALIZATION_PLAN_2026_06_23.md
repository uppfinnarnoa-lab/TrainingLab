# Race-tidsestimat: personalisering för kort- vs långdistansprofil

**Status:** Research klar, redo för implementation
**Skapad:** 2026-06-23

## 1. Problemet (från användaren)

> "Förbättra race estimat, primärt för atleter med specifika profiler för kortare eller längre distans — som det är nu är kortare lite för långsamma och långa alldeles för snabba för mig."

Detta är **verifierat mot riktig data** (se §3) — inte bara en känsla. Felet växer monotont med distans och pekar på en specifik, identifierbar rotorsak (§4), inte bara "modellen är generellt dålig".

## 2. Nuvarande arkitektur

Två separata prediktionsmodeller beräknas och visas parallellt, per distans i `RACE_DISTANCES` (`lib/fitness/paces.ts`: 800m, 1500m, Mile, 3K, 5K, 10K, 15K, HM, Marathon):

1. **"Peak" / "VDOT (peak form)"** — `predictRaceTime(vdot, meters)` i `lib/fitness/vo2max.ts:51`. Binärsöker efter den tid som ger `vdotFromRace(distanceM, time) === vdot`, där `vdot` är **en enda blandad siffra** från `estimateVO2max()` (7 viktade modeller, se `vo2max.ts:445-690`). Detta är **default-kolumnen** som visas i UI (`components/stats/fitness-metrics.tsx:122`: `"VDOT (peak form)"`) och den som skickas till AI-coachen via `lib/ai/tools.ts:687-720` (`get_fitness_metrics`-verktyget exponerar `predictionsJson` rakt av).
2. **"Riegel" (personaliserad)** — `riegelPredict(anchorPB.timeSec, anchorPB.distanceM, meters, riegelExponent)` (`vo2max.ts:68`). `riegelExponent` kommer från `personalizedFatigueExponent()` (`vo2max.ts:255-285`): en log-log-regression `log(V) = a + k·log(D)` över **alla** `bestEfforts`-poster (1000m–42195m) från **alla** löpaktiviteter (ej bara lopp), där bara lutningen `k` används (`exponent = 1 - k`). `anchorPB` är PB:et med **högst implicit VDOT** av alla `RaceRecord`, oavsett distans.

Beräkningen sker på **två separata ställen** som måste hållas i synk om de ändras:
- `lib/fitness/cache.ts:226-258` (full recompute, körs efter varje Strava-sync)
- `lib/fitness/cache.ts` "fast"-path runt rad 540-602 (lättviktig incremental recompute)
- `app/api/stats/route.ts:130` (en tredje, enklare beräkning utan Riegel/personalisering — bör verifieras om den fortfarande används eller är dead code)

Resultatet cachas i `FitnessCache.predictionsJson` (`prisma/schema.prisma:436`) och konsumeras av:
- `components/stats/fitness-metrics.tsx` (tabellen på Stats-sidan)
- `lib/ai/tools.ts` (AI-coachens `get_fitness_metrics`-verktyg)

## 3. Empirisk diagnos (körd mot riktig data i lokal dev-DB)

Ett engångsskript (`scripts/_tmp_race_predict_check.ts`, körd och sedan borttagen — se §7 för hur man återskapar den) jämförde faktiska `RaceRecord`-PB mot vad båda modellerna predikterar **för exakt samma distans som PB:et**:

| Distans | Faktiskt PB | "Peak" (global VDOT) | Avvikelse | Riegel (personaliserad) | Avvikelse |
|---|---|---|---|---|---|
| 400m | 1:06 | 1:21 | **+22.7%** (för långsam) | 1:03 | -4.5% |
| 1K | 3:19 | 3:23 | +2.0% (lite långsam) | 3:10 | -4.5% |
| Mile | 5:37 | 5:38 | +0.3% | 5:37 | 0.0% (anchor) |
| 2K | 7:05 | 7:01 | -0.9% | 7:17 | +2.8% |
| 3K | 10:48–11:09 | 10:41 | -1 till -4% (lite snabb) | 11:52 | +6 till +10% |
| 5K | 18:15–18:34 | 17:53 | -2 till -3.7% | 21:53 | **+18 till +20%** |
| 10K | 38:41–43:03 | 36:17 | **-6 till -16%** (alldeles för snabb) | 50:16 | **+17 till +30%** (alldeles för långsam) |

Blandad VDOT vid körtillfället: 58.2 (high confidence). Personaliserad Riegel-exponent: **1.1997** (standard = 1.06; >1.06 betyder "tappar fart över distans").

**Detta matchar användarens upplevelse exakt** för "Peak"-kolumnen (default-visningen): kort = lite för långsam, lång = klart för snabb, växande monotont med distans. "Riegel"-kolumnen (den som ÄR personaliserad) är faktiskt **sämre** än "Peak" för 3K–10K — den överkorrigerar våldsamt åt fel håll.

## 4. Rotorsak (två separata buggar, inte en)

### 4a. "Peak"-kolumnen: en blandad VDOT passar inte denna löpartypen genom hela kurvan
`predictRaceTime` använder Daniels' universella %VO2max-vid-duration-tabell (`percentVO2maxFromDuration`, `vo2max.ts:34-47`), kalibrerad som ett **populationsgenomsnitt**. Den blandade `vdot` (58.2) är dominerad av rikligt 1K–5K-data (race-bekräftat, hög vikt). Den anpassar 1K–5K bra (±4%) men antar att löparen håller samma %VO2max vid 10K-duration som en "genomsnittlig VDOT-58-löpare" — vilket denna löpare **inte gör**: de faktiska 10K-resultaten implicerar bara VDOT 47.8–53.8, alltså klart sämre uthållighet vid den durationen än kortdistansformen antyder. Modellen vet inte att löparen är snabbare än sin uthållighet "borde tillåta".

### 4b. Riegel-kolumnen: en global exponent över HELA distansspannet är fysiologiskt fel
`personalizedFatigueExponent` blandar in **alla** `bestEfforts`-distanser från 1000m till 42195m i EN log-log-regression. Faktiska bästa-segment i denna databasen (verifierat):

| Distans | Implicit VDOT |
|---|---|
| 1000m–5000m | 56–60 (konsekvent, troligen race-nära) |
| 10000m | 53.8 |
| 15000m–marathon | **27–41**, fallande kraftigt |

15K–marathon-punkterna är `bestEffort`-segment ur Stravas rullande-fönster-statistik från **vanliga långa träningspass, inte lopp** — alltså submaximala ansträngningar vid den durationen, inte sant race-tempo. När regressionen tvingas passa EN rät linje (log-log) genom både "nästan maxinsats vid 1K" och "submaximal långkörning vid maraton" blir lutningen extremt brant (k=-0.1997, exponent 1.1997) — brantare än den verkliga lokala uttröttningskurvan i det aeroba 5K–10K-spannet. Att sedan extrapolera den globala exponenten lokalt från en Mile-ankare till 5K/10K via Riegel ger en kraftig överskattning av uttröttning → predikterade tider blir 18–30% för långsamma.

**Sammanfattning:** Det är inte "modellen är dålig åt en bestämd ände" — det är att (a) en enda global VDOT inte fångar att löparen har en spikigare profil (stark relativt kort, svagare relativt lång uthållighet), och (b) det enda försöket till personalisering som finns blandar ihop fysiologiskt olika regimer (anaerob/VO2max-dominant vs aerob uthållighet vs submaximal långkörning) i en enda linje, vilket gör den SÄMRE än att inte personalisera alls för just de distanser (5K, 10K) användaren bryr sig mest om.

## 5. Föreslagen lösning

Detta är en **rekommendation**, inte färdig kod — implementerande agent ska verifiera varje steg mot riktig data innan/efter ändring (se §6).

1. **Filtrera/vikta regressionsindata i `personalizedFatigueExponent`:**
   - Uteslut eller ge kraftigt reducerad vikt åt `bestEffort`-punkter som inte kommer från ett faktiskt lopp (`Activity.isRace`) OCH som ligger bortom ~15K — dessa är med stor sannolikhet submaximala långkörningssegment, inte uttröttningsdata.
   - Funktionen behöver utökas att ta emot `isRace`/källa per punkt (för närvarande tar den bara emot `{ distance, elapsed_time }` rakt från `bestEfforts`-JSON utan källkontext — den informationen finns i den anropande `Activity`-raden och måste skickas med).
2. **Ersätt "en global exponent + ett fast ankare för alla distanser" med en lokal/bracket-baserad metod:**
   - För att predicera distans `D`, hitta de(n) **närmaste kända verkliga resultat** (RaceRecord eller hög-konfidens bestEffort) som ligger närmast `D` (gärna en kortare + en längre granne om de finns) och beräkna en lokal Riegel-exponent mellan just dessa, istället för att alltid extrapolera från ett enda fast ankare (idag: Mile) över hela spannet till t.ex. 10K eller marathon.
   - Alternativ: dela upp i regimer (kort: ≤5K, mellan: 5K–21K, lång: >21K) och fitta separat per regim om datamängden räcker.
3. **Blanda "Peak" (global kurva) med den lokala/personaliserade modellen**, viktat efter avstånd från väldokumenterat intervall — nära distanser med riktiga PB:n litar mer på "Peak"; långt bortom dokumenterat intervall (t.ex. marathon utan någon riktig maratonracedata) litar mer på den breddare osäkerheten i `predictionRange()` snarare än ett skarpt tal.
4. **Flagga eller dölj prediktioner under ~1500m** som "utanför modellens giltiga intervall" — Daniels VDOT-tabellen är kalibrerad för ~3.5 min–3 h-insatser; 400m (66 sek) är strukturellt fel att köra genom samma tabell (+22.7% är inte ett "personaliseringsproblem", det är fel verktyg för jobbet).
5. Uppdatera **båda** beräkningsställena i `lib/fitness/cache.ts` (full + fast path) identiskt, och verifiera `app/api/stats/route.ts:130` — avgör om den tredje beräkningen fortfarande används någonstans eller är dead code som kan tas bort (Bug Audit Practice: bekräfta innan du rör den).

## 6. Validering (obligatoriskt innan denna plan arkiveras)

Implementerande agent ska:
1. Återskapa ett diagnostik-skript likt det i §7 (eller återanvänd om det fortfarande finns) som kör de nya funktionerna mot **riktiga lagrade `RaceRecord`** för den faktiska användaren, och skriver ut predikterat vs. faktiskt för varje distans med data.
2. Iterera tills 1K–10K-felet ligger inom ±3-5% (ner från dagens -16% till +30%), UTAN att införa ny systematisk bias åt motsatt håll.
3. Kontrollera att UI (`components/stats/fitness-metrics.tsx`) och AI-coachens `get_fitness_metrics`-verktyg (`lib/ai/tools.ts:687-720`) visar de uppdaterade, koherenta talen.
4. Köra `pnpm build --no-lint` och bekräfta inga TypeScript-fel innan commit.

## 7. Hur man återskapar diagnostik-skriptet

```bash
# scripts/_tmp_race_predict_check.ts (throwaway — radera efter användning)
# Importerar estimateVO2max/predictRaceTime/riegelPredict/personalizedFatigueExponent/vdotFromRace
# från lib/fitness/vo2max.ts, läser FitnessCache + RaceRecord + Activity.bestEfforts för
# prisma.user.findFirst(), och skriver ut predikterat vs. faktiskt PB per distans.
# Körs med: set -a && source .env.local && set +a && npx tsx scripts/_tmp_race_predict_check.ts
```

---

## Slutinstruktion till implementerande agent

Implementera genomtänkt, inte mekaniskt — det här är ett kalibreringsproblem, inte bara kod att skriva av. Iterera med riktiga data (§6) tills prediktionerna faktiskt matchar användarens uppmätta förmåga vid varje distans, inte bara "ser rimliga ut". När implementationen är klar:

1. **Dubbelkolla att den faktiska implementationen fungerar korrekt** — kör valideringen i §6 mot produktionens/dev-DB:ns riktiga data (inte bara enhetstester med påhittade siffror), och bekräfta att felet för 1K–10K har krympt mätbart utan att marathon/HM-osäkerheten blivit falskt skarp.
2. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` (sessionslogg + ev. Phase-checklist) och `docs/fitness/` om algoritmen ändras på ett sätt som påverkar den dokumenterade modellbeskrivningen där.
3. Flytta denna fil till `docs/planning/archive/` när allt ovan är bekräftat klart.
