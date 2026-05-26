# Feature Sprint — Implementation Plan

> Skriven: 2026-05-26. Bygg i ordningen nedan; varje feature är oberoende men delar session-wrap-up.

---

## Scope

| # | Feature | Komplexitet | Schemaändring |
|---|---|---|---|
| 1 | Mobile responsiveness audit + fix | Låg | Nej |
| 2 | Intervallpass-analys (computed + AI-knapp) | Medel | Nej |
| 3 | Väderdata via Open-Meteo API | Medel-Hög | Ja (2 fält) |
| 4 | Strava webhook (deploy-redo) | Medel | Nej |
| 5 | Dashboard "on pace" + förra årets jämförelse | Låg | Nej |

---

## Feature 1 — Mobile Responsiveness Audit

### Audit-resultat (ingen stor implementering behövs)

Appen är ~95% responsiv. Responsive breakpoints används konsekvent (`sm:`, `md:`, `lg:`). Inga fixed-width containers som bryter layout.

**Kvarvarande problem att fixa:**

| Problem | Fil | Fix |
|---|---|---|
| Ingen explicit viewport meta tag | `app/layout.tsx` | Exportera `metadata.viewport` enligt Next.js 15-konvention |
| Stats-sidan: lång horisontell scroll på mobil | `app/(dashboard)/stats/stats-client.tsx` | Granska tabeller/charts som kan behöva `overflow-x-auto` wrapper |
| Planner: `h-[calc(100vh-64px)]` antar 64px header | `app/(dashboard)/planner/page.tsx` | Byt till CSS-variabel eller flexbox-fill |
| Chart-höjder hårdkodade (`height: 320`) | `activity-charts.tsx`, `TrainingLoadChart.tsx` | OK — `ResponsiveContainer` hanterar bredd; höjd kan vara fast |

**Viewport meta tag (Next.js 15-metod):**
```typescript
// app/layout.tsx — lägg till vid sidan av befintlig metadata
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};
// import { Viewport } from "next";
```

**Testchecklista:**
- [ ] DevTools → iPhone SE (375px): sidebar öppnas/stängs
- [ ] DevTools → iPhone SE: stats-sidan scrollar utan horisontell overflow
- [ ] DevTools → iPhone SE: aktivitetsdetalj-sidan läsbar
- [ ] DevTools → Pixel 7 (412px): planner-sidan visar kalender

---

## Feature 2 — Intervallpass-analysruta

### Bakgrund

Strava `workout_type` (heltal, sparas i `Activity.workoutType`):
- `0` = default/easy run
- `1` = race (→ `isRace = true`)
- `2` = long run
- `3` = workout (intervall, tempo, etc.) ← **detta är vår trigger**

Analysrutan visas **endast** för `workoutType === 3` på aktivitetsdetalj-sidan.

### Vad som byggs

**Del A — Computed quality analysis (alltid synlig för workout-pass)**
- Beräknas från `laps` JSON (föredras) eller `splitsMetric`
- Visar en rating 1–5 baserad på:
  - **Intensitetsindex**: snitt intervallpace / totalt snittspaco (förväntat > 1.1 för intervallpass)
  - **Konsistens**: standardavvikelse av lappernas pace (lägre = mer konsekvent = bättre)
  - **HR-respons**: max lap-HR / `maxHeartrate` × 100 (förväntat > 90% för hård intervall)
  - **Recovery-kvalitet**: om laps finns med HR — HR-dropp mellan laps (förväntat > 15 bpm)
- Rendererar 1–5 stjärnor + kort textsummering av vad siffrorna säger

**Del B — AI-analys (knapp-triggad, genereras ej automatiskt)**
- En "Analysera med AI"-knapp under Del A
- Klick → POST till nytt endpoint `/api/activities/[id]/analyze`
- Streamer svaret (text/event-stream) tillbaka
- Visas i en box direkt under knappen
- Analyserar: laps-data, HR-profil, snitt- vs intervallpace, väder, dagsform (TSB)
- Ber **separat** om en AI-analys av passets struktur och genomförande

### Nya filer

```
app/(dashboard)/activities/[id]/workout-analysis.tsx   — client component
app/api/activities/[id]/analyze/route.ts               — POST endpoint (streaming)
```

### Ändringar i befintliga filer

**`app/(dashboard)/activities/[id]/page.tsx`:**
- Lägg till `workoutType` i Prisma-selecten
- Importera och rendera `<WorkoutAnalysis>` efter BestEffortsTable, villkorat på `workoutType === 3`

**`workout-analysis.tsx` (ny, client component):**
```typescript
// Struktur
export function WorkoutAnalysis({ activity, splits }: { activity: ..., splits: Split[] | null }) {
  const [aiText, setAiText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const rating = computeWorkoutRating(splits, activity); // ren funktion

  async function requestAiAnalysis() {
    setLoading(true);
    const res = await fetch(`/api/activities/${activity.id}/analyze`, { method: "POST" });
    // stream text/event-stream → setAiText
  }

  return (
    <div className="rounded-2xl bg-surface border border-border p-5 space-y-4">
      <p className="text-sm font-semibold text-primary">Workout analysis</p>
      <RatingDisplay rating={rating} />   {/* stjärnor + bullets */}
      {!aiText && (
        <button onClick={requestAiAnalysis} disabled={loading}>
          {loading ? "Analyzing..." : "Analyze with AI"}
        </button>
      )}
      {aiText && <AiAnalysisBox text={aiText} />}
    </div>
  );
}
```

**`/api/activities/[id]/analyze/route.ts` (ny):**
- Hämtar activity + laps + TSB från cache
- Bygger ett kompakt prompt-block (liknande `buildCoachContext` men enbart för detta pass)
- Streamer svar via `TransformStream` → `ReadableStream` response
- Använder `streamText` / Claude API direkt (inte coach-chatten, separata analyser = ingen historik)
- Returnerar `text/event-stream`

### Rating-algoritm

```typescript
function computeWorkoutRating(splits: Split[], activity: { averageSpeed, maxHeartrate, averageHeartrate }): {
  score: number; // 1–5
  intensityIndex: number;
  consistencyScore: number;
  hrResponsePct: number;
  bullets: string[];
}
```

| Metric | Formel | Bra värde |
|---|---|---|
| Intensitetsindex | `snittLapPace / totalSnittPace` | > 1.12 |
| Konsistens | `1 - (stddev(lapPaces) / meanLapPace)` | > 0.92 |
| HR-respons | `maxLapHR / maxHR × 100` | > 90% |
| Recovery ratio | `(lapHRPeak - nextLapHRStart) / lapHRPeak` | > 0.20 |

### Testchecklista
- [ ] Activitetsdetalj-sidan för ett easy run visar **inte** analysrutan
- [ ] Activitetsdetalj-sidan för ett workout-pass (workoutType=3) visar analysrutan
- [ ] Rating 1–5 renderas korrekt
- [ ] "Analyze with AI"-knapp visas; klick triggar fetch
- [ ] AI-svar streamas och visas progressivt
- [ ] Om aktiviteten saknar laps: graceful fallback (analysera på splits eller skippa computed)
- [ ] AI-analys-knappen gömmer sig när svaret visas

---

## Feature 3 — Väderdata via Open-Meteo API

### Bakgrund

Strava's inbyggda väderdata är opålitlig och saknas på ~40% av aktiviteter. Open-Meteo Historical API:
- URL: `https://archive-api.open-meteo.com/v1/archive`
- Gratis, ingen API-nyckel
- Parametrar: `latitude`, `longitude`, `start_date`, `end_date`, `hourly=temperature_2m,wind_speed_10m,precipitation_sum,weathercode`
- Returnerar per timme → välj timmen närmast aktivitetens starttid

**Kräver lat/lon per aktivitet.** Strava-aktiviteter har `start_latlng: [lat, lng]` men fälten sparas inte idag.

### Schema-ändring (migration krävs)

```prisma
// prisma/schema.prisma — lägg till i Activity-modellen
startLat  Float?   // start_latlng[0] from Strava
startLng  Float?   // start_latlng[1] from Strava
```

Migration: `npx prisma migrate dev --name add_activity_latlng`

### Nya filer

```
lib/weather/open-meteo.ts                    — fetch-funktion
app/api/strava/backfill-weather/route.ts     — POST: backfill-väder för befintliga aktiviteter
```

### Ändringar i befintliga filer

**`lib/strava/sync.ts`:**
- Lägg till `startLat: raw.start_latlng?.[0] ?? null` och `startLng: raw.start_latlng?.[1] ?? null` i upsert-datan
- Efter upsert av en ny aktivitet, om `startLat != null` och `weatherTemp == null`: anropa `fetchAndSaveWeather(activityId, lat, lng, startDate)`

**`lib/weather/open-meteo.ts` (ny):**
```typescript
export interface WeatherSnapshot {
  tempC: number;
  windKph: number;
  precipMm: number;
  weatherCode: number;
  condition: string;  // "clear" | "cloudy" | "rain" | "snow" | "fog"
}

export async function fetchHistoricalWeather(
  lat: number, lng: number, dateUtc: Date
): Promise<WeatherSnapshot | null>
```
- Anropar Open-Meteo archive API
- Väljer timme närmast aktivitetens start
- Avkodar WMO weather code → läsbar sträng
- Returnerar null vid nätverksfel (tyst)

**`app/api/strava/backfill-weather/route.ts` (ny):**
- POST endpoint, kräver auth
- Hämtar alla aktiviteter där `weatherTemp IS NULL` och `startLat IS NOT NULL`
- Batchbearbetar med 500ms delay mellan requests (rate limiting mot Open-Meteo)
- Returnerar `{ processed: n, updated: m }`

### Väder-stats-vy (ny komponent i stats-sidan)

Ny sektion i stats-sidan: "Weather profile"

**Temperaturkorrelation (redan delvis implementerad):**
- `tempSensitivity` beräknas redan i stats page (pace-ändring per °C)
- Utöka med bar chart per temperaturband: `< 5°C`, `5–10°C`, `10–15°C`, `15–20°C`, `> 20°C`
- Visa: antal pass, snitt-pace, snitt-HR per band

**Väder-typ-breakdown:**
- Pie/bar: fördelning av pass per condition (clear/cloudy/rain/snow)
- Scatter: pace vs temperatur (existerande runs)

**Ny fil:** `components/stats/weather-profile.tsx` (client component, Recharts)

### Testchecklista
- [ ] Migration kör utan fel: `prisma migrate dev`
- [ ] Ny sync av aktivitet sparar `startLat`/`startLng`
- [ ] `fetchHistoricalWeather` returnerar rimliga värden för en känd aktivitet
- [ ] Backfill-endpoint bearbetar 10 aktiviteter utan error
- [ ] `weatherTemp` uppdateras i DB för aktiviteter som saknade data
- [ ] Aktivitetsdetalj-sidan visar väderdata (existerande visning)
- [ ] Stats-sidan visar temperature-band-chart

---

## Feature 4 — Strava Webhook

### Bakgrund

Strava push events skickas när en aktivitet skapas/uppdateras/tas bort av atleten. Kräver:
1. En publik HTTPS-endpoint (localhost fungerar ej — deploy till riktig domän krävs)
2. En verify token (valfri sträng, matchar vid registrering)
3. Webhook-registrering via Strava-API (görs en gång)

**Kodbas implementeras nu. Aktiveras vid deploy.**

### Webhook event-typer

| Aspect type | Object type | Action | Handling |
|---|---|---|---|
| `activity` | `activity` | `create` | Sync ny aktivitet (enskild fetch) |
| `activity` | `activity` | `update` | Re-fetch + uppdatera i DB |
| `activity` | `activity` | `delete` | Radera från DB |
| `athlete` | `athlete` | `update` | Ignorera (profil hanteras manuellt) |

### Ny fil

**`app/api/strava/webhook/route.ts`:**

```typescript
// GET — Strava verification challenge
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("hub.verify_token") !== process.env.STRAVA_WEBHOOK_VERIFY_TOKEN)
    return new Response("Forbidden", { status: 403 });
  return Response.json({ "hub.challenge": searchParams.get("hub.challenge") });
}

// POST — incoming event
export async function POST(req: NextRequest) {
  const body = await req.json();
  // aspect_type: "activity", object_type: "activity"
  // object_id: stravaActivityId (number)
  // owner_id: stravaAthleteId (number)
  // updates: { title?, type?, private? }
  // event_time: unix timestamp

  // 1. Identify user by owner_id (lookup StravaAccount.stravaAthleteId)
  // 2. Dispatch to syncSingleActivity() / updateActivity() / deleteActivity()
  // 3. Return 200 immediately

  handleWebhookEvent(body).catch(console.error); // non-blocking
  return new Response(null, { status: 200 });
}
```

### Hjälpfunktioner (i `lib/strava/sync.ts`)

```typescript
// Ny: sync en enskild aktivitet (används av webhook create/update)
export async function syncSingleActivity(userId: string, stravaActivityId: number): Promise<void>

// Ny: radera aktivitet
export async function deleteActivity(userId: string, stravaActivityId: number): Promise<void>
```

### `.env.example`-uppdatering

```
STRAVA_WEBHOOK_VERIFY_TOKEN="your_random_secret"
```

### Registrering av webhook (görs vid deploy)

```bash
# Kör en gång efter deploy till publik domän
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -d "client_id=CLIENT_ID" \
  -d "client_secret=CLIENT_SECRET" \
  -d "callback_url=https://yourdomain.com/api/strava/webhook" \
  -d "verify_token=YOUR_VERIFY_TOKEN"
```

Strava stöder **en aktiv webhook** per app. Response innehåller `id` som sparas för eventuell avregistrering.

### Testchecklista
- [ ] GET `/api/strava/webhook?hub.verify_token=X&hub.challenge=Y` returnerar `{ "hub.challenge": "Y" }`
- [ ] GET med fel verify_token returnerar 403
- [ ] POST med `{ aspect_type: "activity", object_type: "activity", event_type: "create" }` triggar sync
- [ ] POST returnerar 200 omedelbart (innan sync är klar)
- [ ] DELETE-event raderar aktiviteten ur DB
- [ ] UPDATE-event uppdaterar namn/beskrivning

---

## Feature 5 — Dashboard "On Pace" + Förra Årets Jämförelse

### Vad som byggs

I YTD-kortet (löpning) läggs till:
- **"On pace for"**: projicerad helårssumma baserat på nuvarande tempo
- **"vs förra året"**: km löpta till samma datum förra året

### Ändringar i `app/(dashboard)/dashboard/page.tsx`

Ny query och beräkning:

```typescript
// Nuvarande dagsnummer i år
const dayOfYear = Math.ceil((now.getTime() - yearStart.getTime()) / 86400000) + 1;

// Förra årets samma dag som cut-off
const lyYearStart = new Date(yearStart.getFullYear() - 1, 0, 1);
const lyToday = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

// Promise.all: lägg till denna query
aggSince(userId, lyYearStart, "run")  // → runLyYtd (obs: aggSince behöver ta end-date)
```

`aggSince` behöver en optional `until?: Date` parameter:
```typescript
async function aggSince(userId: string, since: Date, sportFilter?: string, until?: Date) {
  const where = {
    userId,
    startDateLocal: { gte: new Date(localDateStr(since)), ...(until ? { lte: new Date(localDateStr(until)) } : {}) },
    ...
  };
```

**Beräkning:**
```typescript
const onPaceForKm = dayOfYear > 0 ? Math.round((runYtd.km / 1000 / dayOfYear) * 365) : 0;
const lyRunYtdKm = Math.round(runLyYtd.km / 1000);
```

### Ändringar i `app/(dashboard)/dashboard/dashboard-cards.tsx`

Props-utökning:
```typescript
run: { week, month, ytd, onPaceKm: number, lyYtdKm: number }
```

YTD-kortet:
```tsx
<StatCard
  label="Year to date"
  primary={...}
  sub={...}
  detail={mode === "run" && d.ytd.km > 0
    ? `On pace for ${d.run.onPaceKm.toLocaleString()} km`
    : undefined}
  subDetail={mode === "run" && d.run.lyYtdKm > 0
    ? `vs ${d.run.lyYtdKm} km this point last year`
    : undefined}
  accent
/>
```

`StatCard` behöver en `subDetail?: string` prop för den extra raden.

### Testchecklista
- [ ] YTD-kortet i "Running"-läge visar "On pace for X km"
- [ ] "vs Y km this point last year" visas under
- [ ] Dag 1 januari (dayOfYear=1): on-pace-värdet är ~365× nuvarandedag (ingen division-by-zero)
- [ ] Ingen ändring i "All sports"-läge (on-pace visas ej)
- [ ] Förra årets query returnerar 0 för ny användare (ingen krasch)

---

## Session-wrap-up (gemensam för alla features)

### Build & deploy

```bash
# 1. Schemamigrering (Feature 3)
npx prisma migrate dev --name add_activity_latlng

# 2. Generera Prisma-client
npx prisma generate

# 3. Build-verifiering
pnpm build --no-lint

# 4. Commit per feature (separata commits)
git add <files> && git commit -m "feat: ..."

# 5. Push
git push

# 6. Dev server restart
Get-Process -Name "node" | Stop-Process -Force
pnpm dev  # (run_in_background: true via Bash tool)
```

### Dokumentation att uppdatera

| Fil | Vad uppdateras |
|---|---|
| `docs/planning/IMPLEMENTATION_PLAN.md` | Markera features som byggda, lägg till session-notering |
| `docs/api/strava.md` | Lägg till webhook-endpoint spec (GET verify + POST events) |
| `docs/api/activities.md` | Nytt endpoint `/api/activities/[id]/analyze` |
| `.env.example` | `STRAVA_WEBHOOK_VERIFY_TOKEN` |

### Full audit-checklista (kör efter implementering)

**Generellt:**
- [ ] `pnpm build --no-lint` klarar utan TypeScript-fel
- [ ] Prisma-migration kör på ren DB
- [ ] Inga console.error i browser-konsolen

**Feature 1 (Mobile):**
- [ ] Viewport meta tag finns i page source
- [ ] iPhone SE layout (375px) i Chrome DevTools — ingen horisontell scroll

**Feature 2 (Intervallanalys):**
- [ ] Aktivitets-detalj: easy run visar INTE analysrutan
- [ ] Aktivitets-detalj: workout-pass visar analysrutan med rating
- [ ] AI-knapp triggar streaming-analys
- [ ] Fel-state om AI-anrop misslyckas

**Feature 3 (Väder):**
- [ ] Ny sync sparar lat/lng
- [ ] Open-Meteo API svarar för en testkoordinat + datum
- [ ] Backfill-endpoint uppdaterar `weatherTemp` för aktiviteter som saknar data
- [ ] Weather profile-komponent renderas i stats-sidan

**Feature 4 (Webhook):**
- [ ] GET-endpoint svarar korrekt på Strava challenge
- [ ] POST-endpoint returnerar 200 och triggar sync

**Feature 5 (On Pace):**
- [ ] Dashboard visar "On pace for X km" i running-läge
- [ ] Förra årets km visas korrekt

---

## Prioriteringsordning

Rekommendation om man vill dela upp i sessioner:

1. **Session A** (låg risk): Feature 5 → Feature 1 → Feature 4
2. **Session B** (medel): Feature 2
3. **Session C** (högrisk: schema + extern API): Feature 3
