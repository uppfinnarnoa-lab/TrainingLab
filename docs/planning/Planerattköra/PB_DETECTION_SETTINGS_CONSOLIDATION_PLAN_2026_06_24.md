# PB-detektering: striktare regel mot flödning + egen Settings-sektion + borttagningsknapp

**Status:** Research klar, redo för implementation
**Skapad:** 2026-06-24

## 1. Bakgrund — detta är INTE en bugg i detekteringslogiken, det är en omdesign + en regelskärpning

Användaren rapporterade att "Scan history for PBs" letade en stund men inte hämtade något. Innan kodändring undersöktes detta enligt **Bug Audit Practice** i `CLAUDE.md`:

1. Funktionen (knapp + Settings-toggle + tröskel-%) **finns redan, byggd tidigare samma dag** i commit `2dd18e7` ("automatic PB/near-PB detection from synced Strava activities"), specificerad i [[AUTO_PB_DETECTION_PLAN_2026_06_23]] (`docs/planning/archive/AUTO_PB_DETECTION_PLAN_2026_06_23.md`) och loggad i `docs/planning/IMPLEMENTATION_PLAN.md` ("Session 2026-06-24 — Automatic PB / near-PB detection implemented end-to-end").
2. Detekteringslogiken verifierades mot **riktig data i lokal dev-DB** (engångsskript, körd och borttagen): en in-memory-replikering av exakt samma `matchTrackedDistance`/`shouldRecordResult`-logik som produktionskoden använder hittade **82 legitima PB/nära-PB-resultat** bland användarens 2023 löp-/terränglöpningsaktiviteter. Detekteringslogiken körde alltså korrekt — inte trasig.
3. Användaren bekräftade att backfillen **faktiskt fungerade** vid körning — **ingen "hittar inget"-bugg.** (Bug Audit Practice: "Om en 'bugg' visar sig vara korrekt beteende, dokumentera varför" — dokumenterat här.)
4. **Men** vid granskning av resultatet visade det sig att **800m och 2 Mile flödades över med långsamma, icke-meningsfulla resultat** — ett verkligt designproblem i regeln, inte i UI:t. Användaren diagnosticerade själv den utlösande faktorn: de distanserna hade **inget manuellt PB inlagt sedan tidigare**. Se §4 för rotorsaksanalys och fix.

Tre konkreta ändringar krävs, formulerat av användaren efter denna utredning:

- **(§3)** Nära-PB-matchning ska bara backfillas/spåras för aktiviteter **senaste året** — riktiga nya All-time-PB:n sparas oavsett ålder.
- **(§4)** Regeln måste skärpas så att distanser **utan en manuellt verifierad baseline** inte svämmas över av vanliga träningssplittar — detta är den faktiska orsaken till 800m/2 Mile-flödet.
- **(§5)** En knapp i Settings för att **ta bort alla automatiskt detekterade PB:n** (rensa flödet, kunna börja om).
- **(§6)** Knappen, togglen och tröskel-%-fältet ska bo **tillsammans i en ny egen sektion i Settings**, inte utspridda mellan Athlete-Profile-formuläret och Races-sidan.

En liten, oberoende **riktig bugg** hittades samtidigt under utredningen (§7: `handleScanHistory` saknar all felhantering) — fixas som ett gratis sidospår.

## 2. Vad som redan finns (rör inte detta i sig, bygg vidare på det)

- `lib/races/distances.ts` — `RACE_DISTANCE_PRESETS`, `matchTrackedDistance()` — **oförändrat**.
- `lib/races/pb-detection.ts` — `shouldRecordResult()`, `detectPBsForActivity()`, `detectAndRecordPBs()` — **ändras i §3+§4**, arkitekturen (en delad ren funktion + en DB-medveten wrapper, använd av båda anropsställena) behålls.
- `app/api/races/scan-history/route.ts` — **ingen kodändring behövs.** Anropar redan `detectPBsForActivity()` per aktivitet och ärver §3+§4 automatiskt.
- `lib/strava/sync.ts` — tre anropsställen till `detectAndRecordPBs()` — **ingen kodändring**, ärver §3+§4 automatiskt.
- `AthleteProfile.pbDetectionMode` / `pbDetectionModeChangedAt` / `pbDetectionTolerancePct` (`prisma/schema.prisma:63-65`) — **oförändrat.**

## 3. Ändring A — nära-PB begränsas till senaste 365 dagarna, riktiga PB:n påverkas inte

**Varför:** ett genuint nytt All-time-PB är alltid värt att spara, oavsett hur gammalt det är (backfill ska kunna hitta ett PB från för 5 år sedan). Men ett resultat som bara ligger "nära" PB (inte en faktisk förbättring) blir mindre meningsfullt ju äldre det är — annars riskerar listan att fyllas med år gamla nästan-bra pass. Se den kombinerade, slutgiltiga regeln i §4d (denna sektion beskriver bara `withinLastYear`-delen isolerat för tydlighet).

**Beräkning av `withinLastYear`** i `detectPBsForActivity` — relativt NU (körtillfället), med redan tillgängligt datum (`recordDate`, härlett från `activity.startDateLocal` — inget nytt `select`-fält behövs):

```ts
const withinLastYear = Date.now() - recordDate.getTime() <= 365 * 24 * 60 * 60 * 1000;
```

**Designval att vara medveten om:**

- **En exakt tie (`newTimeSec === currentBestSec`) räknas som nära-PB, inte som nytt PB** — den slår inte rekordet, den matchar det. Omfattas av samma 365-dagarsfönster. Om detta känns fel i praktiken är det en encharacter-ändring (`<` → `<=` på PB-grenen i §4d) — flagga i commit-meddelandet om du ändrar det.
- **Fönstret är relativt NU, inte relativt aktivitetens egen historiska "då-aktuella PB"** — exakt som användaren formulerade det. En backfill körd om 6 månader "tappar" naturligt nära-PB-resultat som idag är 7 månader gamla men då skulle vara 13 — avsiktligt (rullande fönster), inte en bugg. Befintliga `RaceRecord`-rader rensas INTE retroaktivt när de åldras ur fönstret.
- **Påverkan på live-synk-hooken (`detectAndRecordPBs`) är försumbar** — en nyss synkad aktivitet är per definition nästan alltid "senaste året". Denna ändring är i praktiken en backfill-/historik-begränsning.

## 4. Ändring B — rotorsak till att 800m och 2 Mile flödades över + fix

### 4a. Vad som faktiskt hände (bekräftat mot riktig data)

Den engångssimulering som verifierade detekteringslogiken (§1 punkt 2) loggade exempel på vad som FAKTISKT skulle skapas för 800m och "2 Mile" (3219m). Ett urklipp ur den loggen, i kronologisk ordning:

```text
800m  6:26  isRace=true   "IFK Enskede lång!"          ← seed (lopp-flaggad, följer befintlig regel korrekt)
800m  6:07  isRace=false  "Evening Run"
800m  4:51  isRace=false  "Evening Run"
800m  4:47  isRace=false  "10Mila sträcka 2 ..."
800m  3:20  isRace=false  "Löptävling testrunda med Elias!"
800m  3:12  isRace=false  "Löprunda men 1 km test"
800m  3:13  isRace=false  "Kristinebergs IP 1 km"
800m  3:03  isRace=false  "1km testrundan!"
800m  3:01  isRace=false  "1km race mot Elias!"
800m  3:09  isRace=false  "2km test på skolan!"
```

Tiderna spänner från 6:26 (lätt joggtempo) till 3:01 (extremt snabbt) — inte en sammanhängande "nära PB"-grupp, utan **i princip varje löprunda** som råkade innehålla en hyfsad 800m-sträcka någonstans i spåret. Seeden själv (6:26, lopp-flaggad) följde den befintliga regeln korrekt — problemet är vad som händer EFTER seeden.

### 4b. Den djupare mekanismen (varför just korta distanser, oavsett seed)

Strava beräknar `bestEfforts` som **den snabbaste sammanhängande sträckan av exakt den längden NÅGONSTANS i aktiviteten** — helt oberoende av om passet var en medveten hård insats. För 5K/10K/halvmaraton krävs en medvetet hållen fart under lång tid för att registrera ett starkt segment — vanlig lätt löpning kvalificerar nästan aldrig av misstag. För **800m och 2 Mile** räcker en enda nedåtbacke, en spurt vid ett trafikljus, eller bara naturlig paceringsvariation i EN vanlig löprunda för att råka generera ett "snabbt" 800m/2-mile-segment — helt oavsett passets syfte. Det gör dessa distansers `bestEffort`-data strukturellt mycket brusigare än längre distansers, **oavsett vilken regel som styr seeden.**

### 4c. Varför distanser MED ett manuellt PB inte hade samma problem

De distanser som redan hade ett **manuellt** inlagt PB sedan tidigare (10K, 3K, 5K, 1K, Mile, 2K, 400m — 15 befintliga rader, alla `isManual: true`) hade en **noggrant verifierad, korrekt** baseline — ett genuint tävlingsresultat satt med avsikt. Ett sådant PB representerar typiskt en riktig prestationsgräns, så ett 5%-toleransfönster runt det är smalt **i absoluta termer relativt löparens faktiska förmåga** — vanlig träning hamnar sällan av misstag inom 5% av ett genuint, medvetet uppnått tävlingsresultat på 5K+.

800m och 2 Mile hade inget sådant manuellt ankare. Den AUTOMATISKT bootstrappade seeden (den första lopp-flaggade aktiviteten som råkade innehålla ett 800m-segment) är **inte nödvändigtvis löparens bästa möjliga 800m-prestation** — bara vad som råkade dyka upp tidigast kronologiskt. Kombinerat med brusigheten i §4b blir nettoeffekten: en bred, icke-verifierad baseline + extremt vanligt förekommande "kandidat-segment" per löprunda = flödning.

### 4d. Fixen: kräv en MANUELLT verifierad baseline innan icke-lopp-data alls får röra en distans

**Viktig självkorrigering gjord under denna plans extra granskningsvarv:** ett första utkast till denna fix definierade "verifierad baseline" som "isManual ELLER kom från en lopp-flaggad aktivitet", och spärrade bara den ICKE-förbättrande (nära-PB) grenen. Det var fel på två sätt, båda synliga om man spårar §4a:s exempel-logg steg för steg:

1. Seeden (`isRace: true`, 6:26) gör enligt den OFÖRÄNDRADE bootstrap-regeln (`currentBestSec === null → isRace`) att en lopp-flaggad post ALLTID skapas direkt. Om "verifierad baseline" sedan definieras som "isManual ELLER lopp-flaggad", blir baseline **trivialt sann direkt efter den första posten** — spärren skyddar då aldrig något, eftersom seeden per konstruktion alltid är lopp-flaggad.
2. Att bara spärra den ICKE-förbättrande grenen missar den faktiska majoriteten av flödet: `6:26 → 6:07 → 4:51 → 4:47 → 3:20 → 3:12 → 3:03 → 3:01` i §4a är en **kedja av sekventiella "förbättringar"** (varje tid är snabbare än föregående "best so far") — inte nära-PB-träffar. Eftersom `newTimeSec < currentBestSec` redan tidigare gav `return true` direkt, oavsett källa, hade INGEN av dessa block:erats av en spärr som bara gäller nära-PB-grenen. Detta är statistiskt väntat för en brusig distans: minimum-av-N sjunker stegvis när N (antal aktiviteter) växer, så en lång rad falska "nya rekord" är precis vad man ska förvänta sig av slumpmässiga 800m-segment ur vanlig träning — inte tecken på faktisk förbättring.

**Korrigerad princip:** "verifierad baseline" betyder **uteslutande en manuellt inlagd post** (`isManual: true`) — INTE en tidigare auto-detekterad lopp-flaggad post. Och spärren gäller **alla** icke-lopp-resultat för en distans (förbättring såväl som nära-PB), inte bara nära-PB-grenen. Tills användaren själv lagt in minst en manuell post för en distans får ENDAST `isRace: true`-aktiviteter skapa eller uppdatera `RaceRecord` för den distansen — oavsett om kandidaten råkar vara snabbare än den (i sig overifierade) nuvarande bästa eller inte. Detta stänger flödet helt: i §4a-exemplet är samtliga icke-lopp-poster (`isRace: false`) nu blockerade rakt av, medan den enda genuint lopp-flaggade posten ("Lidingö Medel!") fortsatt sparas.

**Slutgiltig, kombinerad `shouldRecordResult`** (ersätter både dagens version och utkastet i §3 ovan — detta är den version som faktiskt ska implementeras):

```ts
// lib/races/pb-detection.ts
export function shouldRecordResult(opts: {
  newTimeSec: number;
  currentBestSec: number | null;
  tolerancePct: number;
  isRace: boolean;
  withinLastYear: boolean;          // §3 — aktivitetens datum inom 365 dagar bakåt från nu
  distanceHasManualBaseline: boolean; // §4 — minst en RaceRecord för denna distans har isManual: true
}): boolean {
  const { newTimeSec, currentBestSec, tolerancePct, isRace, withinLastYear, distanceHasManualBaseline } = opts;
  if (currentBestSec === null) return isRace; // oförändrat — kräver isRace för FÖRSTA posten på en distans
  if (!distanceHasManualBaseline && !isRace) return false; // ingen MANUELL baseline ännu — blockera ALL icke-lopp-data (förbättring eller nära-PB) för denna distans
  if (newTimeSec < currentBestSec) return true; // riktigt nytt All-time-PB — spara alltid när spärren ovan är godkänd, oavsett ålder
  return withinLastYear && newTimeSec <= currentBestSec * (1 + tolerancePct / 100); // nära-PB (inkl. exakt tie)
}
```

**Ordningen på villkoren är avsiktlig och kritisk** — spärren (rad 2) måste ligga FÖRE förbättrings-kollen (rad 3), annars smiter en "förbättring" från brusig icke-lopp-data igenom precis som i den ursprungliga buggen ovan.

**Ingen schemaändring krävs** (till skillnad från ett tidigare utkast av denna plan) — `distanceHasManualBaseline` läses direkt ur det redan existerande `isManual`-fältet, inget nytt fält behövs.

**Uppdaterad frågelogik i `detectPBsForActivity`** — dagens kod hämtar bara den SNABBASTE existerande raden (`findFirst(orderBy: time asc, select: {time})`). Det räcker inte längre — vi behöver känna till ALLA rader för distansen för att avgöra `distanceHasManualBaseline`:

```ts
const distanceRecords = await prisma.raceRecord.findMany({
  where: { userId, distance: matched.label },
  select: { time: true, isManual: true },
});
const currentBestSec = distanceRecords.length > 0
  ? Math.min(...distanceRecords.map(r => r.time))
  : null;
const distanceHasManualBaseline = distanceRecords.some(r => r.isManual);
```

**Designval att vara medveten om:**

- Detta gäller **per distans**, inte globalt — att 5K redan har en manuell baseline gör inget för 800m. Konsekvent med hur `currentBest` redan är distans-scopat.
- **En enskild lopp-flaggad auto-post räcker INTE som baseline**, även om den känns "verifierad" — exakt den luckan som flödade över i verkligheten (§4a). Ett enstaka `bestEffort`-segment ur ett lopp representerar inte nödvändigtvis ett fokuserat maximalt försök på just den distansen (t.ex. en 800m-bit ur ett mycket längre lopp), och att lita på den som ankare öppnar samma brus-problem den var tänkt att stoppa.
- Konsekvensen: tills användaren manuellt lägger in en distans, kan auto-detektering **bara** lägga till genuint lopp-flaggade resultat för den — aldrig träningsdata, även om träningsresultatet råkar vara snabbare än det enda som finns. Detta är en medveten, strikt avvägning grundad i verklig flödning, inte en gissning — om det visar sig för strikt i praktiken (t.ex. en distans som ALDRIG körs som eget lopp men ofta som ett ärligt hårt träningssegment) är det värt att se över, men ändra inte tyst utan att flagga i commit-meddelandet.
- **Detta är avsiktligt striktare än ursprungsplanens §4b-utbyggnad** ("en stark tempokörning som inte riktigt slog PB:et" ska kunna sparas) — men bara EFTER att en manuell baseline finns. Innan det krävs lopp, för ALLA resultat på distansen. Detta var inte uttryckligen specat i originalplanen eftersom flödningsproblemet inte var känt då.
- **Återställ INTE redan flödade rader automatiskt** — det är vad knappen i §5 är till för. Denna fix förhindrar framtida flödning; den rensar inte upp det som redan ligger i databasen.

## 5. Ändring C — knapp för att ta bort alla automatiska PB:n (Settings)

**Ny endpoint** `app/api/races/auto-detected/route.ts`:

```ts
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { count } = await prisma.raceRecord.deleteMany({
    where: { userId: session.user.id, isManual: false },
  });
  return NextResponse.json({ deleted: count });
}
```

- Tar bort **alla** `isManual: false`-rader för användaren, oavsett distans — en global "nollställ flödet"-åtgärd, exakt som efterfrågat (inte per-distans — håll det enkelt tills ett verkligt behov för mer finkornig kontroll dyker upp).
- Manuella poster (`isManual: true`) påverkas aldrig.
- **Destruktiv, går inte att ångra** — kräver en bekräftelse-steg i UI, samma mönster som redan finns för borttagning av en enskild post på Races-sidan (`confirmDeleteId`-state i `races-client.tsx`): första klick visar en varningstext + en bekräfta-knapp, andra klicket (bekräfta) utför själva `DELETE`-anropet. Visa antal borttagna (`"({deleted} removed)"`) efter, samma badge-mönster som "(N added)"/"(N linked)" på de andra knapparna.
- Knappen bor i samma nya Settings-sektion som backfill-knappen (§6) — naturligt arbetsflöde: rensa → kör om backfill med den skärpta regeln (§4).

## 6. Ändring D — egen Settings-sektion (flytt från Athlete-Profile-formuläret och Races-sidan)

**Nuvarande placering (verifierad genom att läsa koden):**

- Togglen (Automatisk/Manuell) + tröskel-%-fältet ligger idag begravda som ETT `<Field>` (`app/(dashboard)/settings/athlete-profile.tsx:176-209`) inne i det stora `AthleteProfileForm` — samma form som vikt, längd, HR-zoner, årsmål etc., med EN gemensam spara-knapp för alltihop.
- Knappen "Scan history for PBs" ligger på Races-sidan (`app/(dashboard)/races/races-client.tsx:168-179`), helt separat.
- Settings-sidan för profil (`app/(dashboard)/settings/profile/page.tsx`) renderar redan tre fristående `<section>`-kort i rad: "Athlete Profile", "Appearance", "Change password" — varje sektion har sin egen rubrik och oberoende sparalogik. **Detta är det etablerade mönstret en ny sektion ska följa.**

**Plan:**

1. **Nytt komponentfil** `app/(dashboard)/settings/pb-detection.tsx`, exporterar `PBDetectionSettings({ initial })` — egen `useState`, egen spara-knapp för togglen+tröskeln (POST `/api/settings/profile` med ENDAST `{ pbDetectionMode, pbDetectionTolerancePct }`), egen felvisning (samma `saveError`-mönster som redan finns i `athlete-profile.tsx`/`change-password.tsx`).
2. I samma komponent: knappen "Scan history for PBs" (flyttad logik från `races-client.tsx:92-105`, med felhanteringsfixen från §7) OCH knappen "Remove all automatic PBs" (§5) — två fristående åtgärdsknappar i samma kort, synliga oavsett `pbDetectionMode`-läge (båda är engångshandlingar, oberoende av automatiskt/manuellt läge).
3. Ta bort PB-detection-`<Field>`:et (rad 176-209) och motsvarande props ur `Profile`-interfacet i `athlete-profile.tsx`.
4. I `app/(dashboard)/settings/profile/page.tsx`: lägg till ett nytt `<section>`-kort (samma `rounded-2xl bg-surface border border-border p-6 space-y-5`-mönster) med `<PBDetectionSettings>`, placerat direkt efter "Athlete Profile"-sektionen och före "Appearance". Flytta `pbDetectionMode`/`pbDetectionTolerancePct`-värdena från `AthleteProfileForm`s `initial`-prop till den nya komponentens `initial`-prop istället.
5. **Uppdatera tröskel-fältets hjälptext** så både 365-dagarsfönstret (§3) och den verifierade-baseline-regeln (§4) är begripliga för användaren, t.ex.: *"Also track training results within ___% of your PB, from the last 12 months — only once that distance has a verified best (manual entry or a flagged race). All-time PBs are always tracked regardless of age or source. 0% = strict PBs only."*
6. **Ta bort** "Scan history for PBs"-knappen från Races-sidan (`races-client.tsx:168-179`) — den bor nu i Settings tillsammans med tröskelinställningen och borttagningsknappen den hör ihop med. (Om det i praktiken känns fel att inte ha snabb åtkomst från Races-sidan är det en enrad-ändring att lägga tillbaka — flagga i commit-meddelandet, gissa inte tyst.)

### 6b. KRITISK upptäckt — `/api/settings/profile` nollställer tyst `dateOfBirth`/`sex` vid partiell payload

`app/api/settings/profile/route.ts:66` och `:72-73`:

```ts
dateOfBirth: profileData.dateOfBirth ? new Date(profileData.dateOfBirth) : null,
sex: profileData.sex || null,
```

Detta körs **ovillkorligt** i både `create`- och `update`-grenarna av `athleteProfile.upsert()`. Idag är detta ofarligt eftersom den ENDA anroparen (`AthleteProfileForm.handleSave()`) alltid skickar HELA formuläret.

**Den nya `PBDetectionSettings`-komponenten (§6 punkt 1) skickar bara `{ pbDetectionMode, pbDetectionTolerancePct }`** — `dateOfBirth`/`sex` blir då `undefined` i `profileData`, vilket de två raderna ovan slår om till `null` — **detta skulle radera användarens sparade födelsedatum och kön varje gång de bara ändrar PB-inställningen**, helt tyst.

**Obligatorisk fix innan §6 byggs:** skilj "fältet skickades inte med" (`undefined`, ska INTE röra fältet — Prisma tolkar `undefined` i en `update`-payload som "rör inte detta fält") från "fältet skickades med och är tomt" (`null`/`""`, ska rensa fältet):

```ts
dateOfBirth: "dateOfBirth" in (body ?? {})
  ? (profileData.dateOfBirth ? new Date(profileData.dateOfBirth) : null)
  : undefined,
sex: "sex" in (body ?? {}) ? (profileData.sex || null) : undefined,
```

**Verifiera mot BÅDA anroparna efter fixen:** (1) `AthleteProfileForm` (skickar alltid hela formuläret) måste fortfarande kunna rensa `dateOfBirth`/`sex` till tomt när användaren aktivt tömmer fältet och sparar. (2) `PBDetectionSettings` (ny) — `dateOfBirth`/`sex` ska vara **orörda** efteråt.

## 7. Ändring E (litet, oberoende) — felhantering på "Scan history"-knappen

Oavsett att den ursprungliga buggrapporten visade sig vara icke-reproducerbar: `handleScanHistory()` (idag `races-client.tsx:92-105`, flyttas till `pb-detection.tsx` i §6) saknar helt felhantering — ingen `try/catch` runt `fetch`, och om `res.ok` är `false` (timeout, 401, 500, …) återställs knappen bara tyst utan att visa något åt användaren. Fixa med samma mönster som redan finns i `athlete-profile.tsx`/`change-password.tsx` (`saveError`-state + synlig feltext), inte en tyst `console.error`. Gäller även den nya "Remove all automatic PBs"-knappen (§5) — samma fix, samma mönster, byggs rätt direkt istället för att kopiera samma brist två gånger.

## 8. Filer som skapas/ändras

- `lib/races/pb-detection.ts` — `shouldRecordResult()` + `detectPBsForActivity()` (§3, §4d) — **ingen schemaändring krävs**, se §4d
- `app/api/races/auto-detected/route.ts` (ny) — `DELETE`, tar bort alla `isManual:false`-rader (§5)
- `app/(dashboard)/settings/pb-detection.tsx` (ny) — `PBDetectionSettings`-komponenten (§5, §6, §7)
- `app/(dashboard)/settings/athlete-profile.tsx` — ta bort PB-detection-`<Field>` och tillhörande props (§6)
- `app/(dashboard)/settings/profile/page.tsx` — nytt `<section>`-kort, flyttade props (§6)
- `app/(dashboard)/races/races-client.tsx` — ta bort "Scan history for PBs"-knappen + tillhörande state (§6 punkt 6)
- `app/api/settings/profile/route.ts` — partial-update-fix för `dateOfBirth`/`sex` (§6b)
- `docs/api/races.md` — uppdatera `scan-history`-beskrivningen med 365-dagarsregeln + verifierad-baseline-regeln (§3, §4), dokumentera ny `DELETE /api/races/auto-detected` (§5)
- `docs/planning/IMPLEMENTATION_PLAN.md` — sessionspost

## 9. Validering (obligatorisk innan denna plan arkiveras)

1. **§4 — rotorsaksfixen, den viktigaste valideringen:** återskapa engångssimuleringen från denna utrednings tidigare körning mot riktig lokal dev-DB, men med den nya regeln. Bekräfta konkret att 800m och 2 Mile **inte** längre flödas över — ALLA exempel-aktiviteterna som loggades i §4a ("Evening Run", "1km testrundan!" etc., alla `isRace: false`) ska nu **avvisas rakt av** (oavsett att flera av dem tekniskt var "snabbare än föregående best so far") tills en MANUELL post finns för respektive distans, medan den ursprungliga lopp-flaggade seeden (`isRace: true`, "IFK Enskede lång!") och den senare lopp-flaggade posten ("Lidingö Medel!") fortfarande sparas. Testa explicit att en kedja av sekventiellt snabbare icke-lopp-resultat (som i §4a) INTE skapar flera rader.
2. **§3 — tidsfönster:** en aktivitet äldre än 365 dagar med ett resultat 2% sämre än PB → INTE sparad; en aktivitet 400 dagar gammal med ett resultat 1% BÄTTRE än PB, EFTER att en manuell baseline redan finns → SPARAD (riktigt nytt PB, ålder spelar ingen roll). Lägg till båda fallen i `shouldRecordResult()`-testerna, samma mönster som de "7 pure cases" som redan validerade detta i förra sessionen.
3. **§4 — `distanceHasManualBaseline`:** testa explicit båda hållen och ordningen mellan villkoren — en distans med EN manuell post tillåter både en icke-lopp-flaggad förbättring OCH en icke-lopp-flaggad nära-PB-träff (om inom tolerans och senaste året); en distans med NOLL manuella poster avvisar en icke-lopp-flaggad kandidat HELT, även om den (a) annars vore inom tolerans, (b) är inom senaste året, OCH (c) tekniskt är snabbare än nuvarande (overifierade) best — detta tredje fallet är den exakta regressionen som missades i planens första utkast och måste ha ett eget testfall.
4. **§5 — borttagningsknappen:** kör mot en testanvändare med en blandning av manuella och automatiska poster, bekräfta att endast `isManual:false`-rader tas bort och att manuella poster är orörda efteråt. Bekräfta bekräftelse-steget faktiskt krävs (ingen DELETE utan andra klicket).
5. **§6b — den kritiska regressionen:** spara PB-inställningarna via den nya `PBDetectionSettings`-komponenten, ladda om Settings, bekräfta att `dateOfBirth`/`sex` i `AthleteProfileForm` fortfarande visar samma värden som innan (inte tomma). Spara sedan via `AthleteProfileForm` med ett ifyllt födelsedatum, bekräfta att det fortfarande sparas korrekt (regressionstest på den befintliga anroparen).
6. **§6 — UI-flytt:** bekräfta att togglen, tröskel-%-fältet och båda knapparna syns och fungerar i den nya Settings-sektionen, och att scan-knappen INTE längre finns på Races-sidan.
7. **§7 — felhantering:** simulera ett serverfel och bekräfta att ett synligt felmeddelande visas istället för att knappen bara tystnar, för båda knapparna.
8. Bekräfta att `scan-history`-endpointen och `lib/strava/sync.ts`s tre anropsställen fortfarande fungerar oförändrat — de kräver inga egna kodändringar, men ärver §3+§4 via den delade funktionen.
9. `pnpm build --no-lint` och `npx tsc --noEmit` utan fel innan commit.

---

## Slutinstruktion till implementerande agent

Det viktigaste i denna plan är §4 — inte §6 (UI-flytten är enkel och lågrisk). §4 är en regelskärpning grundad i verklig, observerad flödning (800m/2 Mile), inte en gissning, så avvik inte från den utan att först ha verifierat mot riktig data att en alternativ regel löser samma problem lika bra. Näst viktigast är §6b: lätt att missa eftersom den inte syns förrän man har två oberoende anropare till samma endpoint, men konsekvensen (tyst dataförlust av födelsedatum/kön) är allvarlig. Bygg och testa §6b FÖRE eller TILLSAMMANS MED §6, aldrig efter.

1. **Dubbelkolla att implementationen fungerar korrekt** genom att köra valideringsstegen i §9 mot riktiga data i lokal dev-DB (inte bara enhetstester med påhittade siffror) — särskilt §9 punkt 1 (bekräfta att flödningen faktiskt upphör för just de distanser som flödades i verkligheten) och §9 punkt 5 (dateOfBirth/sex-regressionen, störst blast radius i denna plan).
2. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` med en sessionspost, samt `docs/api/races.md` enligt §8.
3. Flytta denna fil till `docs/planning/archive/` när allt ovan är bekräftat klart.
