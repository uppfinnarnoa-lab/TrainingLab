# Implementationsplan — Fixes & förbättringar

Se även: [Security Audit](../security/SECURITY_AUDIT_2026_05_26.md)

---

## Övergripande mål

- Konsistens i färgsystem och typer (planner / templates / history)
- Korrekt hantering av HR-inställningar (manuell override)
- Förbättrad kalender- och template-hantering
- Utökad flexibilitet i PB-tracking
- Drag & drop i kalender (inkl. idag)
- UI-korrigeringar i planner
- Deployment-säkerhet
- Temasystem: flera färgscheman med light/dark-variant per tema

---

## Genomförda fixes (2026-05-26)

| # | Vad | Filer |
|---|---|---|
| ✅ | Competition/tävling → gul för ALLA sporter | `lib/planner/colors.ts` |
| ✅ | Strength-färg `#F97316` → `#D97706` (särskiljs från Cycling) | `lib/planner/colors.ts` |
| ✅ | Svart bar längst ned i planner → `md:h-screen` | `app/(dashboard)/planner/page.tsx` |
| ✅ | Block-bakgrundsfärg synligare (opacity `0D` → `22`) | `components/planner/PlannerCalendar.tsx` |
| ✅ | Drag-and-drop tillåter idag (ej bara framtid) | `PlannerCalendar.tsx`, `WorkoutPill.tsx` |
| ✅ | Manuell maxHR/restHR triggar omedelbar recalibrering | `app/api/settings/profile/route.ts` |
| ✅ | Light/dark/system-toggle tillagd i Settings → Appearance | `app/(dashboard)/settings/appearance-settings.tsx` |

---

## LT2 via befintliga estimat

**HR-pace regression** estimerar LT2 redan — `estimateZonesFromStatisticalAnalysis` i `lib/fitness/zones.ts` returnerar `lt2HR` som används för z4-gränsen. Inget behöver byggas.

**Aerob decoupling** kan inte estimera LT2 — det är ett LT1-fenomen per definition.

**Framtida möjlighet:** Critical Speed (CS) från best efforts = tangentpunkten i speed-duration-kurvan, bra proxy för LT2/FTP. Planerat under P8 nedan.

---

## Prioriterad backlog

---

### P1 — Säkerhet (deploy-kritisk)

Se [docs/security/SECURITY_AUDIT_2026_05_26.md](../security/SECURITY_AUDIT_2026_05_26.md) för fullständig lista.

**Att fixa innan produktionsdeploy:**

- [ ] **H1** Login brute-force — IP-räknare i `auth.ts` `authorize()`, PostgreSQL-backed (5 försök / 15 min)
- [ ] **H4** Security headers — `headers()` + `poweredByHeader: false` i `next.config.ts`
  ```ts
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      { key: "X-Content-Type-Options",    value: "nosniff" },
      { key: "X-Frame-Options",           value: "SAMEORIGIN" },
      { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
    ]}];
  }
  ```
- [ ] **H5+H6** OAuth redirect_uri hardkodas från `NEXTAUTH_URL`; state-cookie för CSRF
- [ ] **M7** `Cache-Control: public` → `private` på `/api/activities/[id]/streams`
- [ ] **H2** Strava/Garmin OAuth-tokens krypteras i DB — wrap med `encryptIfNeeded/safeDecrypt`
- [ ] **M2+M3** FK ownership-check för WorkoutType och WorkoutTemplate
- [ ] **L2** Deployment hardening: `ufw`, `fail2ban`, `chmod 600 .env.local`, dedikerat service-konto

---

### P2 — Färgsystem: central config & unikhet

**Nuläge:** `lib/planner/colors.ts` är single source of truth. Competition-check lagd globalt. Strength-färg fixad.

**Kvarstående:**
- [ ] Verifiera att `TemplateCard` och templates-vyn importerar `workoutColor` (inte lokala definitioner)
- [ ] History: `workoutColor(sportType, null)` ger alltid default-blå för löpning (ingen typinfo från Strava). Acceptabelt — `isRace`-flaggan hanterar tävlingar. Dokumentera som "by design".
- [ ] Planner och history ska visa `workoutColor(sportType, typeName)` konsekvent — inga lokala overrides

**Färgschema (komplett referens):**

| Sport / typ | Hex | Tailwind |
|---|---|---|
| Competition / Tävling (ALLA sporter) | `#FBBF24` | yellow-400 |
| Running — Easy / Distans (default) | `#7DD3FC` | sky-300 |
| Running — Tempo | `#2DD4BF` | teal-400 |
| Running — LT / Tröskel | `#F472B6` | pink-400 |
| Running — AT / Aerob tröskel | `#818CF8` | indigo-400 |
| Running — Speedwork / Intervall | `#3B82F6` | blue-500 |
| Cycling | `#FB923C` | orange-400 |
| Orienteering / OL | `#14B8A6` | teal-500 |
| Strength / Gym | `#D97706` | amber-600 |
| Nordic Skiing | `#BAE6FD` | sky-200 |
| Roller Skiing | `#38BDF8` | sky-400 |
| Swimming | `#60A5FA` | blue-400 |
| Completed (status, overlay) | `#22C55E` | green-500 |
| Missed (status, overlay) | `#EF4444` | red-500 |
| Unlogged past (status) | `#FBBF24` | yellow-400 |

Alla 12 sport/typ-färger är unika. Competition delar gul med "unlogged" men visas i olika kontext.

---

### P3 — Typ-system: Competition för alla sporter + manuell typ-skapelse

**Regler:**
- Workout types är användardefinierade (CLAUDE.md-regel — hardkoda aldrig i logik/UI)
- `workoutColor()` matchar "competition|comp|tävl|race|..." → gul, oavsett sport
- Användaren skapar Competition-typen manuellt i Settings → Sports

**Kvarstående:**
- [ ] Verifiera att Settings → Sports UI visar "Add type"-knappen för ALLA sporter, inte bara Running
  - Fil att kontrollera: `app/(dashboard)/settings/sports-client.tsx`
  - Om det är buggat: knappen ska visas per `SportCategory` oavsett sport
- [ ] Hint-text i UI: "Lägg till 'Competition' för gul färg i planner och history"
- [ ] Types ska vara sökbara/filterbara i WorkoutBuilder-dropdown när sporter är valda

---

### P4 — HR-logik: manuell override (delvis klar)

**Nuläge:** Manuellt satta `maxHeartRate`/`restingHeartRate` i AthleteProfile:
- ✅ Sparas persistent i DB
- ✅ Prioriteras alltid i `updateHRZones()` (manual path) och `updateVO2maxAndPaces()` (auto path)
- ✅ Triggar `updateHRZones()` vid profilspar

**Regler som redan gäller:**
- `updateHRZones()` skriver ALDRIG till `AthleteProfile` — enbart kalibrerade värden till `FitnessCache`
- Manuella override-värden skrivs ENBART via `/api/settings/profile`
- `FitnessCache.maxHR` = kalibrerat estimat; `AthleteProfile.maxHeartRate` = manuellt satt

**Kvarstående:**
- [ ] Stats-sidan ska tydligt visa om maxHR är manuellt satt eller estimerat
  - `AthleteProfile.maxHeartRate !== null` → visa "Manuellt: X bpm (trumfar estimat)"
  - `AthleteProfile.maxHeartRate === null` → visa "Estimerat: X bpm"
- [ ] Om användaren rensar maxHR-fältet (sätter till null) → ta bort profilvärdet, låt estimat ta över igen

---

### P5 — Edit aktivitet = WorkoutBuilder-formulär

**Nuläge:** Framtida workout-klick öppnar `WorkoutEditModal` (enkel form). Templates öppnar `WorkoutBuilder` (full form). De är separata.

**Mål:** Framtida workout-klick öppnar `WorkoutBuilder` i edit-läge, pre-populerat.

**Teknisk plan:**

1. **`WorkoutBuilder` prop-utökning:**
   ```ts
   interface WorkoutBuilderProps {
     mode?: "workout" | "template" | "edit-workout" | "edit-template";
     editWorkout?: PlannedWorkout;  // ny prop
     editTemplate?: WorkoutTemplate; // befintlig
     // ...
   }
   ```

2. **Pre-populering:** vid `editWorkout` → sätt initialt state: sport, type, namn, distans, tid, sektioner

3. **Save-path vid `edit-workout`:**
   - `PUT /api/planner/workouts/:id` med uppdaterad data
   - Om `saveAsTemplate` är checked → även `POST /api/planner/templates`

4. **"Spara som template"-checkboxens beteende per mode:**
   - `"workout"` (ny från dag-klick): checkbox visas, optional
   - `"template"` (ny från template-bibliotek): checkbox dold, alltid sparat som template
   - `"edit-workout"`: checkbox som "Uppdatera även template" (checked om workout har templateId)
   - `"edit-template"`: checkbox dold, alltid uppdaterar template

5. **`planner-client.tsx`:** byt `setEditWorkout(w)` → `openBuilder(w.date, { editWorkout: w })`

6. **`WorkoutEditModal`** kan tas bort när detta är implementerat

**Filer:**
- `components/planner/WorkoutBuilder.tsx`
- `app/(dashboard)/planner/planner-client.tsx`
- `app/api/planner/workouts/[id]/route.ts` (verifiera PUT-stöd)

---

### P6 — PB-tracker: anpassade distanser & multi-activity linking

**Nuläge:** `raceRecord`-tabellen håller PB-data. En aktivitet kan vara länkad via `activityId String?` (1-till-1).

**Mål:**
1. Användaren skapar egna trackade distanser/tävlingar ("17km Stafett", "42.5km Ultra")
2. En Strava-aktivitet kan kopplas till FLERA PB-poster (many-to-many)
3. Anpassade distanser visas i prediktionstabellen på stats-sidan

**Schema-ändringar:**
```prisma
model CustomPBDistance {
  id        String   @id @default(cuid())
  userId    String
  label     String        // "Stafett 17km"
  distanceM Float         // 17000
  notes     String?
  user      User     @relation(fields: [userId], references: [id])
  @@unique([userId, label])
}

// Ersätter raceRecord.activityId (ta bort den kolumnen)
model RaceRecordActivity {
  raceRecordId String
  activityId   String
  raceRecord   RaceRecord @relation(fields: [raceRecordId], references: [id], onDelete: Cascade)
  activity     Activity   @relation(fields: [activityId], references: [id], onDelete: Cascade)
  @@id([raceRecordId, activityId])
}
```

**API:**
- `GET/POST/DELETE /api/pb-distances` — hantera CustomPBDistance
- Uppdatera `/api/races` och `/api/stats` för multi-activity linking
- Migration: flytta befintlig `raceRecord.activityId` → `RaceRecordActivity`-tabell

**UI (races-sidan):**
- Knapp "Add custom distance" → dialog med label + distans
- Activity-multi-select vid PB-skapande
- Stats-sidan: anpassade distanser i prediktionstabellen

---

### P7 — Drag and drop: visuell feedback & undo

**Nuläge (efter fix):** Drag-and-drop fungerar för idag + framtid.

**Kvarstående:**
- [ ] Visuell feedback: `opacity-50` på WorkoutPill medan den dras (`onDragStart` → tillstånd, `onDragEnd` → återställ)
- [ ] Verifiera `handleMoveWorkout` i `planner-client.tsx` gör `PUT /api/planner/workouts/:id { date: newDate }`
- [ ] Toast-konfirmation med 5 sek undo: `"Flytt: 'Easy run' → 27 maj [Ångra]"`
- [ ] Undo-state: spara `{ workoutId, oldDate }` i React-state, rensa efter 5 sek

---

### P8 — Block-hue: tydligare visuell separation

**Nuläge (efter fix):** Dagcells bakgrundsfärg med opacity 13%. Fortfarande subtilt.

**Kvarstående:**
- [ ] Lägg till 3px vänsterborder i blockfärg på varje dagcell i blockperioden:
  ```tsx
  style={blockHere ? {
    backgroundColor: `${blockHere.color}22`,
    borderLeftColor: blockHere.color,
    borderLeftWidth: "3px",
    borderLeftStyle: "solid",
  } : undefined}
  ```
- [ ] Veckosammanfattnings-strip (`WeekSummaryStrip`) ska visa blockfärg i header om veckan är i ett block
- [ ] BlockBanner-raden ska ha en tunn färgad under-border i blockfärg

---

### P9 — Critical Speed som tredje LT2-estimat

**Plan:**
```typescript
// lib/fitness/critical-speed.ts
export interface CriticalSpeedResult {
  csMetersPerSec: number;   // ≈ LT2 pace
  wPrimeMeters: number;     // anaerob kapacitet
  rSquared: number;
  effortsUsed: number;
}

export function estimateCriticalSpeed(
  bestEfforts: Array<{ distance: number; elapsed_time: number }>
): CriticalSpeedResult | null
// Metod: linjär regression på (1/distance) vs (time/distance)
// CS = 1/slope, W' = intercept * CS
// Kräver minst 3 best efforts, 200m–10km
```
- Integreras i `cache.ts` → spara `criticalSpeedMs` i `FitnessCache`
- Visas i `HRZoneTable` på stats-sidan som "Critical Speed (LT2-proxy)"

---

---

### P10 — Temasystem: färgscheman med light/dark per tema

**Nuläge (efter fix):** Light/dark/system-toggle finns i Settings → Appearance och i sidebar-botten.

**Mål:** Användaren väljer ett av 4 färgscheman (t.ex. Forest, Ocean, Ember, Mono) — varje schema har en light- och dark-variant. Valet sparas persistent.

---

#### Arkitektur

**Två oberoende dimensioner:**
- `colorScheme`: vilket färgschema (`forest` | `ocean` | `ember` | `mono`)
- `mode`: light/dark/system (hanteras av `next-themes` precis som nu)

**Lagring:**
- `colorScheme` sparas i `localStorage` (`traininglab_scheme`)
- `mode` sparas redan av `next-themes` i `localStorage` (`theme`)
- Synkas INTE med DB — rent klient-state

---

#### CSS-struktur (`app/globals.css`)

```css
/* ── Tema: Forest (standard — befintlig) ─────────────────── */
:root,
.scheme-forest {
  --background:   #F8FAFC;
  --surface:      #FFFFFF;
  --surface-2:    #F1F5F9;
  --border:       #E2E8F0;
  --accent:       #059669;   /* emerald */
  --accent-2:     #6366F1;
  --text-primary: #0F172A;
  --text-muted:   #64748B;
}
.dark .scheme-forest,
.scheme-forest.dark {
  --background:   #0F1117;
  --surface:      #1A1D27;
  --surface-2:    #222534;
  --border:       #2D3148;
  --accent:       #6EE7B7;
  --accent-2:     #818CF8;
  --text-primary: #F1F5F9;
  --text-muted:   #94A3B8;
}

/* ── Tema: Ocean ──────────────────────────────────────────── */
.scheme-ocean {
  --background:   #F0F9FF;
  --surface:      #FFFFFF;
  --surface-2:    #E0F2FE;
  --border:       #BAE6FD;
  --accent:       #0284C7;   /* sky-600 */
  --accent-2:     #7C3AED;
  --text-primary: #0C4A6E;
  --text-muted:   #0369A1;
}
.dark .scheme-ocean,
.scheme-ocean.dark {
  --background:   #0A1628;
  --surface:      #0F2340;
  --surface-2:    #162D50;
  --border:       #1E3A5F;
  --accent:       #38BDF8;
  --accent-2:     #A78BFA;
  --text-primary: #E0F2FE;
  --text-muted:   #7DD3FC;
}

/* ── Tema: Ember ──────────────────────────────────────────── */
.scheme-ember {
  --background:   #FFF7ED;
  --surface:      #FFFFFF;
  --surface-2:    #FFEDD5;
  --border:       #FED7AA;
  --accent:       #EA580C;   /* orange-600 */
  --accent-2:     #DC2626;
  --text-primary: #431407;
  --text-muted:   #9A3412;
}
.dark .scheme-ember,
.scheme-ember.dark {
  --background:   #1A0A00;
  --surface:      #2D1200;
  --surface-2:    #3D1A00;
  --border:       #5C2800;
  --accent:       #FB923C;
  --accent-2:     #F87171;
  --text-primary: #FED7AA;
  --text-muted:   #FDBA74;
}

/* ── Tema: Mono ───────────────────────────────────────────── */
.scheme-mono {
  --background:   #FAFAFA;
  --surface:      #FFFFFF;
  --surface-2:    #F4F4F5;
  --border:       #E4E4E7;
  --accent:       #18181B;   /* zinc-900 */
  --accent-2:     #52525B;
  --text-primary: #09090B;
  --text-muted:   #71717A;
}
.dark .scheme-mono,
.scheme-mono.dark {
  --background:   #09090B;
  --surface:      #18181B;
  --surface-2:    #27272A;
  --border:       #3F3F46;
  --accent:       #E4E4E7;
  --accent-2:     #A1A1AA;
  --text-primary: #FAFAFA;
  --text-muted:   #A1A1AA;
}
```

**Klass appliceras på `<html>`-taggen** (bredvid `dark`-klassen):
```tsx
// Resultat i DOM:
<html class="dark scheme-ocean">      // Ocean dark
<html class="scheme-ember">           // Ember light
<html class="">                       // Forest light (standard)
```

---

#### React-implementation

**`components/color-scheme-provider.tsx`** (ny fil):
```tsx
"use client";
import { createContext, useContext, useEffect, useState } from "react";

type Scheme = "forest" | "ocean" | "ember" | "mono";
const SCHEMES: Scheme[] = ["forest", "ocean", "ember", "mono"];
const KEY = "traininglab_scheme";

const Ctx = createContext<{ scheme: Scheme; setScheme: (s: Scheme) => void }>({
  scheme: "forest", setScheme: () => {}
});

export function ColorSchemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setSchemeState] = useState<Scheme>("forest");

  useEffect(() => {
    const saved = localStorage.getItem(KEY) as Scheme | null;
    if (saved && SCHEMES.includes(saved)) setSchemeState(saved);
  }, []);

  function setScheme(s: Scheme) {
    // Remove old scheme class, add new
    document.documentElement.classList.remove(...SCHEMES.map(x => `scheme-${x}`));
    if (s !== "forest") document.documentElement.classList.add(`scheme-${s}`);
    localStorage.setItem(KEY, s);
    setSchemeState(s);
  }

  // Apply on mount
  useEffect(() => {
    if (scheme !== "forest") document.documentElement.classList.add(`scheme-${scheme}`);
  }, [scheme]);

  return <Ctx.Provider value={{ scheme, setScheme }}>{children}</Ctx.Provider>;
}

export const useColorScheme = () => useContext(Ctx);
```

**`app/layout.tsx`** — wrap med ColorSchemeProvider:
```tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  <ColorSchemeProvider>
    {children}
  </ColorSchemeProvider>
</ThemeProvider>
```

**`app/(dashboard)/settings/appearance-settings.tsx`** — utökas med schema-picker:
```tsx
const SCHEME_OPTIONS = [
  { value: "forest", label: "Forest", preview: { light: "#059669", dark: "#6EE7B7" } },
  { value: "ocean",  label: "Ocean",  preview: { light: "#0284C7", dark: "#38BDF8" } },
  { value: "ember",  label: "Ember",  preview: { light: "#EA580C", dark: "#FB923C" } },
  { value: "mono",   label: "Mono",   preview: { light: "#18181B", dark: "#E4E4E7" } },
];
// Visa som en rad av färgcirklar + namn, med aktiv markering
```

---

#### Filer att skapa/ändra

| Fil | Åtgärd |
|---|---|
| `app/globals.css` | Lägg till `.scheme-*` CSS-klasser |
| `components/color-scheme-provider.tsx` | Ny provider |
| `app/layout.tsx` | Wrap med ColorSchemeProvider |
| `app/(dashboard)/settings/appearance-settings.tsx` | Utöka med schema-picker |

**Obs:** Workout-färgerna i `lib/planner/colors.ts` (gul, rosa, teal etc.) är oberoende av temat — de är alltid desamma oavsett valt färgschema.

---

## Tekniska beroenden

```
Central config:
  lib/planner/colors.ts          ← färger (DONE)
  lib/fitness/zones.ts           ← HR-zoner, LT1/LT2
  lib/fitness/cache.ts           ← caching, HR-override (DONE)
  prisma/schema.prisma           ← PB many-to-many (P6)

Refaktoreringar:
  components/planner/WorkoutBuilder.tsx   ← mode-prop (P5)
  app/(dashboard)/planner/planner-client.tsx ← edit-flow (P5)
  app/(dashboard)/settings/sports-client.tsx ← type-skapelse alla sporter (P3)
  app/api/races/route.ts                  ← multi-activity linking (P6)
  app/api/settings/profile/route.ts      ← HR-override (DONE)

Nya filer:
  lib/fitness/critical-speed.ts          ← CS estimat (P9)
  app/api/pb-distances/route.ts          ← custom PB distanser (P6)
```

---

_Senast uppdaterad: 2026-05-26_
