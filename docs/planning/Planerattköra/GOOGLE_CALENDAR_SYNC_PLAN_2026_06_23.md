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

1. **All-day event** (Google Calendar stödjer detta nativt — `start: { date: "2026-06-23" }` istället för `dateTime`). Enklast, ingen schemaändring.
2. Lägg till en valfri `plannedTime`-inställning (per pass eller global default i Settings, t.ex. "06:00") och skapa tidsatta event istället. Kräver schemaändring + UI.

**⚠️ Uppdaterad rekommendation efter research (Calendar API-dokumentationen, bekräftat):** all-day-event-notiser går **inte** att styra via API:et — "the Calendar API does not expose the settings for all-day event notifications". Ett all-day-event får bara den fasta standardpåminnelse-tid som är satt i användarens EGNA Google Calendar-app-inställningar (ofta ett klockslag dagen innan, t.ex. 09:00) — appen kan INTE sätta "påminn 30 min innan" på ett all-day-event på ett sätt som faktiskt fungerar som en passpåminnelse. Om hela poängen med målet i §1 ("syns i telefonens kalenderapp/notiser") är en **tidsrelevant** notis (t.ex. väckning/push strax innan ett morgonpass) — inte bara att passet syns i kalendervyn — är **all-day otillräckligt redan i MVP**, inte en "v2-finputsning". Detta är därför inte längre en öppen fråga att skjuta på, utan ett beslut att ta **innan kodning påbörjas**: fråga användaren explicit om de vill kunna luta sig mot Google Calendars EGNA notiser för ett specifikt klockslag (→ bygg tidsatta event + `plannedTime`-fält direkt) eller om "synlig i kalendern, oavsett notistid" räcker (→ all-day är fine).

### Event-innehåll
- Titel: `PlannedWorkout.name`
- Beskrivning: bygg en kort sammanfattning av `WorkoutSection`-strukturen (om passet har en länkad `WorkoutTemplate`) — distans/varaktighet/zon per sektion, samma typ av text som redan visas i `WorkoutBuilder`-förhandsvisningen (`lib/planner/estimate.ts`). Inkludera `notes` om satt.
- Färg: Google Calendar-event stödjer `colorId` (begränsad palett, 1-11) — mappa ungefärligt från `PlannedWorkout.color`/sport-färgen om det är värt komplexiteten, annars hoppa över.

## 5. Token-refresh- och konflikt-felhantering

Google-refresh-tokens kan återkallas av användaren (i sina Google-kontoinställningar) eller sluta gälla. Följ samma försiktighetsprincip som Strava: om `refreshGoogleToken` misslyckas med en "invalid_grant"-typ av fel, markera kopplingen som trasig (t.ex. töm `accessToken`/sätt en `needsReconnect`-flagga, eller helt enkelt visa "Anslutning bruten — anslut igen" i UI baserat på ett misslyckat senaste sync-försök) istället för att tyst fortsätta misslyckas i bakgrunden vid varje passändring.

**Eventet kan också ha försvunnit på Google-sidan utan att TrainingLab vet om det** — t.ex. om användaren själv raderar eventet direkt i Google Calendar-appen, eller raderar HELA kalendern. Nästa `updateEvent`/`deleteEvent`-anrop mot ett `googleEventId` som inte längre finns ger ett `404` från Calendar API. Hantera detta explicit: vid `404` på en update, behandla det som "finns inte längre" — antingen återskapa eventet (om passet fortfarande är aktuellt) eller bara nolla `googleEventId` på `PlannedWorkout` och logga, snarare än att låta ett okänt fel kasta/blockera resten av sync-anropet. Detta är **inte** samma fall som ett trasigt OAuth-token (hela kontot) — det är per-event och ska hanteras per-event.

## 6. Kritisk granskning (andra researchpasset)

- **Rå `fetch` vs. `googleapis`-SDK — en verklig avvägning, inte en självklarhet.** Rekommendationen i §2 att undvika `googleapis` håller fast vid kodbasens konvention (Strava/Garmin gör likadant), men Googles OAuth/Calendar-API har fler kantfall än Strava/Garmins enklare REST-API:er (t.ex. `404` på borttagna event ovan, kvot-`403`:or, klockskillnader mellan klient/server för `expiresAt`). En väl underhållen SDK hade hanterat retry/backoff och vissa av dessa kantfall automatiskt. **Håll fast vid rå `fetch`** för konsekvens, men var medveten om att det innebär att implementerande agent själv måste bygga in: (a) en enkel retry-med-backoff för `5xx`/nätverksfel (Strava-klienten har redan rate-limit-hantering att kopiera mönstret från), och (b) explicit `404`-hantering per event (se ovan) — anta INTE att frånvaron av en SDK är riskfritt bara därför att Strava-mönstret fungerat hittills för enklare API:er.
- **All-day-vs-tidsatt (§4) var tidigare skriven som en "öppen fråga att avgöra senare" — det är fel prioritet.** Eftersom Calendar API:et inte exponerar all-day-påminnelseinställningar (bekräftat ovan), avgör detta beslut om hela funktionen levererar det användaren förmodligen egentligen vill ha (en notis vid en relevant tid). Fråga användaren INNAN kodning, inte efter MVP.
- **`PlannedWorkout` kan ändras av `tryMatchActivity`/aktivitetsmatchning också** (se `lib/strava/sync.ts`, matchar en synkad aktivitet till ett planerat pass och sätter `status`/kopplingen) — bekräfta att den koden, om den skriver till `PlannedWorkout`-fält som syns i kalendereventet (namn/status), också går via samma sync-hook, annars kan kalendereventet och DB-posten driva isär utan att någon av planner-API-routerna (§4) ens anropades.

## 7. Filer som skapas/ändras (checklista)

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

## 8. Validering

1. Anslut ett riktigt Google-konto i dev, skapa/redigera/ta bort ett planerat pass, bekräfta i Google Calendar-appen (mobil + webb) att eventet skapas/uppdateras/försvinner korrekt.
2. Testa "push upcoming workouts"-backfill mot ett konto med flera framtida pass.
3. Testa felfallet: återkalla appens åtkomst i Google-kontot, bekräfta att nästa sync-försök ger ett begripligt fel i UI istället för att krascha eller tyst misslyckas.
4. Testa konfliktfallet från §5: radera ett synkat event direkt i Google Calendar-appen, redigera sedan samma pass i TrainingLab — bekräfta att `404`:an hanteras enligt §5, inte kastas okontrollerat.
5. `pnpm build --no-lint` utan TypeScript-fel.

---

## Slutinstruktion till implementerande agent

Implementera genomtänkt — särskilt beslutet i §4 om all-day vs. tidsatta event påverkar hela UX:en och bör avgöras MED användaren innan kodning (se uppdaterad rekommendation i §4 och §6 — detta är inte längre en lågprioriterad "v2-fråga"). Iterera mot ett riktigt Google-konto, inte bara mockad data, tills sync känns pålitlig i båda riktningar (skapa→syns, redigera→uppdateras, radera→försvinner) och tål de kantfall som beskrivs i §5/§6 (raderat event, kvotfel, trasigt token).

1. **Dubbelkolla att implementationen fungerar korrekt** mot ett riktigt anslutet Google-konto (inte bara att koden kompilerar) — verifiera alla flöden i §8 manuellt.
2. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` med en sessionspost, samt `docs/integrations/google-calendar.md` och `docs/architecture/overview.md` enligt §7.
3. Flytta denna fil till `docs/planning/archive/` när allt ovan är bekräftat klart.
