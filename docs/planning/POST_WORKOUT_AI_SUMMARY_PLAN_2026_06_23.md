# Automatisk AI-sammanfattning + notis efter varje pass

**Status:** Research klar — **en designfråga måste avgöras innan/under implementation** (se §3)
**Skapad:** 2026-06-23

## 1. Mål

Efter att ett nytt pass synkats in från Strava: generera en kort AI-analys/sammanfattning av passet och skicka den som ett meddelande till användaren (push/chatt, inte bara synlig i appen). Av/på-bar i Settings, med valbar AI-modell. Inte ett tidsstyrt cron-jobb i klassisk mening (`0 6 * * *`) — utan **händelsestyrt**: triggas av att en ny `Activity` skapas.

## 2. Hook-punkt: var "efter varje pass" faktiskt är i koden

Tre kodvägar skapar nya `Activity`-rader (research bekräftad via `lib/strava/sync.ts`):

| Funktion | Var den körs | Har redan ett "ny aktivitet"-villkor? |
|---|---|---|
| `syncActivities()` (rad 43-139) | 06:00-cronet (`lib/cron.ts`) + manuell "Sync now"-knapp + `/api/cron/sync` | ✅ Ja — `const exists = await prisma.activity.findUnique(...)` (rad 77-80) följt av `if (!exists) { ...fetch full detail... }`. Detta är den **mest tillförlitliga** platsen att hooka in på, eftersom `!exists` redan beräknas för exakt detta syfte. |
| `syncSingleActivity()` (rad 212-241) | Strava webhook (`activity.create`-event) | ⚠️ Nej — gör alltid `upsert`, ingen explicit `exists`-check innan. Måste läggas till (en `findUnique` innan `upsert`, precis som i `syncActivities`) för att kunna avgöra "är detta genuint nytt" innan sammanfattningen triggas — annars skulle en uppdatering av en befintlig aktivitet (t.ex. titel/beskrivning redigerad i Strava-appen) felaktigt trigga en ny notis. |
| `resyncRecentActivities()` (rad 146-206) | Manuell "smart resync"-knapp | ✅ Delvis — har redan en `existing`-check (rad 167-172) som skiljer create från update. |

**Rekommendation:** Bygg en delad funktion, t.ex. `onNewActivityCreated(userId: string, activityId: string)` i `lib/strava/sync.ts` (eller en ny `lib/strava/activity-hooks.ts`), som anropas från alla tre platser **bara när aktiviteten är genuint ny**. Denna funktion blir den gemensamma triggerpunkten för **både** denna funktion **och** [[AUTO_PB_DETECTION_PLAN_2026_06_23]] (automatisk PB-identifiering, separat plan) — bygg dem så att de inte krockar eller dubbel-triggas om båda planerna implementeras. I dag finns redan en liknande lokal funktion `tryMatchActivity()` (rad 243+, matchar mot planerat pass) som anropas **bara** från `syncSingleActivity` — notera att den alltså idag INTE körs för cron-/manuell sync-vägen, vilket är en befintlig lucka (oavsett om den är avsiktlig eller inte) som bör verifieras och eventuellt åtgärdas samtidigt, enligt Bug Audit Practice i `CLAUDE.md`.

## 3. ÖPPEN DESIGNFRÅGA: notifieringskanal

Appen har idag **ingen** notifieringsinfrastruktur (ingen e-post/SMTP, ingen webpush trots att `next-pwa` är installerat — det ger bara installerbarhet, ingen push-funktion är kopplad). Detta måste väljas innan implementation, eftersom valet styr vad som behöver byggas (admin-uppsättning, per-användarfält, beroenden).

| Kanal | Friktion att sätta upp | Kostnad | Notiskvalitet | Rekommendation |
|---|---|---|---|---|
| **Telegram-bot** | Admin skapar EN bot via @BotFather (2 min, gratis, evigt). Varje användare startar en chatt med boten och hämtar sitt eget `chat_id` via `getUpdates`, klistrar in i Settings. | Gratis, ingen infrastruktur | Mycket bra — native appar överallt, Markdown-formatering för snygg AI-sammanfattning, klickbar historik | **Rekommenderas** |
| **ntfy.sh** | Användaren väljer valfritt topic-namn, installerar ntfy-appen, klistrar in topic i Settings. Ingen bot-uppsättning alls. | Gratis (publik instans) eller självhostad | Bra, enklare än Telegram men publika topics är inte autentiserade (vem som vet/gissar topic-namnet kan läsa/skicka) om man inte självhostar med auth | Bra alternativ om Telegram känns för mycket, men kräver att man väljer ett tillräckligt slumpat topic-namn för integritet |
| E-post (SMTP/Resend) | Kräver SMTP-konto eller Resend-API-nyckel, fler rörliga delar | Gratistier finns (Resend: 100/dag) | Sämre för "kort pass-notis" — känns som spam i inkorgen | Inte rekommenderat för detta specifika use-case |
| Webpush (utöka `next-pwa`) | Kräver VAPID-nycklar, service worker-handler, subscription-lagring — mest jobb av alla | Gratis | Bra UX om det fungerar, men störst implementationsrisk | Inte för MVP |

**Denna plan rekommenderar Telegram-bot som primärt val**, med ntfy som dokumenterat alternativ om användaren föredrar det. Eftersom detta är en produktbeslutsfråga (vilken kanal användaren faktiskt vill ha notiser i), bör implementerande agent **bekräfta valet med användaren innan byggande påbörjas** om det inte redan är uppenbart vid det laget — annars riskerar man att bygga fel kanal.

### Om Telegram väljs (designdetaljer)
- **Ett** delat bot-token för hela appen (självhostad, en instans) i env-var `TELEGRAM_BOT_TOKEN` — inte per-användare, eftersom det är en app-nivå-resurs (jfr. `AUTH_SECRET`/`CRON_SECRET`, inte `StravaAccount`-mönstret som är genuint per-användare OAuth).
- Per användare: bara `telegramChatId` behöver lagras (inget hemligt, men inte publikt heller — vanlig fältkryptering ej nödvändig, men skada är begränsad om den läcker: bara den specifika chatten kan nås, och bara av boten själv).
- Skicka meddelande: `POST https://api.telegram.org/bot<TOKEN>/sendMessage` med `chat_id` + `text` (+ `parse_mode: "Markdown"` för formaterad sammanfattning) — ett enda `fetch`-anrop, inget bibliotek behövs.
- UX-flöde i Settings: visa botens användarnamn (`@DittAppNamnBot`) + en länk `https://t.me/<bot_username>`, instruktion "skicka /start till boten, klistra sedan in chat_id nedan" + ett fält för `chat_id` + en "skicka test-notis"-knapp.

## 4. Datamodell

Ny modell `NotificationSettings` (1:1 med `User`, samma mönster som `AISettings`/`AthleteProfile`):
```prisma
model NotificationSettings {
  id                          String   @id @default(cuid())
  userId                      String   @unique
  channel                     String   @default("none") // "none" | "telegram" | "ntfy"
  telegramChatId              String?
  ntfyTopic                   String?
  postWorkoutSummaryEnabled   Boolean  @default(false)
  postWorkoutSummaryProvider  String?  // null = använd samma provider som AISettings.provider
  postWorkoutSummaryModel     String?  // för providers med modellval (nvidia/groq/kimi)
  user                        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```
**Varför separat modell och inte fält på `AISettings`:** `AISettings` handlar om coach-chattens provider/nycklar/budget. Notifieringskanal är ett annat ansvarsområde (leverans, inte generering) — håll isär, samma princip som att `AppConfig`/`AthleteProfile`/`AISettings` redan är separata 1:1-modeller per ansvarsområde istället för en jätte-`User`-tabell.

**Varför egen provider/model-väljare för sammanfattningen, separat från huvud-coachen:** Användaren bad explicit om att kunna "välja modell" för just denna funktion i inställningar — det antyder ett eget val, inte bara på/av. Rimlig default: `null` → ärv `AISettings.provider`/modell, så de flesta användare aldrig behöver röra det, men möjlighet finns att t.ex. köra en snabbare/gratis modell (Kimi, se [[KIMI_FREE_MODEL_PLAN_2026_06_23]]) för korta automatiska sammanfattningar medan huvudchatten kör Claude.

## 5. Generera sammanfattningen

- Ny funkion `buildPostWorkoutSummaryPrompt(activity, recentContext)` — INTE samma prompt som coach-chatten (`lib/ai/prompts.ts:buildSystemPrompt`), som är byggd för en flerturskonversation med cachead systemprompt. Detta är ett enstaka, fristående anrop: kort prompt med passets nyckeltal (distans, tid, snittfart, snitt-HR, zonfördelning, väder, ev. beskrivning/anteckningar från Strava) + ev. jämförelse mot matchat planerat pass (`Activity.matchedPlannedId` → `PlannedWorkout`) + senaste veckans kontext för "hur passar detta in".
- Återanvänd `AIClient`-abstraktionen (`lib/ai/client.ts`) och den valda providerns klass (`ClaudeClient`/`GeminiClient`/`NvidiaClient`/`GroqClient`/`KimiClient`) — anropa `.stream()` och konkatenera alla `text`-delar till ett färdigt textmeddelande (ingen streaming behövs i bakgrunden, ingen ny "complete"-metod behöver läggas till i interfacet).
- Spara INTE detta som ett `Message`/`Conversation` (det är inte en coach-chatt) — eller, om det är önskvärt att det syns i coach-historiken också, skapa en dedikerad `Conversation` (t.ex. titel "Auto-sammanfattningar") och lägg meddelandet där som ett `assistant`-`Message` — avgör baserat på om användaren vill kunna bläddra tillbaka i appen, inte bara i Telegram. **Inte kärnkrav, men billigt att lägga till — gör det om det inte komplicerar implementationen nämnvärt.**

## 6. Filer som skapas/ändras

- `prisma/schema.prisma` — `NotificationSettings`-modell
- `lib/notifications/telegram.ts` — `sendTelegramMessage(chatId, text)`
- `lib/ai/post-workout-summary.ts` — bygger prompt + kör vald AIClient + returnerar färdig text
- `lib/strava/sync.ts` (eller ny `lib/strava/activity-hooks.ts`) — delad `onNewActivityCreated`-dispatcher, anropad från alla 3 sync-vägar (se §2)
- `app/api/settings/notifications/route.ts` — GET/POST för `NotificationSettings`
- `app/(dashboard)/settings/notifications-settings.tsx` + ny flik i `components/settings/settings-nav.tsx` (`/settings/notifications`)
- `docs/api/settings.md` (om den inte redan dokumenterar `/api/settings/*`, lägg till detta endpoint där det är konsekvent med övriga)
- `docs/architecture/overview.md` — lägg till `NotificationSettings` i schema-tabellen

## 7. Validering

1. Anslut Telegram (eller valt alternativ), skicka en test-notis, bekräfta leverans.
2. Synka in ett nytt riktigt Strava-pass (eller simulera via webhook/manuell sync), bekräfta att exakt EN notis skickas — inte en per sync-väg, inte vid efterföljande uppdateringar av samma aktivitet.
3. Testa avstängd-läge: stäng av funktionen i Settings, bekräfta att inget meddelande skickas vid nästa nya pass.
4. Testa modellval: byt `postWorkoutSummaryProvider` till en annan provider än huvud-coachen, bekräfta att sammanfattningen faktiskt genereras med rätt modell (kontrollera t.ex. svarsstil eller logga modellnamn temporärt under test).
5. `pnpm build --no-lint` utan TypeScript-fel.

---

## Slutinstruktion till implementerande agent

Avgör notifieringskanalen i §3 **medvetet** (fråga användaren om det inte redan är beslutat) innan du bygger vidare — det är den enda riktiga öppna frågan i denna plan, resten är mekaniskt. Bygg hook-punkten i §2 så att den delas korrekt med [[AUTO_PB_DETECTION_PLAN_2026_06_23]] om/när den implementeras i samma session eller en senare — undvik att två separata `onNewActivityCreated`-varianter uppstår. Iterera tills ett riktigt nytt pass faktiskt triggar exakt en korrekt, läsbar notis i vald kanal.

1. **Dubbelkolla att implementationen fungerar korrekt** genom att synka in ett riktigt nytt pass och bekräfta att notisen anländer, ser bra ut, och inte dubbel-triggas — inte bara att koden kompilerar.
2. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` med en sessionspost, och `docs/architecture/overview.md`/relevanta `docs/api/`-filer enligt §6.
3. Flytta denna fil till `docs/planning/archive/` när allt ovan är bekräftat klart.
