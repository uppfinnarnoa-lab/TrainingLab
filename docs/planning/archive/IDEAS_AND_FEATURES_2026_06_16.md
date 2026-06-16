# TrainingLab — Feature Ideas & Improvement Analysis

> Genomgång av kodbasen + webbresearch 2026-06-16. Syftet är att ge konstruktiva
> förslag på nya funktioner, bugfixes, nya beräknade värden och UX-förbättringar
> för ett personligt AI-träningsverktyg för en orienteringsspecialist / löpare /
> cyklist / skidåkare.

---

## Metodik

Genomgång av följande filer:
- `lib/fitness/vo2max.ts`, `training-load.ts`, `zones.ts`, `decoupling.ts`, `insights.ts`
- `app/(dashboard)/stats/stats-client.tsx`, `dashboard/page.tsx`, `activities/[id]/page.tsx`
- `lib/ai/prompts.ts`, `context-builder.ts`
- `prisma/schema.prisma`, `docs/planning/IMPLEMENTATION_PLAN.md`
- Webbresearch på moderna träningsmetriker 2023–2025

---

## Vad som redan finns (summering för kontext)

Plattformen är redan ovanligt avancerad:
- **VO2max**: 8-modellsestimering med VDOT, Critical Speed, HR-pace regression (Firstbeat-stil), Uth-Sørensen, Cooper, decay bridge, TSB-justerat, HR-formsignal
- **Load**: ATL/CTL/TSB med 2 års datakurva, ACWR, ramp rate, injury risk score
- **Zoner**: LT1/LT2 statistisk estimering (piecewise regression), aerobic decoupling, polarisation (Seiler 80/20)
- **Prestanda**: AEI-trend, running economy proxy, VDOT-trend, LT/AT pace development, terrängfaktor för OL
- **Väder**: Temperatur + vind + nederbörd påverkan på pace (fitness-drift-korrigerad)
- **AI-coach**: Streaming, tool-calls, prompt-caching, Claude + Gemini
- **Planner**: Träningsblock, mallar, outcome-logging, veckosummering

---

## 1. Deferred features — planen nämner dem, de saknas fortfarande

### 1A. Kadensanalys och steglängdstrend *(liten)*

**Vad:** Kadensdata (`averageCadence`) finns i DB:n för varje aktivitet. Inget chart finns.

**Beräkna:**
```
stepsPerMin = averageCadence × 2
strideLength (m) = averageSpeed / (averageCadence × 2 / 60)
```

**Visa:**
- Rullande 8-veckors kadensmedel på löpning (linjediagram, "Fitness"-fliken)
- Steglängdstrend parallellt
- Tooltip: *"Optimal kadens för de flesta löpare: 170–185 spm. Låg kadens indikerar oftatöversteget, ökar belastning på leder. Förbättring med 5–10% kan minska stötbelastning markant."*

**Orientering:** OL-löpning har lägre kadens än road (terräng tvingar kortare steg) — ett intressant riktmärke att separera.

---

### 1B. Aerobic decoupling (Pa:HR) PER aktivitet *(liten)*

**Vad:** Decouplingberäkning (`lib/fitness/decoupling.ts`) körs för LT1-estimering men visas INTE på enskilda aktivitetssidor.

**Visa:** På aktivitetssidan (efter splitdiagrammet), för steady-state-löpningar ≥ 45 min:
```
Pa:HR drift: +3.2%  ← grön (<5% = välkopplad)
Halvtider: 1:03:20 (GAP 4:22/km, 148 bpm) → 1:01:45 (GAP 4:19/km, 152 bpm)
```
- Drift < 5%: Väl kopplad — bra aerob bas
- Drift 5–10%: Något avkopplad — viss stressrespons
- Drift > 10%: Hög avkoppling — tränade sannolikt över din aeroba tröskel

---

### 1C. Aktivitet → Planerat pass matchning *(medium)*

**Vad:** Strava-aktiviteter syns i kalender men matchas inte automatiskt mot planerade pass. `matchedPlannedId` fältet finns i schema men är alltid null.

**Algoritm:**
1. För varje synkad aktivitet: hitta planerade pass på ± 1 dag med samma sporttyp
2. Om avstånd-avvikelse < 20% och varaktighet-avvikelse < 25%: auto-matcha med konfidenspoäng
3. Annars: visa som förslag ("Matchade du *Tempolöpning 8km* mot detta pass?")
4. Manuel override alltid möjlig

**Värde:** Ger kompletteringsrate för planerade block, feedar Block-statistiken.

---

### 1D. Block-editor modal *(medium)*

**Vad:** `BlockBanner.tsx` visar block men "New block"-knappen finns utan funktionalitet (se IMPLEMENTATION_PLAN deferred list).

**Innehåll:** Modal med:
- Namn, typ (Base/Build/Peak/Taper/Custom), datumintervall
- Färgval (förvalda per typ)
- Mål-km/vecka, intensitetsprofil (polariserad / pyramidal / tröskel)
- Länk till A-tävling

---

### 1E. Årsgoal-tracker *(liten)*

**Vad:** Planerat i IMPLEMENTATION_PLAN (6.3 "Goals & Progress") men ej byggt.

**Implementering:** Enkel widget på dashboard:
- Sätt distansmål per sport för innevarande år
- Visuell progress-båge + "På spåret för X km"-prognos
- Jämförelse vs föregående år

**Schema:** Ny `AnnualGoal`-tabell: `{ year, sportId, targetKm }` eller enklare: JSON i `AthleteProfile`.

---

### 1F. Jämförelsevy (period A vs B) *(medium)*

**Vad:** Välj valfria två perioder → visa alla nyckeltal sida vid sida.

**Användningsfall:**
- Den här månaden vs förra månaden
- Pre-skada vs post-skada
- Vinter vs sommar
- Den bästa träningsblocket vs nuvarande

---

## 2. Nya metriker — beräkningar med befintlig data

### 2A. Efficiency Factor (EF) *(liten → stor nytta)*

**Formel:**
```
EF = avgSpeed (m/min) / avgHR (bpm)
```
eller för ett givet pass:
```
EF = normalized pace speed / avgHR
```

**Varför:** EF är Coggans nyckeltal för aerob träningsframsteg. Stigande EF vid samma effort = bättre kondition. Plattar sig under hög träningsbelastning = normal trötthetseffekt.

**Visa:** Rullande 4-veckors EF per löpning (linjediagram), filtrera på easy-runs (under LT1). Aktuell EF och trend jämfört med 12-veckors baseline.

**Referens:** EF ~1.35–1.55 för vältränade löpare i easy-zone. Förbättring av 0.05–0.10 under en träningssäsong är signifikant.

---

### 2B. Pace Variability Index (PVI) *(liten)*

**Formel:**
```
PVI = stddev(splitPaces) / avgPace × 100   (%)
```

**Varför:** Låg PVI = jämnt tempo = effektivt löpande (< 3% för steady runs, < 5% för tuffa). Hög PVI i en tempolöpning indikerar dålig tempokontroll eller kuperad bana.

**Data:** Splitdata finns i `splitsMetric` JSON för nästan alla aktiviteter.

**Visa:** Per aktivitet (under splits-tabellen). Tooltip: *"Pace Variability Index mäter hur jämnt du höll tempot. <3% = utmärkt pacingkontroll."*

---

### 2C. Training Monotony + Training Strain *(medium)*

**Formel (Bannister):
```
Monotony = dailyTSS_avg / dailyTSS_stddev
Strain = weekTSS × Monotony
```

**Varför:** Hög monotoni (> 1.5) = alla dagar har ungefär samma belastning = ökad skaderisk och stagnation. Variation i träning (hård/lätt/vila) ger lägre monotoni = mer adaptivt stimulus.

**Referens:** Foster (1998) — Monotony > 2.0 kombinerat med hög Strain korrelerar starkt med sjukdom och skada.

**Visa:** Veckokort på Load-fliken med Strain-värde och Monotony-gauge. Markera röda veckors med "Hög monotoni".

---

### 2D. Running Effectiveness (RE) per löpning *(liten)*

**Formel:**
```
RE = avgSpeed / VO2estimate_at_HR
```

Med VO2 vid given HR-ratio (från HR-pace regressionmodellen):
```
VO2 at avgHR = slope × avgHR + intercept
RE = (avgSpeed_mpermin / VO2) × 1000   (ml/kg/min per m/min)
```

**Varför:** Löpekonomi — hur effektivt du omvandlar oxygen till rörelse. Förbättras med volym, styrketräning och teknik. Skilj från AEI (som är simpler speed/HR).

---

### 2E. Accelerationsanalys för intervaller *(medium)*

Från splitdata: hur snabbt når du målpace i en interval-start?
- Acceleration-dist (m) till 98% av intervalltempo = explosivt kapacitetsmått
- Finns naturligt i lap-data om Garmin-klocka trycks

---

### 2F. Personaliserat trötthetsprofil (återhämtningshastighet) *(medium)*

**Idé:** Modellera hur lång tid din TSB tar att återhämta sig efter en given TSS-dag.

Jämför:
- TSS-dag → hur många dagar till TSB återgår till +0?
- Jämför med föregående år (förbättrad återhämtning = bättre kondition)

---

### 2G. Altitude-korrigering *(liten)*

Aktiviteter på > 1000 m har förhöjt HR och lägre pace p.g.a. syrefattig luft.

**Korrektion:**
```
altPenalty_paceSecPerKm = altitude_m / 1000 × 15  (≈ 1.5% per 1000m)
altAdjPace = rawPace / (1 + altPenaltyFraction)
```

**Data:** Strava ger `totalElevationGain` men inte startaltitud. Open-Meteo har elevation lookup via koordinater som redan extraheras för väder.

**Visa:** Liten badge på aktivitet: "Höjdkorrigerat" om banan startar > 800m.

---

### 2H. Åldersgradering (Age-Graded Performance) *(liten)*

**Formel:** WMA 2023 Age Grade-tabeller:
```
AgeGrade% = worldRecordTime(dist, sex) / yourTime × ageGradeFactor(age, dist, sex) × 100
```

**Referens:** WMA 2023 factorer för 5K, 10K, HM, Marathon per kön och åldersgrupp.

**Varför:** Möjliggör meningsfull jämförelse av löpartider från 20–60 år. Att springa 40:00 på 10K som 50-åring = ~75% age grade, vilket är världsklass för åldern.

**Visa:** På race-sidan, per tävling: "Age grade: 74.3% (Excellent)".

**Kategorier:** < 60% Local | 60–70% Regional | 70–80% National | 80–90% World Class | 90%+ WR class

---

### 2I. Heart Rate Recovery (HRR) *(medium — kräver streams)*

**Formel:**
```
HRR60 = peakHR_during_effort - HR_after_60_seconds
```

**Varför:** HRR60 är ett av de starkaste markörer för kardiovaskulär hälsa och aerob kapacitet. HRR > 25 bpm = bra, > 35 = utmärkt. Förbättras med träning.

**Krav:** Strava activity streams (per-sekund HR-data). Streams hämtas redan on-demand men cachar inte.

**Alternativ:** Om streams caches på inbound Strava webhook, kan HRR extraheras automatiskt vid sync.

---

### 2J. Beräknad aerob kapacitet (D') *(avancerat)*

**W' (Work' / D'): kritisk hastighet + anaerob reserv:**
```
D' = total work above CS  (meter × sekund)
```

Ger information om hur stor "anaerob buffert" du har ovanför critical speed. Användbart för orientering (explosiv stigning, teknisk accelerering).

Beräknas från intervalldata — requires lapdata med effort metrics.

---

## 3. Aktivitetssida — förbättringar

### 3A. Gradient-färgad GPS-karta *(medium)*

Nuläge: Karta visar spåret i en färg.

**Nytt:** Färgkoda spåret per `speed`, `HR` eller `elevation gradient`:
- Grön = fast/lätt, röd = långsam/tungt
- Välj färgvariabel med toggle

**Implementation:** Leaflet stöder PolylineDecorator. Streams krävs för speed/HR per punkt.

---

### 3B. "Liknande pass" sektion *(liten)*

Under aktivitetssidan: "Senaste liknande pass" — samma sporttyp, liknande distans (±20%):
- Snabbaste 3, senaste 3
- Jämförtabell: dist, tid, pace, HR, väder

---

### 3C. Ny best effort-highlight *(liten)*

Om ett best effort-värde (`bestEfforts` JSON) slår ett personligt rekord i DB:n (`RaceRecord`), visa en banner:
```
🏆 Nytt personbästa! 5K: 20:14 (–12 sekunder)
```

Logik: Jämför `bestEfforts[name].elapsed_time` mot snabbaste `RaceRecord` av matchande distans.

---

### 3D. Aerobic decoupling per löpning *(se 1B ovan)*

---

### 3E. Grade Adjusted Pace (GAP) synligt på aktivitetssidan *(liten)*

GAP-formeln (`gradeAdjustedPace` i `vo2max.ts`) beräknas redan internt. Visa det som ett stats-kort:
```
GAP: 4:18/km   (Avg pace: 4:35/km · Elevation: +245m)
```

---

### 3F. Prev/Next-navigering mellan aktiviteter *(liten)*

Lägg till "←" och "→" pilar på aktivitetssidan för att bläddra till föregående/nästa aktivitet utan att gå tillbaka till listan.

---

## 4. Dashboard-förbättringar

### 4A. "Idag"-panel *(medium)*

En dedikerad sektion längst upp på dashboarden:

```
Idag — tisdag 16 juni

Planerat: Tempolöpning 10km (LT-arbete) · 16:30
Form: TSB +6 (Fresh) · Lämpligt för kvalitetspass

Väder idag: 18°C, 12 km/h vind, molnigt
Din pace-justering för 18°C: +0 sek/km (idealt)

💡 HRV idag: 58ms (normal, stabil trend)
```

Kräver: Väder-API för framtida väder (Open-Meteo stöder det), Garmin HRV för idag.

---

### 4B. Träningsstatus-panel (Readiness) *(medium)*

Kompositpoäng som planen specificerade men inte är byggt:
```
Readiness: 78/100 🟢
  HRV: 58ms ← Balanserad (40%)
  TSB: +6 ← Fresh (30%)
  Sleep: 7.2h, score 74 (20%)
  RHR: 42 ← Normal (10%)
```

Kräver Garmin-integration (HRV, sömn, RHR).

---

### 4C. Automatiska träningsinsikter *(medium)*

Utöka `generateInsights()` i `lib/fitness/insights.ts` med:
- Kadenstrend: "Din kadens har sjunkit 3 spm de senaste 4 veckorna — kan indikera trötthet"
- EF-trend: "Aerob effektivitet förbättrades +8% sedan mars — tydlig fitnessutveckling"
- Polarisering: "Hög andel Z3 (tempo-zone) senaste 8 veckorna — riskerar 'junk miles'"
- Väderkoppling: "Du har tränat i medeltal 3°C kallare än normalt denna vecka — kompensera paceförväntningarna"
- Skaderisk-mönster: "Du har missat 2 pass p.g.a. knäsmärta det senaste halvåret — alltid efter veckor >90km"

---

### 4D. Streak-refining *(liten)*

Nuläge: "Consecutive days" som räknar kalender-dagar.

**Bättre:** Separera:
- Löpstreak (dagar i rad med löpning)
- Aktivitetsstreak (dagar med någon aktivitet)
- Visa längsta streak hittills

---

## 5. Träningsplaneringen — förbättringar

### 5A. Drag-and-drop från bibliotek till kalender *(medium)*

Planerat sedan fas 3, fortfarande deferred. Implementera med `@dnd-kit`:
- Dra template-kort → släpp på valfri kalenderdag
- Dra planerat pass → flytta till annan dag

---

### 5B. Week/Block/Plan detail panel *(medium)*

`DetailPanel.tsx` med Week/Block/Plan-tabbar är planerat men dator-flikstrukturen är inte implementerad. Klick på veckosummering öppnar:
- **Vecka-flik**: Fullständig volym per sport, zondistribution, planerat vs utfört
- **Block-flik**: Aktuell blockaggregat, polariseringstrend
- **Plan-flik**: Hela säsongsöversikt med läsmark för nästa tävling

---

### 5C. AI-genererad träningsplan *(stor)*

Nuläge: AI-coach kan svara med träningsplaner i text.

**Nytt:** Strukturerat svar → automatisk import till kalender:
- Knapp: "Planera de kommande 8 veckorna mot [Tävling]"
- Coach genererar veckostruktur som JSON (`plan-action`-formatet finns redan i prompts.ts)
- Preview visas → användaren godkänner → passet läggs in i planner

Parse-logiken finns delvis i `lib/ai/tools.ts`.

---

### 5D. Tapper-automatik *(liten)*

När en A-tävling finns i kalenern: automatisk taper-startmarkering baserat på distansen:
- Marathon → taper startar 3 veckor ut
- 10K/15K → 10 dagar
- 5K → 7 dagar
- Halvmaraton → 2 veckor

Planen nämner detta men det är oklart om det är implementerat på riktigt.

---

### 5E. Passkommentar / Snabbnotes *(liten)*

På planerade pass: ett fritextfält "Anteckning" som sparas i `PlannedWorkout.notes`. Visas i veckovyn som ett litet antecknings-ikon.

Skillnad: Till skillnad från Strava-beskrivningen (som synkas bakåt) är detta ett internt planerings-anteckning.

---

## 6. Orienteringsspecifika funktioner

### 6A. Orienteringssäsongsvy *(medium)*

OL har en tydlig säsongsstruktur: vinter = grundträning, vår = teknikuppbyggnad, sommar = tävlingssäsong.

**Ny vy:** Årshjul eller säsongskalender som visar:
- Träningsfaser (Bas / Teknik / Tävling / Vila)
- OL-pass vs löppass fördelning per månad
- Andel terrängpass vs väg per kvartal

---

### 6B. Teknisk kostnadsfaktor (Terrängfaktor) *(liten — delvis byggt)*

`TerrainFactorCard` finns redan och visar OL pace vs road pace. Utöka:
- Separera grovterräng vs finskogsmark vs sprint-terräng (baserat på aktivitetsnamn-keywords)
- "Din terrängkoefficient: +28% (normal: 20–40% för elitorienterare)"

---

### 6C. Teknisk volym (tid i OL-terräng) *(liten)*

Separata metriker för tid i OL-terräng per vecka/månad:
- Teknisk volym i timmar (OL-aktiviteter exklusive road)
- Mål: en OL-löpare på elitnivå har generellt 60–80% av total volym som terrängaktiviteter under tävlingssäsong

---

### 6D. OL-tävlingsanalys (orienteering race) *(stor)*

När en OL-tävling loggas i Strava: dedikerad vy med:
- Kurs-analys: total distans, höjdmeter, beräknat tempo per terrängtyp
- Jämförelse mot liknande OL-tävlingar (distans, terräng, säsong)
- "Vinnartid på Strava Leaderboard" (om lopp är publikt) för relativ jämförelse

Begränsning: Strava har ingen separat OL-kurs-data. Allt beräknas från GPS.

---

## 7. AI-coach förbättringar

### 7A. Proaktiva veckonotiser *(medium)*

Varje måndag: AI genererar en kort veckoöversikt automatiskt:
```
Vecka 25 — Träningsstatus

Förra veckan: 72 km, TSS 380. Polarisering 78% easy — bra.
Körde tempolöpningen i +24°C — HR 8 bpm högre än normalt.

Den här veckan: BUILD block v3/5. Planerat 78 km.
Rekommendation: Kvalitetspasset på onsdag är kritiskt — din TSB är +4 (ideal).

Uppmärksamhet: Terrängvolymen har legat lågt 3 veckor — säsongens OL-premier 6 veckor bort.
```

Genereras som en `Message` i en dedikerad "veckoöversikt"-konversation.

---

### 7B. Sprint-coaching per aktivitet *(liten)*

Knapp på aktivitetssidan (utöver befintliga WorkoutAnalysis): "Snabb AI-feedback".

Kräver bara: namn, distans, pace, HR, väder, typ → compact prompt.

Resultat: 3–5 meningar direkt feedback. Typ:
- "Bra tempolöpning. HR på 87% max i 22°C är 4 bpm högre än din norm — kompensera för värmen."
- "Kadensen på 168 spm är lägre än ditt snitt (174). Kan vara trötthet eller kuperad bana."

---

### 7C. Coach på svenska *(liten — delvis klart)*

`buildSystemPrompt` accepterar `language: "en" | "sv"` men ingen UI-toggle finns. Lägg till:
- Dropdown i AI-inställningar: "Coach-språk: Svenska / English"
- Defaulta till svenska (du skriver svenska i Strava)

---

### 7D. Kontextuell träningsplanspreset *(medium)*

Fördefinierade AI-promptmallar kopplade till tävlingsdata:
- "Planera de närmaste 6 veckorna till [nästa A-race]"
- "Hitta mitt optimala taperschema baserat på mina bästa tävlingsresultat"
- "Analysera varför mitt [specifikt lopp] gick sämre än förväntat"

Dessa är inte bara kortkommandon — de inkluderar rätt kontext automatiskt.

---

### 7E. Konversationssammandrag *(liten)*

När en konversation > 20 meddelanden: AI genererar ett sammandrag ("detta har vi kommit fram till") som sedan ingår som komprimerat kontext i framtida sessioner.

Finns delvis specificerat i IMPLEMENTATION_PLAN men inte implementerat.

---

## 8. Dataintegration & Sync

### 8A. Strava Webhook (real-time sync) *(medium)*

Nuläge: Daglig cron-job kl. 06:00 → aktiviteter synkas med upp till 24 tim7Emars fördröjning.

**Nytt:** Strava webhook endpoint redan delvis förberett (`/api/strava/webhook/route.ts` finns).

Strava skickar push-notis vid ny aktivitet → omedelbar sync.

**Värde:** Aktiviteter visas sekunder efter att du avslutat dem på klockan.

---

### 8B. Fullständig Garmin-integration *(stor — delvis planerat)*

`GarminDailySummary` tabellen finns med HRV, sömn, BodyBattery etc. Status oklart.

**Om ej implementerat:** HRV-trend och sömnanalys är planerat med detaljerade charts (sömnstadier, RHR-trend) — dessa är powerful för återhämtningsövervakning.

---

### 8C. Backfill-optimering *(liten)*

Stora konton (2000+ aktiviteter) tar lång tid att backfilla streams. Lägg till:
- Prioritera de senaste 90 dagarnas aktiviteter (mest relevanta för nuvarande fitness)
- Progressindikator i inställningar med ETA

---

## 9. UX & Visualisering

### 9A. Personliga rekord-trendlinje på race-sidan *(liten)*

På race-sidan: utöver PB-historiken, lägg till en trendlinje (regression) som visar om du:
- Förbättrar dig (nedåtgående tid), stagnerar, eller försämras
- Med konfidensintervall för nästa tävling

---

### 9B. Intensitetsprofil-fingerprint per vecka (kalendervy) *(liten)*

I planner-kalendervy (WeekSummaryStrip): lägg till ett litet stapeldiagram (zonfördeln.) för veckan — en "färgprofil" som direkt visar om veckan var easy-heavy, threshold-heavy etc.

Delvis implementerat med `ZoneBar.tsx` — koppla till planner week.

---

### 9C. Exportera träningslogg *(liten)*

Exportera:
- CSV: alla aktiviteter med datum, distans, tid, pace, HR, sport
- Markdown-tabell: senaste 12 veckors volym
- JSON: komplett aktivitetshistorik

Endpoint: `GET /api/export/activities?format=csv&from=...&to=...`

---

### 9D. Progressive Web App (PWA) *(liten)*

Lägg till `manifest.json` + service worker (Next.js stöder det via `next-pwa`):
- "Lägg till på hemskärm" på mobil
- Offline-cache för statistik-sidan
- Push-notiser (frivilligt) för schema-påminnelse

---

### 9E. Kalenderexport (iCal) *(liten)*

Exportera planerade pass som `.ics`-fil:
- `GET /api/planner/export.ics`
- Importera till Google Calendar / Apple Calendar
- Automatisk uppdatering (subscription URL)

---

### 9F. Aktivitetslista-förbättringar *(liten)*

Nuläge: Lista med sportfilter och paginering.

**Lägg till:**
- Sortering: datum, distans, pace, stigning
- Fri-textsökning i namn + beskrivning
- Filter: datumintervall, HR-zon, tävlingsaktiviteter, laps-data tillgänglig
- Snabb-stats i listan: pace badge med färgkodning vs VDOT-zoner

---

### 9G. Mörka kartlager (Activity Map) *(liten — delvis fixat)*

Per commit-log (`96fcba9`): ljusläges-karttiles fixade nyligen. Kontrollera att:
- Seamlessly matchar dark/light theme
- Satellite-läge som alternativt kartlager (relevant för OL-terrängsanalys)

---

### 9H. Bättre pace-formattering *(liten)*

Nuläge: pace visas alltid som mm:ss/km.

**Alternativt:**
- km/h-läge (relevant för cykling)
- mph för engelskspråkiga
- Toggle i inställningar: "Paceenhet: min/km | min/mi | km/h"

---

## 10. Buggar och edge cases att kontrollera

### 10A. VDOT decaybridge med OL-aktiviteter

**Risk:** `fitness/vo2max.ts` inkluderar löpningsaktiviteter från alla sporttyper. OL-pass (`sportType = "Orienteering"`) har lägre pace pga terräng — kan de dra ner VDOT-estimatet?

**Check:** Kontrollera `isRunning()` filter — inkluderar det Orienteering? Om ja, och OL-pass skickas genom tempo-run-kandidater, underskattas VDOT.

---

### 10B. TSS för aktiviteter utan HR-data

`computeTSS()` faller tillbaka på `(duration / 3600) × 50` utan HR. För styrketräning (WeightTraining) utan HR-monitor är detta OK. Men för långa cykelturer utan hjärtratedata underskattas TSS.

**Fix:** Sport-specifik fallback: Cycling utan HR → `(duration / 3600) × 65`, Strength → `(duration / 3600) × 40`.

---

### 10C. Timezone-bugg i veckoberäkningar

`WeekSummaryStrip` och `WeeklyVolumeChart` beräknar veckor server-side. Om aktiviteter synkas i UTC och användaren befinner sig i +02:00 (sommartid) kan aktiviteter hamna på "fel" vecka.

**Check:** Kontrollera att `startDateLocal` (ej `startDate`) används för veckoaggregering.

---

### 10D. Block-arkivering triggers inte om blockdatum passeras under downtime

Automatisk arkivering (`when endDate passes, mark archived = true`) körs sannolikt i cron-job. Om servern är nere när blockdatumet passerar arkiveras aldrig blocket.

**Fix:** Kör arkiveringscheck vid server-start + i varje stats-page-request för befintliga aktiva block.

---

### 10E. bestEfforts-matching mot RaceRecord

`BestEffortsTable.tsx` visar Strava best efforts men jämför INTE mot `RaceRecord`-tabellen i DB. Resultatet är att en ny 5K-bästa-tid i ett Strava-bestEfforts-field inte flaggas som personbästa.

**Fix:** Se punkt 3C ovan — jämföring och badge.

---

## 10b. Webbresearch-fynd — ytterligare metriker & inslag

*(Validerade av oberoende forskningsagent, 2026-06-16)*

### Ground Contact Time (GCT) *(avancerat)*

- Elitlöpare: 175–200 ms. Under 300 ms är bra baseline.
- Direkt kopplat till kadens och vertikaloscillation.
- **Trolig källa:** Garmin-klockor mäter GCT om du bär bröstrem/pulsband med HRM-Run/Pro.
- **Implikation:** Kortare GCT = bättre löpekonomi, lägre skaderisk. Stiger med trötthet.
- Strava streamas INTE med GCT, men Garmin Connect-data om du importerar `.fit` direkt.

### Vertikal oscillation (VO) *(avancerat)*

- Minskar med ökad kadens.
- Minskning av VO → lägre metabolisk kostnad för att hålla kroppen mot gravitationen.
- Stigande VO under ett pass indikerar trötthet innan HR/pace-decoupling syns.
- Samma Garmin-datakälla som GCT.

### Kritisk zon-distinktion: Cadence variability som trötthetssignal *(bekräftad)*

Forskning (PMC 2025) bekräftar att kadensens standardavvikelse stiger vid trötthet INNAN HR-pace-förhållandet förändras. Kan vara ett tidigt varningstecken. Nuläge: kadensdata finns (`averageCadence` per aktivitet) men ingen variansanalys per pass är implementerad.

**Idé:** Beräkna CV% av per-km kadens inom ett pass. Visa per aktivitet. Flagga om CV > 5% på ett steady-state pass.

### Coefficient of Special Endurance (KsA) *(nischad)*

```
KsA = (T2 / T1) × (D1 / D2)^1.06   (Riegel-baserat)
```

Jämför relativ prestandaförlust mellan distanser (ex. 5K vs 10K). Lågt värde = bra specialuthållighet (endurance over speed). Högt värde = snabb specialist som tappar mer på längre distanser.

Redan implementerat via `riegelPredict()` och `personalizedFatigueExponent()` — bara att exponera som ett nyckeltal.

### ACWR 2024-caveat *(bugfixvarning)*

Forskning (PMC 2024) kritiserar ACWR som en universell skadeprediktionsmodell. Nyckelpoäng:
- ACWR > 1.5 = ökad risk, men korrelationen är svag populationsmässigt
- Individuell variation enorm — lär dig din egna "ramp-rate-tolerans" snarare än att lita på generiska trösklar
- **Implikation:** Nuvarande `injuryRisk`-beräkning bör ha en tydligare disclaimer i tooltip att siffrorna är generella, inte personaliserade.

### Åldersgradering — WMA 2023 *(bekräftad, lägg till)*

WMA uppdaterade sina faktorer januari 2023 baserat på 2.8M+ historiska prestationer. Signifikant förbättrad noggrannhet.

Formel:
```
AgeGrade% = (worldRecord × ageFactor) / yourTime × 100
```

**Källor:** World Masters Athletics online-tabeller per kön, ålder, distans.

Kategorier: < 60% = Lokal | 60–70% = Regional | 70–80% = Nationell | 80–90% = World Class | > 90% = WR-klass

### Tinman-kalkylator *(alternativ prediktion)*

Tinman (Tom Schwartz) är ett populärt alternativ till VDOT för tävlingstidsprediktioner. Tillgänglig via Final Surge API. Jämföresekretorens med VDOT (Daniels) för att ge "säkerhetsbredd" i prediktioner.

**Idé:** Visa VDOT-prediktion + Tinman-prediktion side-by-side → ger ett "konfidensintervall" via metodjämförelse.

### AI-coaching 2025 — vadsom faktiskt fungerar *(bekräftar riktning)*

Forskning bekräftar:
- Autoregulering (HRV-/sömnbaserad justering av belastning) = det som atleter FAKTISKT uppskattar
- Genomskinlig AI-reasoning = kritiskt ("sänker intensiteten onsdag för att din HRV sjunkit 7% och kadensen var variabel igår" > "vila igår")
- Fördefinierade kontextuella promptmallar > öppet chatfält (atleter vet inte vad de ska fråga)
- Computer vision form-feedback = nästa stora sak, men kräver träningsdata
- **Undvik:** "chatbot-känsla" utan träningsspecifik kunskapsbas — frustrerar atleter

---

## 11. Säkerhet & Tech Debt

### 11A. Rate limiting på AI-endpoint *(liten)*

`/api/coach/chat` har ingen rate-limiting. En bugg i frontend kan göra oändliga requests.

`lib/rate-limit.ts` verkar finnas — kontrollera att det appliceras på chat-endpoint.

---

### 11B. Strava token refresh race condition *(liten)*

Om två parallella API-anrop görs och token är expirated kan båda trigga refresh — potentiellt med dubbla refresh-anrop mot Strava.

**Fix:** Singleton refresh-lås (en pågående refresh-promise delas av alla väntande anrop).

---

### 11C. Aktivitetsstream-cachning i DB *(medium)*

Streams hämtas on-demand men sparas inte (kommenterat i planen). Om du öppnar en aktivitetssida 10 gånger = 10 Strava API-anrop.

**Fix:** Spara streams i DB (en `ActivityStream`-modell med JSON-blob). 2000 aktiviteter × ~50KB = 100MB — acceptabelt.

---

## 12. Prioriteringsmatris

| Förslag | Nytta | Komplexitet | Prioritet |
|---|---|---|---|
| 2A. Efficiency Factor trend | Hög | Låg | ⭐⭐⭐⭐⭐ |
| 3C. PB-highlight på aktivitetssidan | Hög | Låg | ⭐⭐⭐⭐⭐ |
| 1B. Pa:HR per aktivitet | Hög | Låg | ⭐⭐⭐⭐⭐ |
| 1A. Kadens + steglängdstrend | Medel | Låg | ⭐⭐⭐⭐ |
| 3E. GAP synlig på aktivitetssidan | Medel | Låg | ⭐⭐⭐⭐ |
| 2B. Pace Variability Index | Medel | Låg | ⭐⭐⭐⭐ |
| 1E. Årsgoal-tracker | Hög | Låg–Medel | ⭐⭐⭐⭐ |
| 7C. Coach på svenska (toggle) | Hög | Låg | ⭐⭐⭐⭐ |
| 2H. Åldersgradering | Medel | Låg | ⭐⭐⭐⭐ |
| 4A. "Idag"-panel på dashboard | Hög | Medel | ⭐⭐⭐⭐ |
| 8A. Strava Webhook | Hög | Medel | ⭐⭐⭐⭐ |
| 3B. Liknande pass | Medel | Låg | ⭐⭐⭐ |
| 2C. Training Monotony | Medel | Låg | ⭐⭐⭐ |
| 9E. iCal-export | Medel | Låg | ⭐⭐⭐ |
| 9C. CSV-export | Medel | Låg | ⭐⭐⭐ |
| 1D. Block-editor modal | Hög | Medel | ⭐⭐⭐⭐ |
| 1C. Aktivitet → Planerat matchning | Hög | Medel | ⭐⭐⭐ |
| 5A. DnD Planner | Hög | Hög | ⭐⭐⭐ |
| 4B. Readiness-score (Garmin) | Hög | Medel | ⭐⭐⭐⭐ |
| 5C. AI-genererad träningsplan | Mycket hög | Hög | ⭐⭐⭐ |
| 7A. Veckonotiser | Medel | Medel | ⭐⭐⭐ |
| 3A. Gradient-karta | Medel | Hög | ⭐⭐ |
| 9D. PWA | Låg | Medel | ⭐⭐ |
| 2I. HRR (kräver streams-cache) | Hög | Hög | ⭐⭐ |

---

## Snabbaste-vinster (kan göras på 1–2 timmar styck)

1. **GAP på aktivitetssidan** — beräknas redan i `vo2max.ts`, bara en stats-kort bort
2. **Kadenstrend** — data finns, Recharts linjediagram på Fitness-fliken
3. **PVI per löpning** — beräkna från `splitsMetric` under splits-tabellen
4. **Svensk coach-toggle** — `buildSystemPrompt` stöder redan `language: "sv"`
5. **PB-highlight** — jämför `bestEfforts` mot `RaceRecord` i aktivitetssidan

---

*Dokumentet baseras på direkt genomgång av samtlig källkod 2026-06-16 + webbresearch om moderna träningsmetriker. Inga ändringar gjorda i koden.*
