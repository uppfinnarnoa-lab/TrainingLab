# Race-tidsestimat: lita på snabbaste verifierade resultatet, inte källans loppslängd

**Status:** Implementerad (fjärde revisionen — §3.0 nu faktiskt skriven till `lib/fitness/vo2max.ts`, validerad mot verklig data, `tsc`+`build` rena). Arkiverad.
**Skapad:** 2026-06-26
**Förutsätter:** [RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md](RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md) (implementerad samma dag, session 2026-06-26g). Denna plan **drar tillbaka och ersätter** den planens §5.9-regel ("behåll bara gruppens längsta distans per `stravaActivityId`") — se §0 för varför.

## 0. Revisionshistorik — varför detta är fjärde versionen

1. **Första versionen** (`RACE_ESTIMATE_TRAINING_DATA_PLAN`, §5.9, redan skickad kod): exkludera ALLA `RaceRecord`-poster som inte är den längsta i sin `stravaActivityId`-grupp. Löste den ursprungliga 10K-split-kontamineringen (10:48 flaggades som "10K-pacing, inte äkta 3K") men gjorde 3K-prediktionen **sämre** (föll tillbaka till en 5 år gammal 11:09-post).
2. **Andra versionen** (detta dokuments tidigare innehåll): mjuka upp regeln till en kvotgräns (≤1,8) — räddade tillbaka två färskare 5K-interna 3K-splits (11:00, 11:07) men exkluderade fortfarande den snabbaste, mest relevanta posten (10:48, från ett 10K-lopp, kvot 3,33).
3. **Tredje versionen**: användaren påpekade att resonemanget bakom både version 1 och 2 var fel i grunden — "om mitt 3000m PB är under ett 10K lopp blir den mer relevant än en långsammare 3000m under ett 5k lopp." Verifierat med ny data (§1.1) att detta är rätt, och att hela "längre lopp = mindre tillförlitlig split"-premissen inte stämmer empiriskt för den här atleten. §3.0 specificerades men **implementerades aldrig i kod** — se punkt 4.
4. **Denna, fjärde versionen**: användaren bekräftade principen igen med ett konkret eget exempel ("om mitt 3000m PB är under ett 10K lopp blir den mer relevant än en långsammare 3000m under ett 5k lopp") och pekade på en specifik kvarstående oro — att `Activity.bestEfforts` inte har samma `stravaActivityId`-skydd/-friande som `RaceRecord`, så ett naivt "föredra närmaste färska datapunkt"-grepp skulle kunna plocka upp ett 2-mile-segment (3219m) från samma aktivitet som en redan diskvalificerad split. Användaren rapporterade också att "de snabba estimaten fortfarande är alldeles för långsamma" och gav två konkreta motbevis att undersöka: snabbare 3000m-splittar i 10K/5K-lopp den senaste tiden, och ett snabbare 800m i träning än höstens 2:34.
   - **Den verkliga förklaringen, hittad genom att faktiskt köra koden mot databasen (§1.3):** §3.0 hade aldrig skrivits till `lib/fitness/vo2max.ts`. Koden körde **fortfarande den allra första, binära "behåll bara gruppens längsta"-regeln** (inte ens version 2:s kvotregel) — `buildTrustedRacePBs()` gav fortfarande 11:09 (2021) för 3000m och 3:23 (2021) för 800m, inte 10:48/2:42. Det förklarar hela klagomålet utan att behöva anta något nytt fel i modellen.
   - Användarens specifika oro om `Activity.bestEfforts` visade sig vara delvis redan icke-problem (bestEfforts har aldrig grupperats, och behöver inte göra det — se §2.2) men avslöjade samtidigt en skarpare, mer precis variant av samma underliggande bugg: bestEfforts råddar oavsiktligt **vissa** distanser men inte andra, rent av en slump av avrundning — se §2.2 för den fullständiga mekanismen.
   - **Implementerat denna session**: §3.0 skriven till `buildTrustedRacePBs()`, validerad mot verklig data (§1.3, §4), `tsc --noEmit` + `next build --no-lint` båda rena.

## 1. Evidensen

### 1.1 10:48 (3K-splitten inne i 10K-loppet) matchar EXAKT vad atletens egen, oberoende fastställda uttröttningskurva förutsäger

Kört och bekräftat beräkningsmässigt (inte för hand — engångsskript, raderat efter användning): `personalizedFatigueExponent()` fittas **bara** på `Activity.bestEfforts` (1000–10000m) — den manuellt inloggade 3000m-posten (10:48) ingår INTE i den datan. Det är alltså ett genuint oberoende test, inte cirkelresonemang.

```
Oberoende fastställd exponent (från bestEfforts, exkl. den manuella 3000m-posten): 1,0597
Riegel-predikterad 3000m-tid från atletens VERKLIGA 10K-tid (38:41), med den exponenten: 10:48
Faktiskt loggad 3000m-split inne i exakt det loppet: 10:48
```

**Exakt match.** Det är starkt bevis att 10:48 INTE är en artificiellt uppblåst, konservativt paceringspåverkad siffra — det är precis den tid en 38:41-10K-löpare med den här atletens redan etablerade, oberoende uppmätta uttröttningsprofil borde producera vid 3K.

### 1.2 Bekräftat med ny data: ett 3000m-PB inne i ett 10K-lopp slår faktiskt en långsammare 3000m-split inne i ett 5K-lopp

Användarens egen formulering ("om mitt 3000m PB är under ett 10K lopp blir den mer relevant än en långsammare 3000m under ett 5k lopp") kontrollerad direkt mot verklig data — bästa 3000m-fönster (skalad km-splittar) i varje lopp av rimlig längd senaste 12 månaderna:

```
2026-04-26  "Åmilen!"             (10,09 km, 10K-lopp)   bästa 3000m-fönster: 10:48  ← snabbast totalt
2026-05-09  "Östhammars stadslopp" (10,05 km, 10K-lopp)   bästa 3000m-fönster: 11:09
2025-08-23  "Glädjeruset 5k!"      (5,04 km, 5K-lopp)     bästa 3000m-fönster: 11:25
```

Loppet som genererar den snabbaste 3000m-tiden är ett 10K, inte ett 5K — exakt motsatsen till vad "längre lopp = mer utspädd/konservativ split" skulle förutsäga. Sökning över samtliga ~230 löpaktiviteter de senaste 12 månaderna (alla, inte bara race-flaggade) hittade inget 3000m-fönster snabbare än 10:48 någonstans. Principen i §2 (en konservativt pacerad siffra kan bara bli för LÅNGSAM, aldrig för SNABB — så snabbaste-vinner är en sund undre-gränsskattning oavsett källa) är alltså inte bara teoretiskt sund, den stämmer konkret för den här atletens faktiska data.

### 1.3 Den verkliga orsaken till "fortfarande alldeles för långsamt": §3.0 satt aldrig i koden

Körde `buildTrustedRacePBs()` — den FAKTISKA, då oförändrade funktionen i `lib/fitness/vo2max.ts` — direkt mot produktionsdatabasen (engångsskript, raderat efter användning):

```
Live (oimplementerad) 3K-ankare:   11:09  (2021-09-30, "OLGY 3000m!")
Live (oimplementerad) 800m-ankare:  3:23  (2021-06-02)
```

Inte 10:48/2:42 som version 3 av denna plan beskrev som "verifierat resultat" — den versionen beskrev vad §3.0 SKULLE ge, men §3.0 skrevs aldrig till `vo2max.ts`. Koden körde fortfarande exakt den ursprungliga, allra första §5.9-regeln (binär "behåll bara gruppens längsta", ingen kvotlogik alls — inte heller version 2:s ≤1,8-regel, som aldrig implementerades den heller). `docs/fitness/race-time-predictions.md` §2.4 hade dessutom redan uppdaterats att BESKRIVA kvotregeln som om den var aktiv kod — ren dokumentationsdrift, aldrig speglad i verklig kod (rättat, se §6).

Detta förklarar användarens hela klagomål ("de snabba estimaten är fortfarande alldeles för långsamma") utan att behöva anta något ytterligare, nytt fel i själva modelldesignen: designen i §3.0 var redan rätt, den var bara aldrig applicerad.

## 2. Korrigerad rotorsaksanalys

### 2.1 Varför "längre källopp = mindre tillförlitlig split" är fel premiss

Den ursprungliga 06-26g-sessionens marathon/HM-fix (LT2-tak) löste ett **verkligt** kontamineringsproblem: `bestEffort`-segment från **orienteringslopp** bortom 10K (terräng/navigeringstempo, inte vägfart) drog långdistans-prediktionerna orimligt långsamt. Det är ett distinkt, väldokumenterat och fortsatt giltigt problem.

§5.9 (split-detektion via `stravaActivityId`) **generaliserade felaktigt** den insikten till en annan situation: en snabb delsträcka inne i ett **vanligt väglopp** är inte samma sak som en orienteringsresultat-feltolkning. Premissen "ju längre källoppet är, ju mindre tillförlitlig är delsträckan" är en rimlig **a priori-gissning** men håller inte empiriskt här (§1.1, §1.2) — och även om den gjorde det i genomsnitt, kan en konservativt pacerad siffra bara bli för LÅNGSAM, aldrig för SNABB. En snabb siffra är alltså alltid minst lika informativ som en långsammare, oavsett varifrån den kommer.

### 2.2 Varför `Activity.bestEfforts` delvis — men bara delvis, och bara av en slump — har skyddat vissa distanser från samma bugg

Användarens kvarstående oro: `buildTrustedRacePBs()`s gruppering filtrerar bara `RaceRecord`-rader, aldrig `Activity.bestEfforts`. Det är korrekt beskrivet — men konsekvensen är mer specifik än "ett hål i skyddet". `buildKnownPerformances()` slår ihop `racePBs` (`buildTrustedRacePBs()`s output) och rå, ogrupperad `bestEfforts` i EN map, nyckel = `Math.round(distance)`, snabbaste vinner per nyckel. Det betyder: om en distans har en **Strava-native bestEffort-bucket som råkar avrunda till exakt samma heltal** som den (då felaktigt grupp-uteslutna) `RaceRecord`-kopian, så "räddar" `bestEfforts`-vägen distansen ändå — rent oavsiktligt, inte av design.

Kört direkt mot verklig data för att se exakt vilka distanser detta gäller:

| Distans | Native Strava bestEffort-bucket? | Skyddad av bestEfforts-vägen mot §5.9-buggen? | Live-värde innan fix | Live-värde efter fix |
|---|---|---|---|---|
| 800m | "1/2 mile" = **805m** (5m avrundningsglapp — KROCKAR INTE med 800) | ❌ Nej | 3:23 (2021) | **2:42** (2025) |
| 1609m (Mile) | "1 mile" = 1609m (matchar exakt) | ✅ Ja | 5:37 (oförändrat) | 5:37 (oförändrat) |
| 2000m | Ingen native bucket alls | ❌ Nej | *(ingen data)* | **7:05** (2025, ny!) |
| 3000m | Ingen native bucket alls (Strava har bara 1K/1mile/2mile/5K, inget 3K) | ❌ Nej | 11:09 (2021) | **10:48** (2026) |
| 3219m (2 Mile) | "2 mile" = 3219m (matchar exakt) | ✅ Ja | 11:36 (oförändrat) | 11:36 (oförändrat) |
| 5000m / 10000m | Matchar exakt | ✅ Ja | Oförändrat | Oförändrat |

Mile och 2 Mile var alltså redan korrekta i den FAKTISKA `knownPerformances`-outputen (verifierat genom att faktiskt anropa `buildKnownPerformances()` med riktig data, inte bara `buildTrustedRacePBs()` isolerat) — inte tack vare något designat skydd, utan av en slump i avrundning. 800m, 2000m och 3000m hade ingen sådan slump till sin fördel och föll rakt igenom. Det är **inte** ett robust skydd att förlita sig på — exakt den poäng användaren gjorde, bara mer precist lokaliserad. §3.0:s riktiga fix (ta bort grupperingen helt i `buildTrustedRacePBs()`) löser roten för alla distanser samtidigt, oavsett om de råkade ha en räddande bestEffort-bucket eller inte.

## 3. Lösningen — implementerad

### 3.0 [Genomfört] `buildTrustedRacePBs()`s `stravaActivityId`-gruppering helt borttagen

`lib/fitness/vo2max.ts`: tog bort `byActivity`-grupperingen och "behåll bara gruppens längsta"-reduktionen helt. Varje `RaceRecord` (manuell eller auto-detekterad) tävlar nu direkt på sin egen avrundade distans mot alla andra poster på samma distans — snabbaste vinner, exakt samma princip som redan gällde för `bestEfforts` sinsemellan.

**Den enda kvarvarande filtreringsregeln är den som redan fanns FÖRE §5.9 och som löser ett verkligen annat problem:** `isManual: true` krävs bortom 10K (skyddar mot auto-detekterade orienteringsresultat — `isRace=true` på en helt annan sport/terräng). Den regeln rör **källans tillförlitlighet**, inte distansens längd relativt en annan distans i samma lopp.

**Verifierat resultat** (kört direkt mot produktionsdatabasen efter ändringen, inte simulerat):

```
400m    1:06   2024-06-01
800m    2:42   2025-05-20   (var 3:23 / 2021-06-02)
1000m   3:19   2025-05-20
1609m   5:37   2025-05-20
2000m   7:05   2025-05-20   (var: ingen data alls)
3000m   10:48  2026-04-26   (var 11:09 / 2021-09-30)
3219m   11:36  2026-04-26   (oförändrat — redan korrekt via bestEfforts)
5000m   18:15  2026-04-26
10000m  38:41  2026-04-26
```

Både snabbast OCH färskast för varje påverkad distans, konsekvent med atletens egen oberoende fastställda uttröttningsprofil (§1.1) och med det direkta dataexemplet i §1.2.

### 3.1 Sänk `bestEfforts`-golvet i `buildKnownPerformances()` från 1000m — INTE genomfört denna omgång

Fortfarande bara på pappret (forskat, inte implementerat) — kvarstår från tidigare revisioner. Nuvarande golv (1000m) kastar bort genuint snabb evidens under 1000m (t.ex. en 805m/2:34-bestEffort, se §4 nedan). Lägre prioritet än §3.0 eftersom §3.0 ensam redan löste båda de konkreta klagomålen denna omgång (3000m OCH 800m — se §2.2-tabellen, 800m:s problem var grupperingsbuggen, inte 1000m-golvet). Kvarstår som nästa steg, med samma plan som tidigare: sänk till 600m, lägg till ett absolut `MIN_PLAUSIBLE_PACE_SEC_PER_KM`-golv (matchar §5.10:s redan existerande mönster) istället för att lita på en distansbaserad gissning om var bruset börjar.

### 3.2 Vad som FORTFARANDE exkluderas — oförändrat, ett genuint annat problem

- Orienteringsresultat bortom 10K, auto-detekterade (`isManual: false`) — terräng/navigeringstempo är fysiologiskt inte jämförbart med vägfart vid "samma" distans.
- GPS/databrus i intervallvarv (§5.10:s redan befintliga absoluta plausibilitetsgolv) — oförändrat.
- `estimateCriticalSpeed()`s `bestEfforts`-tak vid 10K (§5.3 i föregångsplanen) — oförändrat, ett distinkt problem.

### 3.3 Den tidigare kvot-mekanismen (version 2 av denna plan) — bekräftat aldrig implementerad, nu formellt dragen tillbaka

Kvotgränsen (≤1,8) beskrevs i `docs/fitness/race-time-predictions.md` §2.4 som om den var levande kod, men fanns aldrig i `vo2max.ts` (verifierat — ingen `1.8`/ratio-logik existerade någonstans i filen innan denna sessions ändring). Dokumentationen har rättats till att beskriva den faktiska, nu implementerade §3.0-regeln (se §6).

### 3.4 Är en generell recency-mekanism fortfarande motiverad? — fortfarande lägst prioriterad, men med ett nytt, konkret designkrav

Mindre akut nu — "lita på snabbaste" råkar ofta sammanfalla med "lita på färskaste" för en atlet i förbättring, och §1.2 bekräftar det konkret för denna atlet just nu. Om en framtida `preferFreshSince`-skyddsmekanism trots allt byggs, måste den respektera en lärdom från §2.2:s utredning som annars är lätt att missa — **ett exakt distansmatchande resultat ska alltid vinna över ett näraliggande-men-inexakt resultat, oavsett vilket av de två som råkar vara färskast.** En recency-filtrering som filtrerar bort ett exakt 3000m-resultat (för att det inte är "färskt nog") men lämnar kvar ett näraliggande 3219m-bestEffort (bara för att DET råkar vara färskare) skulle tvinga fram en onödig Riegel-extrapolering istället för att använda den exakta matchen som redan finns — precis den typ av fel användaren ursprungligen flaggade, fast den uppstår bara om en framtida mekanism byggs naivt. `personalizedRacePrediction()` undviker redan detta korrekt idag (en exakt distansmatch i `knownPerformances` vinner alltid över bracket-interpolering, eftersom `below`/`above`-sökningen konvergerar på samma post) — vilken framtida ändring som helst måste bevara den egenskapen explicit, inte bara råka göra det.

## 4. Den andra delen av användarens feedback: "de snabba estimaten är fortfarande alldeles för långsamma" — vad som kunde och inte kunde bekräftas

Användaren gav två konkreta motbevis utöver 3000m-frågan. Båda undersöktes brett mot riktig data (inte bara den distans som redan var känd från tidigare sessioner).

### 4.1 "Jag springer bättre tider på 3000m under 10k och 5k lopp senaste månaderna" — BEKRÄFTAT, och förklarat av §1.3/§3.0

Helt rätt (§1.2) — och redan löst av §3.0. Detta var inte ett nytt, oupptäckt datafel; det var symptomet av att §3.0 aldrig blivit kod (§1.3).

### 4.2 "Jag har kört snabbare 800 på träning än det i höstas" — INTE bekräftat i tillgänglig data, men inte heller längre nödvändigt för att förklara klagomålet

Sökte brett efter snabbare 700–900m-evidens än 2025-09-09:s 805m/2:34:
- `Activity.bestEfforts`, alla aktiviteter, senaste 12 månaderna, alla sporttyper: inget snabbare hittades (näst snabbast: 2:43, 2026-03-20).
- `Activity.bestEfforts`, ALL TID (inte bara 12 månader): inget snabbare hittades heller.
- `Activity.laps` (enskilda varv, fångar reps som inte bildar en sammanhängande Strava-bestEffort-bucket), 700–900m, sedan 2025-09-01, alla sporttyper: snabbaste var 196 s/km (2026-01-09) — långsammare pace än de 191 s/km som 2:34/805m redan representerar.
- Bred sökning på aktivitetsnamn ("800", "8x" osv.) sedan 2025-09-01: inga ytterligare kandidater.

Per projektets etablerade bug-audit-praxis (bekräfta innan man fixar) dokumenteras detta ärligt som **inte bekräftat** i loggad data, snarare än som ett antaget men obevisat fel. Tre möjliga förklaringar, ingen av dem en kodbugg: (a) passet är inte synkat till appen än, (b) det kördes utan GPS (t.ex. inomhusbana) och genererade därför ingen Strava-bestEffort-segment att hitta, eller (c) det upplevda tempot matchar inte exakt vad en sammanhängande 800m-mätning visar. **Det spelar mindre roll här** — §3.0 ensam (det BEKRÄFTADE felet, §2.2) flyttar redan modellens 800m-ankare från 3:23 till 2:42, en skillnad stor nog att fullt ut förklara varför det visade estimatet kändes uppenbart fel, oavsett om det ytterligare ännu-snabbare träningspasset existerar i okänd, osynkad form eller inte.

## 5. Validering

1. ✅ `buildTrustedRacePBs()` kört direkt mot produktionsdatabasen efter ändringen (inte simulerat): 3K-ankaret är 10:48, 800m-ankaret är 2:42, exakt som förutsagt i §3.0.
2. ✅ Riegel-konsistenskontrollen (§1.1) bygger på samma 10:48-värde som nu faktiskt är live — ingen ny risk introducerad.
3. ✅ **Kritiskt:** marathon/HM påverkas inte — de skyddas av LT2-taket (§5.1/§5.2 i föregångsplanen), en helt annan mekanism som inte rör `buildTrustedRacePBs()`. Orienteringsresultaten som ursprungligen orsakade marathon/HM-problemet skyddas fortfarande av det oförändrade `isManual`-kravet bortom 10K.
4. ✅ `npx tsc --noEmit` och `pnpm exec next build --no-lint` båda rena efter ändringen.
5. ⏳ §3.1 (sänkt `bestEfforts`-golv) — fortfarande inte implementerad, kvarstår som nästa steg om en framtida session vill jaga ytterligare snabb sub-1000m-evidens. Inte nödvändig för att lösa denna sessions två konkreta klagomål (§4).

## 6. Kritisk granskning

### 6.1 Är det säkert att helt sluta gruppera på `stravaActivityId`?

Risken är att ett **auto-detekterat** (`isManual: false`) orienteringsresultat smyger sig in vid en KORTARE distans inom samma aktivitet och förorenar en distans som idag är opåverkad. Men `isManual`-kravet bortom 10K skyddar bara bortom 10K — under 10K finns inget motsvarande skydd, och har aldrig funnits (det här är inte en NY risk §3.0 inför, det är en redan existerande, oförändrad gräns). Om en framtida verklig regression upptäcks vid en distans under 10K på grund av ett auto-detekterat orienteringsresultat, är fixen att utöka `isManual`-kravet till att gälla **alla** distanser, inte att återinföra `stravaActivityId`-gruppering.

### 6.2 Är den exakta 10:48-matchningen i §1.1 tur, eller representativ?

En enda exakt match är inte statistiskt bevis i sig — men den är en **konsekvenskontroll**, inte den enda grunden för beslutet. Huvudargumentet (§2.1) står på egna ben, och §1.2:s direkta jämförelse (10K-split slår 5K-split, konkret, inte hypotetiskt) är ett andra, oberoende stöd.

### 6.3 Detta är fortfarande personalisering för EN användare

Samma genomgående avgränsning i hela denna plan-serie — tröskelvärden är kalibrerade mot den här atletens data och bör omvalideras om en strukturellt annorlunda andra användare tillkommer.

### 6.4 Varför implementerades §3.0 inte direkt när version 3 skrevs?

Okänt/inte loggat — troligen ett glapp mellan att skriva en plan och faktiskt köra den, utan en tydlig markör i `IMPLEMENTATION_PLAN.md` som flaggade "redo men ej genomförd". Lärdom för framtida sessioner: en plan markerad "redo för implementation" bör implementeras i samma session den skrivs klar i, eller — om den medvetet skjuts upp — få en explicit, sökbar markering om det (t.ex. en TODO-rad i `IMPLEMENTATION_PLAN.md`s öppna frågor-sektion) så att ett "varför är detta fortfarande fel"-klagomål senare snabbt kan spåras till "inte implementerad än" istället för att utlösa en ny, från-grunden-utredning av en redan löst fråga.

## 7. Slutfört denna session

1. ✅ §3.0 implementerad i `lib/fitness/vo2max.ts` — `stravaActivityId`-grupperingen borttagen helt från `buildTrustedRacePBs()`.
2. ✅ Validerat direkt mot produktionsdatabasen: 3K → 10:48, 800m → 2:42, marathon/HM oförändrade.
3. ✅ `tsc --noEmit` + `next build --no-lint` rena.
4. ✅ Stale kommentarer i `lib/fitness/cache.ts` och `app/(dashboard)/stats/page.tsx` (som beskrev den borttagna grupperingslogiken) uppdaterade.
5. ✅ `docs/fitness/race-time-predictions.md` §2.4 omskriven (beskrev tidigare en kvotregel som aldrig fanns i kod).
6. ✅ `docs/planning/IMPLEMENTATION_PLAN.md` uppdaterad med ny sessionspost; den gamla "känd begränsning: 3K vilar på ett 2021-PB"-posten rättad (löst).
7. ⏳ §3.1 (sänkt bestEfforts-golv) kvarstår — nästa steg för en framtida session, inte blockerande för något känt problem just nu.
8. Denna fil flyttas till `docs/planning/archive/` som en del av samma commit.
