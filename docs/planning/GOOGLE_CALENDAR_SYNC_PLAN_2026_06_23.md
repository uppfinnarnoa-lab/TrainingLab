# Koppla Planner till Google Calendar

**Status:** Research klar, redo för implementation
**Skapad:** 2026-06-23

## 1. Mål

Planerade pass (`PlannedWorkout`) ska speglas till användarens Google-kalender, så de syns i telefonens kalenderapp/notiser utan att öppna TrainingLab. **Enkelriktad sync (planner → Google Calendar)** för MVP — inte tvåvägs. Att bygga tvåvägs (läsa ändringar gjorda i Google Calendar tillbaka till planneren) är betydligt mer komplext (kräver webhook push-notiser från Google, konflikthantering) och är inte vad användaren bett om ("koppla planner TILL google kalendern").

## 2. Befintligt mönster att följa (Strava/Garmin)

TrainingLab har redan två OAuth-integrationer med ett tydligt, repeterbart mönster — Google Calendar-integrationen ska följa det **exakt**, inte uppfinna ett nytt:

| Lager | Strava-exempel | Mönster att kopiera |
|---|---|---|
| Token-lagring | `StravaAccount` (`prisma/schema.prisma:75-86`) | Ny modell `GoogleCalendarAccount`: `userId` (unique), `accessToken`/`refreshToken` (krypterade strängar), `expiresAt`, `scope`, `calendarId` (vilken kalender att skriva till — default `"primary"`), `lastSyncAt` |
| Kryptering | `lib/encrypt.ts` — `encrypt()`/`decrypt()`/`safeDecrypt()`, AES-256-GCM, nyckel derived från `AUTH_SECRET` | Återanvänd direkt, ingen ny kryptolösning |
| CSRF | `lib/oauth-state.ts` — `generateOAuthState(userId)` / `verifyOAuthState(state, userId)` | Återanvänd direkt |
| OAuth-klient | `lib/strava/client.ts` — **rå `fetch`, ingen SDK** (`getStravaAuthUrl`, `exchangeStravaCode`, `refreshStravaToken` med dedupe-Map, `stravaFetch` wrapper) | Bygg `lib/google-calendar/client.ts` med samma form: `getGoogleAuthUrl`, `exchangeGoogleCode`, `refreshGoogleToken`, `googleCalendarFetch`. **Installera INTE `googleapis`/`google-auth-library`** — koden använder konsekvent rå REST/fetch för externa API:er (Strava och Garmin gör det), och `googleapis` är en tung SDK som bryter den konventionen i onödan. Google Calendar API v3 är ren REST (`https://www.googleapis.com/calendar/v3/...`, token-endpoint `https://oauth2.googleapis.com/token`) — fullt görbart med `fetch`. |
| Callback-route | `app/api/strava/callback/route.ts` | Ny route `app/api/google-calendar/callback/route.ts` — samma struktur: `auth()`-session-check → `verifyOAuthState` → exchange code → kryptera tokens → `prisma.googleCalendarAccount.upsert()` → redirect till `/settings?google=connected` |
| Admin-credentials (client ID/secret) | `AppConfig.stravaClientId/stravaClientSecret`, läses via `lib/config.ts:getCredentials()` (DB → env-var fallback) | Lägg till `googleClientId`/`googleClientSecret` på `AppConfig`, samma fallback-kedja |
| UI | `app/(dashboard)/settings/strava-connect.tsx` | Ny komponent `google-calendar-connect.tsx`: connect-knapp (ej ansluten), status + "Sync now"-knapp + disconnect (ansluten) — rendera i `app/(dashboard)/settings/page.tsx` som ett tredje/fjärde integrations-kort bredvid Strava/Garmin/AI Coach |
| Cron (om periodisk backfill behövs) | `lib/cron.ts` — itererar `prisma.stravaAccount.findMany()` | Sannolikt **onödigt** för denna funktionen — se §4, sync sker event-drivet vid skapande/redigering/borttagning av `PlannedWorkout`, inte på ett schema |

## 3. Google Cloud-uppsättning (manuellt steg, dokumentera i `docs/integrations/`)

- Skapa OAuth-klient i Google Cloud Console, typ "Web application".
- Scope: **`https://www.googleapis.com/auth/calendar.events`** — events-only, INTE fullt `calendar`-scope (minsta-privilegium; appen ska aldrig kunna läsa/ändra kalenderns inställningar eller andra kalendrar).
- Redirect URI: `https://training.helgars.se/api/google-calendar/callback` (+ en för lokal dev om `localhost` testas).
- `access_type=offline` + `prompt=consent` måste sättas i auth-URL:en för att garanterat få en `refresh_token` tillbaka (annars returneras bara `refresh_token` vid FÖRSTA godkännandet — ett känt Google-API-gotcha, se research). Om appen är i "Testing"-läge i Google Cloud (inte verifierad) kan refresh-tokens sluta fungera efter ~7 dagar — flagga detta tydligt i UI:t om anslutningen går sönder, och dokumentera att appen bör sättas till "In production" (kräver ingen Google-granskning för detta scope eftersom det är ett "sensitive" men inte "restricted" scope — verifiera vid implementation).
- Dokumentera hela uppsättningsflödet i `docs/integrations/google-calendar.md` (ny fil, samma stil som `docs/integrations/strava.md`), INNAN routes byggs (`docs/guides/documentation-rules.md`: "Doc before code").

## 4. Synkroniseringslogik

### Schema-ändring
Lägg till `googleEventId String?` på `PlannedWorkout` (`prisma/schema.prisma:281-307`) — kopplar ett planerat pass till sitt motsvarande Google Calendar-event.

### Händelsedrivna hooks (inte cron)
Lägg sync-anrop i de tre befintliga API-routes för `PlannedWorkout`, fire-and-forget (samma mönster som `fetchAndSaveWeather(...).catch(() => {})` i `lib/strava/sync.ts:116`) så att ett Google-fel aldrig blockerar eller kraschar planner-CRUD:

- **POST `/api/planner/workouts`** (`app/api/planner/workouts/route.ts`) → efter DB-create: om `GoogleCalendarAccount` finns, skapa event, spara `googleEventId`.
- **PATCH `/api/planner/workouts/[id]`** → om `googleEventId` finns: uppdatera eventet (datum/namn/notes ändrade). Om passet markeras `completed`/`missed`/`partial` — avgör om titeln ska uppdateras (t.ex. prefix `✓` eller `✗`) som en lätt nice-to-have, inte kärnfunktion.
- **DELETE `/api/planner/workouts/[id]`** → om `googleEventId` finns: ta bort eventet från Google Calendar innan/efter DB-delete.

### Initial backfill
När en användare ansluter Google Calendar första gången: lägg en "Push upcoming workouts to calendar"-knapp i UI (mirror av Strava-mönstrets "sync now") som hämtar alla framtida `PlannedWorkout` (datum ≥ idag, `googleEventId: null`) och skapar event för var och en. **Bara framtida** — ingen anledning att fylla kalendern med historiska pass.

### Event-tid: PlannedWorkout har bara datum, ingen tid
`PlannedWorkout.date` är `@db.Date` (`prisma/schema.prisma:286`) — inget klockslag lagras. Två rimliga val:
1. **All-day event** (Google Calendar stödjer detta nativt — `start: { date: "2026-06-23" }` istället för `dateTime`). Enklast, ingen schemaändring, och matchar att appen aldrig har spårat en exakt starttid. **Rekommenderas för MVP.**
2. Lägg till en valfri `plannedTime`-inställning (per pass eller global default i Settings, t.ex. "06:00") och skapa tidsatta event istället. Mer värde (riktiga notiser vid en specifik tid) men kräver schemaändring + UI. **Flagga som möjlig snabb v2 om all-day-notiser visar sig vara otillräckligt för användaren** — bedöm efter att MVP är i drift.

**Öppen fråga till användaren/implementerande agent:** vilket av dessa två (all-day vs. tidsatt) ska byggas? Plan rekommenderar (1) som MVP eftersom det inte kräver schemaändring och redan ger värdet "syns i kalendern" — men om hela poängen är telefon-notiser vid en specifik tid (t.ex. "06:00 dags att springa") krävs (2). Avgör detta innan implementation påbörjas, t.ex. genom att fråga användaren direkt.

### Event-innehåll
- Titel: `PlannedWorkout.name`
- Beskrivning: bygg en kort sammanfattning av `WorkoutSection`-strukturen (om passet har en länkad `WorkoutTemplate`) — distans/varaktighet/zon per sektion, samma typ av text som redan visas i `WorkoutBuilder`-förhandsvisningen (`lib/planner/estimate.ts`). Inkludera `notes` om satt.
- Färg: Google Calendar-event stödjer `colorId` (begränsad palett, 1-11) — mappa ungefärligt från `PlannedWorkout.color`/sport-färgen om det är värt komplexiteten, annars hoppa över.

## 5. Token-refresh-felhantering

Google-refresh-tokens kan återkallas av användaren (i sina Google-kontoinställningar) eller sluta gälla. Följ samma försiktighetsprincip som Strava: om `refreshGoogleToken` misslyckas med en "invalid_grant"-typ av fel, markera kopplingen som trasig (t.ex. töm `accessToken`/sätt en `needsReconnect`-flagga, eller helt enkelt visa "Anslutning bruten — anslut igen" i UI baserat på ett misslyckat senaste sync-försök) istället för att tyst fortsätta misslyckas i bakgrunden vid varje passändring.

## 6. Filer som skapas/ändras (checklista)

- `prisma/schema.prisma` — `GoogleCalendarAccount`-modell, `AppConfig.googleClientId/googleClientSecret`, `PlannedWorkout.googleEventId`
- `lib/google-calendar/client.ts` — OAuth + token refresh (mirror `lib/strava/client.ts`)
- `lib/google-calendar/sync.ts` — `createEvent`/`updateEvent`/`deleteEvent`/`pushUpcomingWorkouts`
- `lib/encrypt.ts`, `lib/oauth-state.ts`, `lib/config.ts` — återanvänds, ingen ändring förväntad
- `app/api/google-calendar/callback/route.ts` — OAuth callback
- `app/api/google-calendar/sync/route.ts` — manuell "push upcoming"-trigger + disconnect
- `app/api/planner/workouts/route.ts`, `app/api/planner/workouts/[id]/route.ts` — hook in sync-anrop vid create/update/delete
- `app/(dashboard)/settings/google-calendar-connect.tsx` — UI (mirror `strava-connect.tsx`)
- `app/(dashboard)/settings/page.tsx` — rendera nya kortet
- `docs/integrations/google-calendar.md` — ny doc (skriv FÖRE implementation, se §3)
- `docs/api/planner.md` — uppdatera om planner-endpoints får nya sidoeffekter dokumenterade
- `docs/architecture/overview.md` — lägg till `GoogleCalendarAccount` i schema-tabellen

## 7. Validering

1. Anslut ett riktigt Google-konto i dev, skapa/redigera/ta bort ett planerat pass, bekräfta i Google Calendar-appen (mobil + webb) att eventet skapas/uppdateras/försvinner korrekt.
2. Testa "push upcoming workouts"-backfill mot ett konto med flera framtida pass.
3. Testa felfallet: återkalla appens åtkomst i Google-kontot, bekräfta att nästa sync-försök ger ett begripligt fel i UI istället för att krascha eller tyst misslyckas.
4. `pnpm build --no-lint` utan TypeScript-fel.

---

## Slutinstruktion till implementerande agent

Implementera genomtänkt — särskilt beslutet i §4 om all-day vs. tidsatta event påverkar hela UX:en, avgör det medvetet (fråga användaren om osäker) innan du bygger vidare. Iterera mot ett riktigt Google-konto, inte bara mockad data, tills sync känns pålitlig i båda riktningar (skapa→syns, redigera→uppdateras, radera→försvinner).

1. **Dubbelkolla att implementationen fungerar korrekt** mot ett riktigt anslutet Google-konto (inte bara att koden kompilerar) — verifiera alla tre CRUD-flöden i §7 manuellt.
2. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` med en sessionspost, samt `docs/integrations/google-calendar.md` och `docs/architecture/overview.md` enligt §6.
3. Flytta denna fil till `docs/planning/archive/` när allt ovan är bekräftat klart.
