# Garmin-data, HRV-bugg, LT-graf-bugg & visualiseringsöversyn

> **Status:** ARKIVERAD 2026-06-22 — Alla fyra faser implementerade samma dag, se Session 2026-06-22j i `docs/planning/IMPLEMENTATION_PLAN.md`. HRV- och LT1/LT2-buggfixarna är inte bekräftade live (kräver produktions-synk, ingen lokal Garmin-token). Temp/vind- och kadens/stegländgd-graferna samt readiness-score är verifierade mot riktig lokal data men inte mot körande UI (ingen webbläsarinloggning tillgänglig från detta verktyg).
> **Scope:** (1) varför HRV aldrig visas, (2) varför LT1/LT2-grafen är tom, (3) vad mer vi kan göra med Garmin-datan, (4) omdesign av temperatur/vind-statistik, (5) omdesign av kadens/steglängd.

---

## 1. Bugg: HRV visas aldrig

### Root cause (hög konfidens)
`lib/garmin/sync.ts:105` läser fel fältnamn från Garmins HRV-endpoint:

```ts
hrvNightly: toFloat(hrvSumm.lastNight),   // fel — fältet finns inte
```

Garmins `/hrv-service/hrv/{date}`-svar (verifierat mot tre oberoende källor som dokumenterar exakt denna unofficial-API-respons: MyDataHelps export-format, en tredjeparts referensdokumentation av `garminconnect`-bibliotekets `get_hrv_data()`-svar, samt python-garminconnect-källkoden) har fältet **`lastNightAvg`**, inte `lastNight`. `hrvSumm.lastNight` är alltså alltid `undefined` → `toFloat(undefined)` returnerar `null` (se `toFloat()` i samma fil) → `hrvNightly` blir `null` **varje gång**, för alla användare, sedan integrationen byggdes.

Samma bugg finns i den arkiverade Python-referensen `scripts/garmin_sync.py:137` (`hrv_summary.get("lastNight")`) — konsekvent med TS-koden, vilket pekar på att bugg introducerades en gång och kopierades till båda implementationerna.

`hrvBalance` (fältet `status`) är **korrekt** — det är bara `hrvNightly`/RMSSD-värdet som saknas. Det förklarar varför HRV-balans-färgkodning teoretiskt skulle kunna dyka upp men själva ms-värdet och hela linjen i `HrvTrendChart` aldrig gör det (komponenten gömmer sig helt om `hrvNightly` är null för alla punkter — `components/charts/HrvTrendChart.tsx:47-50`).

**Kunde inte verifieras direkt mot lagrad data** — den lokala dev-databasen har ingen `GarminAccount`-rad och 0 rader i `GarminDailySummary` (Garmin-synk kräver riktiga OAuth-tokens som bara finns i produktion). Diagnosen vilar därför på fältnamnet, inte på att se `null` i en faktisk rad — men tre oberoende källor är överens, och `toFloat()`s `undefined`-hantering gör felet deterministiskt om fältnamnet stämmer.

### Påverkan
Alla konsumenter av `hrvNightly` är påverkade: `HrvTrendChart`, dashboard-kortet (`app/(dashboard)/dashboard/page.tsx:258-259`), HRV-trend-jämförelsen i dashboardens insights (`:454-459`), och AI-context (`lib/ai/context-builder.ts:129`).

### Föreslagen fix
1. `lib/garmin/sync.ts`: `hrvSumm.lastNight` → `hrvSumm.lastNightAvg`.
2. `scripts/garmin_sync.py`: samma ändring (`hrv_summary.get("lastNightAvg")`), för konsekvens med den dokumenterade referensimplementationen.
3. **Bonus-data tillgänglig i samma respons, inte lagrad idag:** `weeklyAvg` (Garmins egna 7-dagars rullande baslinje), `lastNight5MinHigh`/`lastNight5MinLow`. Se §4 för förslag på att fånga `weeklyAvg` — kräver schemamigrering, föreslås som separat fas.

### Verifiering efter fix
Kan inte testas lokalt (inga Garmin-tokens). Efter deploy: trigga en Garmin-synk (eller vänta på 08:00-cronen) och kontrollera att `GarminDailySummary.hrvNightly` får ett värde nästa dag, samt att HRV-grafen i Stats/Dashboard visar data.

---

## 2. Bugg: LT1/LT2-grafen (LT/AT pace development) visar inget

### Root cause (verifierad)
**Algoritmen i sig är inte trasig.** Jag körde `scripts/rolling-lt-test.ts` (en redan existerande, fristående reimplementation av exakt samma pipeline, skriven av en tidigare session för just denna typ av debugging) mot den lokala kopian av riktig produktionsdata (7800+ aktiviteter, upp t.o.m. 2026-06). Den producerade giltiga LT1/LT2-punkter för **22 av de senaste ~30 månaderna**, med R² 0.96–1.00. Jag körde sedan den faktiska produktionsfunktionen `updateVO2maxAndPaces()` (från `lib/fitness/cache.ts`) direkt mot samma lokala databas — den lyckades och skrev 22 månader av giltig `ltPaceTrend`-data till `FitnessCache.extraVizJson`.

Det här utesluter "datan räcker inte" eller "tröskelvärdena är fel" som förklaring (vilket var den senaste sessionens hypotes — se commit `1a77b9f` från idag, som lade till debug-loggning i `estimateZonesFromStatisticalAnalysis` för att hitta just detta).

**Den faktiska boven: tyst felsvepning.** `ltPaceTrend` skrivs **bara** av `updateVO2maxAndPaces()`, som anropas (fire-and-forget) från tre ställen:

| Anropsplats | Felhantering |
|---|---|
| `app/api/strava/sync/route.ts:39` (manuell Sync-knapp) | `.catch(e => console.error(...))` ✅ loggar |
| `app/api/cron/sync/route.ts:39` (daglig 06:00-cron) | `.catch(() => {})` ❌ **helt tyst** |
| `lib/strava/backfill-runner.ts:87` (efter backfill) | `.catch(() => {})` ❌ **helt tyst** |

Om funktionen kastar ett fel — oavsett orsak, t.ex. en övergående DB-timeout precis efter en stor 2-årig backfill, eller någon av de Garmin/Strava-buggar som fixats i dagens tidigare commits — så **försvinner felet helt** i två av tre fall. Caten skrivs aldrig, `ltPaceTrend` förblir tomt, och ingenstans loggas att något gick fel. Det stämmer exakt med symptomet "visar inget alls" utan någon synlig felindikation, och med att dagens session (commit `1a77b9f`, samma dag) redan grävde i fel ställe (algoritmens trösklar) utan att hitta orsaken — eftersom den verkliga boven är osynlig tystnad, inte fel logik.

### Föreslagen fix
1. Gör de två tysta `.catch(() => {})` till `.catch(e => console.error("[fitness-cache] ...", e))`, konsekvent med det redan korrekta mönstret i `strava/sync/route.ts`.
2. Efter deploy: tryck på manuella "Sync"-knappen en gång (den har redan korrekt loggning och kommer trigga en ny `updateVO2maxAndPaces()`-körning) — om grafen då fylls i bekräftar det diagnosen. Om den fortfarande är tom, loggraderna avslöjar nu den verkliga stacktracen.

### Verifiering
Körde `npx tsx scripts/rolling-lt-test.ts` och en tillfällig direktkörning av `updateVO2maxAndPaces()` mot lokal data — båda lyckades utan ändringar. Detta är alltså inte en bugg i statistiken/breakpoint-detektionen (som redan blivit hårt validerad genom många tidigare fix-commits), utan ett observability-hål i felhanteringen.

---

## 3. Garmin-data → mer intressant statistik

### Vad vi har idag (lagrat, delvis outnyttjat)
`GarminDailySummary`: `restingHR`, `hrvNightly` (buggad, se §1), `hrvBalance`, sömnstadier (deep/light/REM/awake + score), `bodyBattery`, `respirationRate`, `stressAvg`, `trainingReadiness` (Garmins egen 0–100), `spo2Avg`, `steps`.

Garmins `trainingReadiness`-poäng visas redan rakt av (ingen egen viktning). Den dokumenterade idén i `docs/architecture/overview.md` — "Readiness score = HRV 40% + TSB 30% + sömn 20% + vilopuls-trend 10%" — är **aspirationsdokumentation, inte byggd kod**. Den planerades i `docs/planning/archive/ANALYTICS_PLAN.md` §1G ("Recovery Dashboard") och nedprioriterades, men aldrig avskriven av en konkret anledning.

### Forskningsbaserade förslag

**a) 7-dagars rullande HRV-baslinje + koefficient av variation (CV) för overreaching-detektion.**
Forskning (t.ex. MDPI 2026 narrative review om HRV-monitorering hos idrottare) visar att ett sammanhållet ≥20% fall i RMSSD-baslinjen (7-dagars rullande snitt) kan föregå icke-funktionell overreaching eller sjukdom, och att en **stigande** CV (dag-till-dag-variation kring baslinjen) är ett tidigt varningstecken på maladaptation — medan en **kollapsande** CV (ovanligt stabilt, "fastklämt" HRV nära baslinjen) paradoxalt också kan signalera tidig overreaching. Det här är rikare och mer evidensbaserat än att bara plotta råa nattliga HRV-punkter, vilket är allt vi gör idag.
- **Förslag:** beräkna 7-dagars rullande medel + CV av `hrvNightly`, flagga (a) baslinje-fall ≥20% under personlig 60-dagars baslinje, (b) ovanligt hög ELLER ovanligt låg CV två veckor i rad.

**b) Riktig composite Readiness-score (bygg det som redan var planerat).**
HRV (relativt 7-dagars/60-dagars baslinje, inte absolutvärde — individer skiljer sig kraftigt) + TSB (redan beräknat) + sömnscore + vilopuls-trend (redan lagrat). Garmins egen `trainingReadiness` kan visas parallellt som jämförelse/sanity-check, inte ersättas.

**c) Fånga `weeklyAvg` från samma HRV-respons** (kräver schemafält + migrering) — Garmins egen baslinje, bra cross-check mot vår egen rullande beräkning ovan.

**d) Sömn × prestanda-korrelation.** Vi har redan sömnstadier per natt och prestanda (EF, pace-trends) per dag — ingen koppling görs idag. Ett enkelt scatter (sömnscore senaste natten vs. nästa dags EF/RPE) skulle vara ett första, lättbyggt steg.

**e) Body Battery / stress som träningsbelastnings-cross-check.** `stressAvg` + `bodyBattery` finns redan lagrat och visas i `GarminWellnessChart`, men aldrig korrelerat mot `TSB`/`ACWR` — t.ex. "är ATL/CTL-baserad belastning i linje med vad kroppen *faktiskt* rapporterar den dagen?" är en bra avstämningsvy.

### Prioritering (förslag)
(a) och (b) ger mest värde för minst kod (ren beräkning på redan lagrad data, ingen ny lagring). (c) kräver migrering — gör separat. (d)/(e) är enkla men lägre prioritet — för senare fas, inte denna omgång.

---

## 4. Nuvarande visualisering — smoothing, rekommendationer, projektioner (översyn)

| Mekanism | Var | Status |
|---|---|---|
| EWMA-smoothing | ATL (7d) / CTL (42d) i `lib/fitness/training-load.ts` | Inbyggt i beräkningen, ingen extra graf-smoothing behövs |
| Linjär regression + projektion | `LTPaceTrendChart` (3 månader framåt), `EasyPaceTrendChart` (trendlinje) | Implementerat |
| Spikborttagning + rate-cap | `smoothLTTrend()` i `lib/fitness/cache.ts` (±15s isolerade spikar, 20s/månad-tak) | Implementerat, hårt validerat över många bugfix-iterationer |
| Råa Garmin-wellness-grafer (HRV, sömn, vilopuls, body battery/stress/readiness) | `HrvTrendChart`, `SleepTrendChart`, `RestingHRTrendChart`, `GarminWellnessChart` | **Ingen smoothing alls** — råa dagliga punkter |
| Composite "recommendations"-text | `lib/fitness/insights.ts` | Genererar kommentarer (TSB/volym/CTL/VO2max-baserat), ingen HRV-kopplad rekommendation |

**Iakttagelse:** smoothing/projektion finns redan väl utbyggt för träningsbelastning och pace-trender, men Garmin-wellnessdata (HRV, sömn, vilopuls) visas helt orensat. Givet hur brusig nattlig HRV är (forskningen ovan bygger uttryckligen på 7-dagars rullande snitt, inte enskilda nätter), är ett rullande 7-dagars snitt ovanpå råpunkterna i `HrvTrendChart` en naturlig, lättbyggd förbättring som direkt stödjer §3a.

---

## 5. Temperatur & vind — omdesign

### Nuläge
"Weather profile"-kortet (`app/(dashboard)/stats/stats-client.tsx:570-704`) visar **fyra separata listor** av diskreta hink-barer (temp-bins á 5°C, 4 vindhinkar, 3 nederbördshinkar, samma temp-hinkar igen HR-normaliserat) plus två fristående regressions-tal ("Cold penalty", "Heat impact"). Datan bakom är redan bra — varje aktivitet har en `adjustedPace` (fitness-drift-korrigerad relativ pace, beräknad i `computeWeatherStats()`) kopplad till sitt `weatherTemp`/`weatherWind` — men presentationen är fragmenterad över fyra block.

### Förslag (matchar idén om X=temperatur/vind, Y=relativt tempo)
Ersätt de diskreta hink-barerna för temp och vind med **ett scatter-diagram per variabel**: X-axel = temperatur (eller vindhastighet), Y-axel = `adjustedPace` (redan beräknad relativ pace, fitness-drift-korrigerad) uttryckt som avvikelse i s/km från medianen. Lägg på en glidande regressions-/LOESS-kurva ovanpå punktmolnet. Detta:
- Konsoliderar fyra listor + två lösa tal till **två koherenta diagram** (temp, vind), med "Cold penalty"/"Heat impact" som annoterade trendlinje-lutningar direkt i samma graf istället för separata siffror.
- Visar den faktiska formen på relationen (t.ex. är den linjär, eller finns en platå/tröskel?) istället för 5°C-klumpar.
- Stöds av forskning: marathon-prestanda försämras ~0.3–0.4 %/°C WBGT utanför optimala 7.5–15°C, och vind har en **asymmetrisk** effekt (motvind kostar ~2–3x mer än medvind ger tillbaka, pga dragkraft som skalar med vindhastighet i kvadrat) — en kontinuerlig kurva fångar denna asymmetri naturligt, vilket fyra symmetriska hinkar inte gör.
- HR-normaliserad temp-vy (`hrNormByTemp`) kan bli en växlingsbar overlay/sekundär serie i samma graf snarare än en femte separat lista.

Nederbörd (`byPrecip`) har bara 3 hinkar och fungerar fortsatt fint som enkel barlista — ingen anledning att göra om den.

---

## 6. Kadens & steglängd — omdesign

### Nuläge
`stats-client.tsx:483-511` — ett `ComposedChart` med kadens (SPM) och steglängd (m) plottade **över tid** (vecka för vecka, senaste 26 veckorna), två linjer på separata Y-axlar.

### Varför detta är fel verktyg
Hastighet = Kadens × Steglängd är en matematisk identitet, inte ett tränat samband. Vecka-till-vecka-variation i kadens/steglängd drivs nästan helt av **vilken typ av pass** som kördes den veckan (mycket lugna pass vs. mycket intervaller) — inte av en verklig neuromuskulär förändring. En tidsserie över veckor blandar därför ihop "den här veckan hade jag fler intervaller" med "min löpteknik förändras", vilket gör grafen svårtolkad och, som du påpekade, inte särskilt relevant.

### Förslag
Plotta kadens och steglängd **mot pace** (scatter, en punkt per aktivitet eller per veckosnitt-bucket vid en given pace), inte mot tid. Det visar den faktiska kadens/steglängd-kurvan — hur löpteknik skalar med fart, vilket är den biomekaniskt meningsfulla relationen (väldokumenterat: snabbare löpare ökar primärt steglängd, inte kadens; kadens stiger bara 10–15 spm över hela tempospannet hos de flesta löpare). Lägg till **tidsdimension som färg/period-overlay** istället för X-axel: t.ex. färgkoda punkter efter recency (ljusare = nyare), eller rita en regressionslinje för "senaste 8 veckorna" ovanpå en för "8–16 veckor sedan" — då ser man om hela kadens-vid-given-pace-kurvan har flyttat sig (den genuint tränbara signalen, t.ex. högre kadens vid SAMMA lugna pace efter teknikarbete) utan att blanda in vilken blandning av pass som råkade köras en given vecka.

---

## 7. Implementationsplan (faser)

**Fas 1 — Buggfixar (litet, lågrisk, gör nu):**
1. `lib/garmin/sync.ts` + `scripts/garmin_sync.py`: `lastNight` → `lastNightAvg`.
2. `app/api/cron/sync/route.ts` + `lib/strava/backfill-runner.ts`: tysta catchar → loggade catchar.

**Fas 2 — Temperatur/vind-omdesign:** nytt scatter+trend-diagram för temp och vind i `WeatherProfileCard`, byggt på redan beräknad `adjustedPace`-data (ingen ny backend-logik, bara ett nytt sätt att skicka punkter istället för hinkar + ett nytt chart-komponent).

**Fas 3 — Kadens/steglängd-omdesign:** ny scatter-vy (kadens/steglängd vs pace, recency-färgkodad) ersätter tidsserie-grafen. Kräver att vi exponerar per-aktivitet (pace, spm, strideM, datum) istället för bara veckosnitt.

**Fas 4 — Garmin-statistik (HRV-baslinje/CV + readiness-score):** ny beräkningslogik i `lib/fitness/` (eller en ny `lib/garmin/insights.ts`) ovanpå redan lagrad `GarminDailySummary`-data. Ingen schemaändring krävs för (a)/(b)/(d)/(e) i §3 — bara (c) `weeklyAvg`-fångst kräver migrering, görs separat om alls.

**Föreslagen ordning denna omgång:** Fas 1 (måste göras), sedan Fas 2 och 3 (det du efterfrågade konkret), Fas 4 som efterföljande arbete om tid finns — composite readiness-score är ett större designbeslut (vilka vikter, hur visa den) som hellre tas i ett eget steg.

---

## 8. Öppna frågor

- Fas 4 (readiness-score): vill du att jag bygger en första version nu, eller dokumentera förslaget och vänta?
- `weeklyAvg`-fångst (kräver `prisma db push` i produktion) — nu eller senare fas?
