# TrainingLab — Visualiseringar, Jämförelser & Dataanalys

> **Status:** 2026-05-21 — Bred research + implementationsplan  
> **Syfte:** Vad kan vi utvinna ur 2800+ aktiviteter? Var placeras det?

---

## 1. Långsiktiga prestandatrender (Statistics → Overview / nytt "Trends"-flik)

### 1A. Aerob effektivitetstrend (AEI) — redan delvis implementerat
Implementerat som veckobar. Saknar: 12-månaders glidande medelvärde, annoterat
med viktiga träningsepoker (Base/Build/Peak). Visar om aerob motor förbättras år för år.

### 1B. Paceutveckling per distans över tid
- För varje standard-distans (5K, 10K, HM): best effort per kalenderhalvår
- Linjediagram med trendlinje
- Visar verklig prestationsutveckling, frikopplad från enstaka tävlingar
- **Datakälla:** RaceRecord + activities.bestEfforts

### 1C. HR-drift (cardiac drift) trend
- Senaste 12 månaderna: %-drift av HR under långa pass (>60 min)
- Approximation: avgHR sista 30% av passet ÷ avgHR första 30%
- Kräver splitsMetric — kan beräknas för aktiviteter som synkats individuellt
- **Datakälla:** splitsMetric (partiellt tillgänglig)

### 1D. VO2max/VDOT-kurva per månad
- Estimerat VDOT per månad (rullande 3-månaders fönster)
- Visar karriärens toppvärde och återhämtning efter skador/pauser
- **Datakälla:** Alla races + quality sessions i activities

---

## 2. Säsongsmönster (Statistics → nytt "Seasons"-flik eller Overview)

### 2A. Månadsvis volym — 3-årsöverlay
- Stapeldiagram med jan–dec på X, varje år som en serie
- Visa var träningsvolymen typiskt toppar/dalar (vinterdip, vårbygge etc.)
- **Datakälla:** activities.distance grupperat per månad/år

### 2B. Intensitetsprofil per månad
- Stackat stapeldiagram: % lättpass / % tempopass / % hårda pass per månad
- Visar om träningen periodiseras korrekt (bas → build → peak-mönster)
- **Datakälla:** activities.averageHeartrate + hrZones

### 2C. Bästa träningsblock (top-5 historiskt)
- Identifiera 4-veckorsblock med högst CTL-ökning + prestation
- Visa vad som utmärkte dem (volym, intensitetsfördelning, vila)
- **Datakälla:** DailyLoad-kurvan + activities

### 2D. Aktiv streak — längsta sammanhängande perioder
- Histogram av streak-längder per år
- Längsta streak highlight
- **Datakälla:** activities.startDate

---

## 3. Jämförande analys (Statistics → Overview / Races-sidan)

### 3A. År-för-år volymkarta (heatmap)
- GitHub-stil: varje ruta = en vecka, färg = distans/tid
- 3-4 år side-by-side
- **Datakälla:** activities.distance + startDate
- **Placering:** Statistics → Overview, nytt "History"-avsnitt

### 3B. Prestation per kurs/segment
- Om samma aktivitetsnamn förekommer flera gånger ("Tisdagsbana"):
  plotta tid/km per datum → visar förbättring på specifika banor
- **Datakälla:** activities.name (grupp på keyword) + avgPace

### 3C. Löparkalendern — race progression
- Tidslinje av alla tävlingar med PB-markörerer
- Visa karriärnivå: VDOT-equivalentlinje över tid
- **Placering:** Races & PBs-sidan

### 3D. Bästa vs sämsta träningsperioder (scatter)
- X = CTL, Y = VDOT-estimat per månad
- Visar relationen fitness → prestation
- **Datakälla:** FitnessCache.ctl + racePBs per period

---

## 4. Tävlingsanalys (Activities-sidan / Races-sidan)

### 4A. Pacing-strategi (negativa vs positiva splits)
- För aktiviteter med splitsMetric: beräkna km 1-3 vs sista km
- Scatter: pacing-ratio vs slutresultat
- Visar om du tjänar på negativ splitting
- **Datakälla:** splitsMetric

### 4B. HR-distribution under tävlingar
- Vilken % av tävlingstid spenderas >LT2 (Z4-Z5)?
- Jämför med träning
- **Datakälla:** activities.isRace + averageHeartrate + hrZones

### 4C. Väderkorrelation med prestation
- Scatterplot: temperatur → pace-avvikelse från förväntat
- Beräkna personlig "heat penalty" (sec/km per 5°C)
- **Datakälla:** activities.weatherTemp + avgPace + VDOT-förväntad pace

---

## 5. Skaderisk-indikatorer (Dashboard)

### 5A. Belastningsspets-detektor
- Flagga veckor med >15% ökning i TSS vs 4-veckors medel
- Visa historiska spikemönster kopplat till aktivitetsgap (lediga dagar = potentiell skada)
- **Datakälla:** dailyTSS + activity gaps

### 5B. Löpekonomi-trend
- Pace vid fast HR-nivå (75% maxHR) per 6-veckorsblock
- Försämring kan signalera trötthet/överbelastning
- **Datakälla:** activities.avgPace + avgHR (redan implementerat som RE-proxy)

### 5C. Successivt HR-stegring på lätta pass
- Om avgHR stiger med >5 bpm på identiska lätta pass under 2 veckor → varningsflagga
- **Datakälla:** activities där avgHR < LT1 och namn liknar (keyword matching)

---

## 6. Avancerade löpmetriker (Statistics → Fitness)

### 6A. Critical Speed-kurva från stora dataset
- Med 2800 aktiviteter: beräkna CS för varje 6-månadersfönster
- Plotta CS-trenden över karriären
- Visar verklig uthållighetskapacitet utan att behöva tävla
- **Datakälla:** racePBs + quality sessions per period

### 6B. HR-recovery rate
- Från aktiviteter med HR-data: hur snabbt sjunker HR minuterna efter avslutat
- Bättre återhämtning = bättre kondition
- **Kräver:** stravaStreams (per-sekund data) — tillgänglig on-demand

### 6C. Exponentiell HR-pace modell
- Kurva-fitting: HR = a × pace^b per atletuppgifter
- Extrapolera till teoretisk maxpuls
- Mer datarik version av Firstbeat-modellen
- **Datakälla:** 2800 aktiviteter ger exceptionellt bra kurv-anpassning

### 6D. Effektivitetsindex per väderförhållanden
- Separat AEI för: kallt (<5°C), tempererat (5-20°C), varmt (>20°C)
- Personlig klimatprofil
- **Datakälla:** activities.weatherTemp + avgSpeed + avgHR

---

## 7. Orienteringsspecifikt (Activities-sidan)

### 7A. Terrängfaktor-analys
- OL-pass vs väglöpning: pace-skillnad vid samma HR
- Visa "terrain efficiency" — hur pass på OL-terräng påverkar löpekonomin
- **Datakälla:** activities.name (OL-keywords) + avgPace + avgHR

### 7B. Teknisk träning vs fysisk träning
- Andel OL-aktiviteter per år vs löpning
- Korrelation mellan OL-volym och orientering-specifik form
- **Datakälla:** activities.sportType (orienteering)

---

## 8. Runalyze/intervals.icu-funktioner att implementera

| Funktion | Platform | Prioritet | Tillgänglig data |
|---|---|---|---|
| Prestandautveckling per distans | Runalyze | ⭐⭐⭐ | bestEfforts |
| Månadsvis volymheatmap | intervals.icu | ⭐⭐⭐ | activities |
| CTL vs performance scatter | TrainingPeaks | ⭐⭐ | FitnessCache |
| HR recovery rate | Runalyze | ⭐ | Streams (on-demand) |
| Power estimation (W/kg) | Runalyze | ⭐⭐ | pace+elevation |
| Terrängfaktor | Unik för OL | ⭐⭐ | sportType+pace+HR |
| Streak calendar | Strava + | ⭐⭐ | activities.startDate |

---

## 9. AI-assistent — systematisk historikanalys

### Problem
AI-coachen ser bara senaste 90 dagars aktiviteter och har begränsad verktygstillgång.
När användaren ber om djupanalys behövs tillgång till hela 5-årshistoriken.

### Lösning: `deep_analysis`-verktyg

Nytt tool för AI-coachen som aktiveras vid explicit begäran ("analysera min träningshistorik"):

```typescript
{
  name: "get_full_training_history",
  description: "Fetch comprehensive training history for deep analysis. Use ONLY when user explicitly asks for analysis of their full history, career trends, or multi-year patterns. This fetches large amounts of data.",
  parameters: {
    years: { type: "number", description: "How many years back to fetch (max 5, default 2)" },
    sport: { type: "string", description: "Filter by sport (optional)" },
    include_metrics: { 
      type: "array",
      items: { enum: ["volume", "intensity", "hr_trends", "race_performance", "load_curve"] }
    }
  }
}
```

**Returnerar aggregerad data:**
- Månadsvis volym per sport (sista N år)
- VDOT-trend per kvartal
- Topplöpveckor och bästa träningsblock
- Skade-gap historik (perioder utan aktivitet)
- Progression per distance PR

**Säkerhetsgräns:** Max 5 år, max 2 anrop per konversation (kostnadshantering).

---

## 10. Prioriterad implementationsordning

| # | Feature | Effort | Impact | Tab |
|---|---|---|---|---|
| 1 | Månadsvis volymheatmap (YoY) | Low | ⭐⭐⭐ | Statistics → Overview |
| 2 | Prestandautveckling per distans | Low | ⭐⭐⭐ | Races & PBs |
| 3 | AI deep_analysis verktyg | Medium | ⭐⭐⭐ | Coach |
| 4 | Bästa träningsblock | Medium | ⭐⭐ | Statistics → Load |
| 5 | Pacing-strategi scatter | Medium | ⭐⭐ | Activities / Races |
| 6 | Terrängfaktor OL-analys | Medium | ⭐⭐ | Statistics → Fitness |
| 7 | HR recovery rate | High (streams) | ⭐ | Activity detail |

---

## 11. Research-synthes (webbresearch 2026-05-21)

**Heart Rate Efficiency (HRE)** — distance (km) ÷ avgHR, rullande trend = bästa enskilda indikator
på aerob utveckling. Visar förbättring som pace-data missar (effektivare hjärta = mer per slag).

**Cardiac Drift** — %HR-ökning under lång löpning vid konstant fart. >5% = undertankning eller trötthet.
Kräver splitsMetric men kan approximeras från hel-aktivitet.

**Critical Pace-kurva** — från bästa 3-min + 9-min snitt i stora dataset → konfidensband. Med
2800 aktiviteter: robusta trendinjer per kalenderhalvår. Formula: `(P₃min + P₉min) / 2 × 0.9`

**Periodiseringsdetektion** — elite orienterare kör ~14.9h/v i GPP, ~11.5h/v i SPP, ~10.6h/v
under tävlingssäsong. Klustrera volume+intensitet per månad → detektera faser automatiskt.

**Skaderisk utöver ACWR** — månadsvis volymökning >15% (absolut, inte ratio) + HRV-dip >5%
från baseline = starkare prediktor än ACWR. Kombination av dessa varnar 7-14 dagar i förväg.

**Terrängeffektivitet OL** — separera OL vs väglöpning, beräkna speed-per-slope-ratio.
Identifiera vilka terrängtyper som kostar mest energi (kräver GPS + elevation per sektion).

**Källor:** ArXiv HR efficiency 2024, TrainingPeaks EF, IJSPP Orienteering periodization,
PMC Marathon cardiac drift, NCBI Critical Power, Intervals.icu review.

---

---

## 12. Beskrivningsresynk — alla gamla aktiviteter saknar text

### Problem
Aktiviteter synkade via `/athlete/activities` (paginerad bulk-sync) returnerar INTE
`description`-fältet. Bara `/activities/{id}` (individuell fetch) returnerar det.
2800+ aktiviteter saknar därmed dina egna anteckningar — kritisk AI-kontext.

### Lösning A: Bakgrundsjobb (rekommenderad)
Nytt script/route: `POST /api/strava/backfill-descriptions`
1. Hämtar alla aktiviteter i DB där `description IS NULL` (pagineringsbatch, t.ex. 500 åt gången)
2. För varje: hämtar `/activities/{id}` från Strava
3. Uppdaterar `description` (och `splitsMetric`, `bestEfforts`, `laps` som bonus)
4. Körs i bakgrunden, respekterar 1000/dag-ratelimit (~30 batch/dag = ~500 per dag)
5. Progress visas i Settings → Strava som "X/Y beskrivningar synkade"

**Tidsuppskattning:** 2800 aktiviteter ÷ 500/dag = ~6 dagar. Kan köras nattetid.

### Lösning B: On-demand i aktivitetsdetaljvy
Redan delvis implementerat — individuell fetch sker när aktivitetsdetaljsidan öppnas.
Utöka: om description saknas, auto-trigga individuell fetch och uppdatera.

### Lösning C: Smart resync-knapp (implementerat)
"Sync Strava"-knappen fetchar nu de senaste 3 dagarna individuellt. 
För historik: lägg till "Backfill descriptions"-knapp i Settings → Strava.

### Implementation
```typescript
// Nytt API-endpoint
POST /api/strava/backfill-descriptions?batch=500&offset=0

// Logic:
const missing = await prisma.activity.findMany({
  where: { userId, description: null, stravaId: { not: null } },
  take: 500,
  orderBy: { startDate: 'desc' }
});
for (const act of missing) {
  const full = await stravaFetch(userId, `/activities/${act.stravaId}`);
  await prisma.activity.update({
    where: { id: act.id },
    data: { description: full.description ?? null, splitsMetric: full.splits_metric ?? undefined }
  });
  await sleep(200); // rate limit
}
```

**Prioritet:** HÖG — saknade beskrivningar gör AI-coachen blind för träningsanteckningar.

---

## 12b. AI-verktyg: Hämta alla aktiviteter under intervall

### Syfte
Ibland räcker inte aggregerad data. Vid djup analys av en specifik period (t.ex.
"analysera varje pass jag körde förra sommaren") behöver AI:n rådata — alla aktiviteter
med namn, tempo, puls, distans, beskrivning — inte bara summor.

### Implementering: `get_activities_in_range`

```typescript
{
  name: "get_activities_in_range",
  description: `Fetch ALL individual activities in a date range for deep analysis.
WARNING: This returns large amounts of data and costs significantly more tokens.
IMPORTANT: Before calling this tool, you MUST explicitly warn the user:
  "Att hämta alla aktiviteter under [period] kräver många tokens och kostar uppskattningsvis
   $X. Vill du fortsätta?"
Only proceed after explicit confirmation. Do NOT use for short questions — use
search_activities or analyze_full_history for routine queries.`,
  input_schema: {
    type: "object",
    properties: {
      date_from:    { type: "string",  description: "Start date YYYY-MM-DD (required)" },
      date_to:      { type: "string",  description: "End date YYYY-MM-DD (required)" },
      sport:        { type: "string",  description: "Filter by sport (optional)" },
      confirmed:    { type: "boolean", description: "Set to true ONLY after user has confirmed the cost warning" },
    },
    required: ["date_from", "date_to", "confirmed"],
  }
}
```

### Kostnadsskydd
- Om `confirmed !== true`: returnera en kostnadsuppskattning UTAN att hämta data
  - Räkna antal aktiviteter i perioden: `SELECT COUNT(*) FROM Activity WHERE date BETWEEN ...`
  - Estimera tokens: ~150 tokens per aktivitet (namn, tempo, puls, beskrivning)
  - Visa: "Denna period innehåller X aktiviteter ≈ Y tokens ≈ $Z. Bekräfta?"
- Om `confirmed === true`: hämta och returnera full data

### Maxgränser
- Max 500 aktiviteter per anrop (>500 → begär snävare intervall)
- Max 2 anrop per konversation (förhindrar oavsiktliga stora kostnader)

### Dataformat — fullständigt men strukturerat
Returnerar alla fält som är relevanta för coaching-analys:

```
[2025-06-15 Mon] Lätt löpning — Run
  Distans: 10.2 km · Tid: 52:30 · Tempo: 5:09/km
  HR: avg 138 bpm / max 151 bpm
  Höjd: 85 m · Väder: 18°C
  Beskrivning: "Bra känsla i benen, lite trött men positiv. Sov dåligt natten innan."

[2025-06-17 Wed] Tisdagsbana 5×4min — Run
  Distans: 8.1 km · Tid: 42:00 · Tempo: 5:11/km (snittad inkl uppv)
  HR: avg 162 bpm / max 171 bpm
  Höjd: 42 m · Väder: 21°C
  Beskrivning: "Intervallerna gick bra, höll 3:30 på de fyra sista. Lite kramp i vaden."

...
```

**Inkluderade fält per aktivitet:**
- Datum + veckodag + namn + sporttyp
- Distans, tid, snittempo
- Genomsnittlig och maximal puls
- Höjdmeter, vädertemperatur
- Fullständig beskrivning (obegränsad längd — detta är nyckelvärdet)
- isRace-flagga om tävling

**Exkluderade fält** (sparar tokens utan coaching-värde):
- GPS-polyline, splits-JSON, Strava-ID, tekniska metadata

### Exempel på korrekt AI-beteende
**Användare:** "Analysera alla mina pass från maj 2025"  
**AI (utan `confirmed`):** "Maj 2025 innehåller 28 aktiviteter ≈ 4 200 tokens ≈ $0.013 (Claude) / gratis (Gemini). Vill du fortsätta med full analys?"  
**Användare:** "Ja"  
**AI:** anropar verktyget med `confirmed: true`

---

## 13. Kända buggnoteringar

### Webpack "Cannot find module vendor-chunks/date-fns@4.1.0.js"
**Symptom:** Runtime-fel vid sidladdning  
**Orsak:** Stale webpack-cache i `.next/` — gamla chunk-refs pekar på ej existerande filer  
**Fix:** Ta bort `.next/` och starta om servern: `rm -rf .next && pnpm dev`  
**Permanent fix:** Lägg till hook i CLAUDE.md: alltid `rm -rf .next` vid omstart  
**Status:** Ej implementerad automatisering

---

## 14. Implementeringsstatus

### ✅ Klart
- Polarisation 5-zonbar (Z1-Z5 med matchande färger)
- Seiler 3-zon omdöpt till Low/Moderate/High
- Fast-path analytics (AEI, RE, streak, ramp rate, injury risk)
- Strava: daglig auto-sync (var 06:00), smart 3-dagars manuell resync
- MaxHR: statistisk bucket-metod från alla hårda pass (>78% av observedMax)
- MAXHR_ARTIFACT_CAP=205 (eliminerar sensorpikar >205 bpm)
- Kalibrerings-knapp skriver INTE till AthleteProfile → estimering alltid fresh
- AI: `analyze_full_history`-verktyg för djup historikanalys

### ❌ Ej implementerat (se avsnitt ovan)
- Beskrivningsresynk för gamla aktiviteter (§12)
- Backfill-endpoint + UI i Settings
- YoY volymheatmap (§3A)
- Prestandautveckling per distans (§1B)
- AI deep history → full integration med system prompt
- Terrängfaktor OL-analys (§7A)

---

*Last updated: 2026-05-21*
