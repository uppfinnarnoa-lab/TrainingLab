# Automatisk identifiering av PB:n vid synk

**Status:** Research klar, redo för implementation
**Skapad:** 2026-06-23

## 1. Mål

När ett nytt pass synkas in från Strava: identifiera automatiskt om det innehåller ett nytt personbästa (PB) för någon standarddistans, och lägg in det i `RaceRecord` utan att användaren manuellt behöver göra det via Races-sidans formulär. Av/på/läge ("Automatisk" / "Manuell") väljs i Settings.

## 2. Hook-punkt — delad med pass-sammanfattningsfunktionen

Samma händelsestyrda triggerpunkt som i [[POST_WORKOUT_AI_SUMMARY_PLAN_2026_06_23]] §2: en ny `Activity`-rad skapas i `syncActivities()`, `syncSingleActivity()`, eller `resyncRecentActivities()` (`lib/strava/sync.ts`). **Bygg en delad `onNewActivityCreated`-dispatcher en gång** och låt både den funktionen och denna prenumerera på den — implementeras de i olika sessioner, kontrollera att den andra planen inte redan skapat en konkurrerande variant innan en ny läggs till.

## 3. Var datan för PB-kandidater faktiskt finns (verifierat, inte antaget)

Två tänkbara källor undersöktes:

1. **Hela aktiviteten** (`Activity.distance`/`movingTime`, om `isRace=true`) — det befintliga `/api/races/auto-link`-flödet (`app/api/races/auto-link/route.ts:38-44`) matchar redan på detta sätt: ±1 dag, ±20% distans-tolerans mot en **manuellt inmatad** `RaceRecord`. Problemet med att återanvända detta rakt av för AUTOMATISK detektion: GPS-mätt distans för t.ex. en "10K-lopp" kan vara 10.08km eller 9.92km, vilket gör exakt tid-jämförelse mot en standarddistans (10000m) inexakt.
2. **`Activity.bestEfforts`** (JSON-fält, redan fyllt av Strava för varje löppass som passerar en standarddistans) — Strava beräknar själv den bästa **exakta** segmenttiden för fasta distanser (400m, 800m, 1K, 1 mile, 2 mile, 5K, 10K, 15K, 10 mile, 20K, Half-Marathon, 30K, Marathon) inom GPS-spåret, oavsett om aktiviteten är flaggad som lopp eller inte. Detta är **redan** den datakälla `lib/fitness/vo2max.ts` litar på för VDOT-skattning (`estimateVO2max`, rad 482-489) och för `personalizedFatigueExponent` (rad 255-285, `byDistance`-bucketing per exakt `distance`-värde). Verifierat mot riktig data i denna kodbasen (se research-loggen för [[RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23]]) — fälten finns och är pålitliga för 1K–marathon.

**Rekommendation: använd uteslutande `bestEfforts` som källa.** Det löser GPS-tolerans-problemet helt (Strava interpolerar redan fram exakt distans-matchning) och kräver ingen ny ±20%-godtycklighet. Hela-aktiviteten-matchning (auto-link-mönstret) behövs INTE för detta — den löser ett annat problem (länka en REDAN inmatad manuell post till en aktivitet för visningssyfte), inte "har ett nytt PB satts".

## 4. Detekteringslogik (förslag)

För varje ny `Activity` med `sportType` som matchar löpning:
1. Hämta `bestEfforts` (om null/tom array → inget att göra).
2. För varje post: matcha `distance`-fältet (exakt, i meter) mot `RACE_DISTANCES` (`lib/fitness/paces.ts:3-13`: 800m, 1500m, 1609m/Mile, 3000m, 5000m, 10000m, 15000m, 21097m, 42195m) — **notera**: Stravas egna standarddistanser (400/800/1000/1609/3219/5000/10000/15000/16090/20000/21097/30000/42195) överlappar inte perfekt med `RACE_DISTANCES`; matcha på `distance`-värdet, inte namnet, och utöka `RACE_DISTANCES`-listan om det är värt det, eller hantera Stravas distanser som en separat tabell — avgör vid implementation baserat på vilka som faktiskt förekommer i datan.
3. Hämta nuvarande bästa `RaceRecord` för samma distans-label (lägsta `time` där `distance` matchar).
4. **Om ingen tidigare `RaceRecord` finns för den distansen:** skapa bara automatiskt en första post **om `Activity.isRace === true`** (dvs. användaren har själv flaggat passet som ett lopp i Strava). Skapa INTE en ny distanskategori av ett vanligt träningspass bara därför att Strava råkar kunna beräkna en bästa-5K-tid ur det — det skulle fylla PB-trackern med segment användaren aldrig avsett som ett "personbästa att spåra". Detta är en medveten avvägning, inte en bugg — se §6.
5. **Om en tidigare `RaceRecord` finns:** om den nya tiden är strikt snabbare → detta är ett nytt PB, oavsett om passet är flaggat som lopp eller inte (ett PB är per definition den snabbaste uppmätta tiden, inte ett intentions-flagga).
6. Vid träff i automatiskt läge: skapa en ny `RaceRecord`-rad (`isManual: false`, `stravaActivityId: activity.stravaId.toString()`, `date: activity.startDate`, `eventName: activity.name`, `distance`/`distanceM` från matchningen, `time` från `bestEffort.elapsed_time`). **Skapa en ny rad, skriv inte över/radera den gamla** — `RaceRecord` är redan historik per distans (se `prisma/schema.prisma:309-324`, ordnad `distanceM asc, date desc`), och Races-sidan visar redan "bästa" som ett `reduce()` över alla poster för en distans (`races-client.tsx` rad ~72) — så detta mönster passar utan ändringar på visningssidan.

## 5. Inställning: Automatisk vs. Manuell

- Nytt fält `pbDetectionMode String @default("manual")` på `AthleteProfile` (`prisma/schema.prisma:45-64`) — denna modell är redan appens "diverse personliga preferenser"-plats (jfr. `paceUnit`/`paceUnitBySport`), så ett till litet preferensfält hör naturligt hemma där snarare än i en ny modell.
- **Default = `"manual"`** — bevarar exakt dagens beteende för befintliga användare; ingen överraskning vid uppgradering.
- UI: lägg till en sektion i `app/(dashboard)/settings/athlete-profile.tsx` (samma fil som redan hanterar `paceUnit`-väljaren) — två radioknappar/segment-knappar "Automatisk" / "Manuell", med en kort förklarande text ("Automatisk lägger in nya personbästa direkt när Strava-passet synkas. Manuell betyder att du själv lägger in dem på Races-sidan, som idag.").
- API: utöka `app/api/settings/profile/route.ts` (eller motsvarande befintlig profile-endpoint) med fältet, samma mönster som övriga `AthleteProfile`-fält.

## 6. Avsiktliga avgränsningar (dokumentera, inte buggar)

- Automatiskt tillagda PB:n är fortfarande vanliga `RaceRecord`-rader — användaren kan redigera/radera dem precis som manuella via befintliga `PATCH`/`DELETE /api/races/[id]` om en GPS-spik eller felklassificering skulle smyga sig in (samma säkerhetsnät som auto-link redan förlitar sig på).
- §4 punkt 4 (kräv `isRace` för FÖRSTA posten på en ny distans, men inte för att SLÅ en befintlig) är en medveten avvägning för att undvika att svämma över PB-trackern med ointressanta segment. Om användaren efter att ha testat funktionen tycker det är fel håll (t.ex. vill ha även förstagångs-distanser auto-spårade), är det en enrad-ändring att ta bort `isRace`-kravet — flagga detta i PR/commit-beskrivningen så det är lätt att hitta och justera.
- Ingen notis skickas härifrån som standard — om [[POST_WORKOUT_AI_SUMMARY_PLAN_2026_06_23]] redan är implementerad är det en billig, trevlig utbyggnad att skicka "🎉 Nytt PB: 5K på 18:15 (-13s)" via samma notifieringskanal, men bygg INTE in ett beroende mellan planerna — denna funktion ska fungera helt fristående även om notisfunktionen aldrig implementeras.

## 7. Filer som skapas/ändras

- `prisma/schema.prisma` — `AthleteProfile.pbDetectionMode`
- `lib/strava/sync.ts` / delad hook-fil — `detectAndRecordPBs(userId, activityId)`, prenumererar på `onNewActivityCreated`
- `lib/races/pb-detection.ts` (ny) — ren matchningslogik (distans-mappning, jämförelse), testbar isolerat från DB-anrop
- `app/api/settings/profile/route.ts` — nytt fält
- `app/(dashboard)/settings/athlete-profile.tsx` — UI-sektion
- `docs/api/races.md` — dokumentera den nya sidoeffekten ("ny `RaceRecord` kan skapas automatiskt vid sync, se `pbDetectionMode`")
- `docs/schemas/` — om det finns en `RaceRecord`-specifik schemadoc, notera `isManual: false` + auto-skapande där

## 8. Validering

1. Sätt läge till "Automatisk", synka in en aktivitet med ett `bestEffort` som slår en befintlig `RaceRecord` för samma distans — bekräfta att en ny rad skapas korrekt och syns på Races-sidan som ny "bästa".
2. Synka in en aktivitet som INTE slår något befintligt PB — bekräfta att inget skapas.
3. Synka in ett nytt `isRace=true`-pass på en distans som aldrig spårats förut — bekräfta att en första post skapas. Synka in samma scenario med `isRace=false` — bekräfta att INGET skapas (per §4 punkt 4).
4. Sätt läge till "Manuell" — bekräfta att inget automatiskt skapas alls, och att befintligt manuellt flöde (Races-sidans formulär + `/api/races/auto-link`) fortfarande fungerar oförändrat.
5. `pnpm build --no-lint` utan TypeScript-fel.

---

## Slutinstruktion till implementerande agent

Implementera genomtänkt — särskilt avgränsningen i §6 (kräv `isRace` för nya distanser, inte för att slå befintliga) är en avsiktlig produktbeslut, inte en given sanning; om du under testning (§8) känner att det ger fel känsla i praktiken, justera och dokumentera varför i commit-meddelandet snarare än att tyst avvika från denna plan. Iterera tills detekteringen känns korrekt mot riktiga Strava-data, inte bara syntetiska testfall.

1. **Dubbelkolla att implementationen fungerar korrekt** genom att köra valideringsstegen i §8 mot riktiga synkade aktiviteter (inte bara enhetstester) — bekräfta att PB:n faktiskt dyker upp på Races-sidan med rätt distans, tid och `isManual: false`.
2. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` med en sessionspost, samt `docs/api/races.md` enligt §7.
3. Flytta denna fil till `docs/planning/archive/` när allt ovan är bekräftat klart.
