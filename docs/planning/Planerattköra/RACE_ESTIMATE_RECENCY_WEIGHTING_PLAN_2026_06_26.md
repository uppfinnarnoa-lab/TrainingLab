# Race-tidsestimat: recency-medvetenhet i bracket-modellen (3K-staleness-problemet)

**Status:** Research klar, redo för implementation
**Skapad:** 2026-06-26
**Förutsätter:** [RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md](../archive/RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md) (implementerad samma dag, session 2026-06-26g) — denna plan adresserar specifikt den begränsning som dokumenterades men medvetet INTE fixades där (se den planens IMPLEMENTATION_PLAN.md-sessionspost, punkt 9).

## 0. Problemet

Efter `buildTrustedRacePBs()` (§5.9 i föregångsplanen) korrekt exkluderade en kontaminerad-men-färsk 3000m-"PB" (en mittlopps-split inne i ett 10K-lopp, bekräftat av användaren), återstår bara en **genuint ren men 5 år gammal** 3000m-post (2021-09-30, 11:09) som ankarpunkt för 3K-prediktionen. Resultatet:

| Distans | Tid | Datum | Pace |
|---|---|---|---|
| 3000m (enda rena ankaret) | 11:09 | 2021-09-30 | 3:43/km |
| 5000m (färskt) | 18:15 | 2026-04-26 | 3:39/km |

3K-pace (3:43/km) är **långsammare per km** än 5K-pace (3:39/km) — fysiologiskt bakvänt (kortare distans ska alltid ha snabbare pace, allt annat lika). `buildKnownPerformances()`/`personalizedRacePrediction()` har **ingen** uppfattning om *när* en känd prestation söktes — en exakt distansmatchning (`ratio = 1`) får nästan maximal förtroendevikt (`wLocal ≈ 0.95`) oavsett om den är från förra månaden eller för fem år sedan. Det är inte en bugg i den meningen att koden gör något fel — den gör exakt vad den är designad att göra (lita på den närmaste riktiga datapunkten) — men designen saknar en dimension (tid) som blir avgörande när den enda rena datapunkten råkar vara gammal.

## 1. Varför detta är svårare än det ser ut — ett konkret, redan upptäckt fallgrop

Den uppenbara reflexen ("använd bara den färskaste datan istället") är **inte säker rakt av**. Verifierat genom att räkna igenom den faktiska bracket-matematiken: om man naivt föredrog den NÄRMASTE FÄRSKA datapunkten istället för den exakta-men-gamla 3000m-träffen, skulle modellen hitta `Activity.bestEfforts`s "3219m" (2-mile) segment — **från samma `stravaActivityId` som det redan exkluderade 10K-loppet** ("Åmilen!", 2026-04-26). `buildTrustedRacePBs()`s stravaActivityId-gruppering filtrerar bara `RaceRecord`-rader — `Activity.bestEfforts` har **ingen motsvarande filtrering** (samma begränsning som redan var känd och medvetet avgränsad bort i 06-23-planen: "personalizedFatigueExponent behöver källa per punkt, har det inte idag"). Att naivt föredra "färskast" skulle alltså sannolikt återinföra **exakt den typ av kontaminering** §5.9 precis städade bort, bara via en annan datakälla (bestEffort istället för RaceRecord).

**Konkret bekräftat genom att räkna igenom bracket-matematiken för båda alternativen:**

| Ankare som skulle användas | Källa | Resulterande 3K-prediktion | Säker? |
|---|---|---|---|
| Befintlig (stale exakt-match) | RaceRecord 2021 | ~11:08 (dagens läge) | Ren data, men gammal |
| Naiv "färskast vinner": 1609m↔3219m bracket | 3219m är en `bestEffort` från SAMMA 10K-lopp som redan exkluderats | ~10:46 | **Osäker** — sannolikt samma mittlopps-kontaminering återinförd via bestEfforts |
| 1000m↔5000m bracket, **bara RaceRecord-källor** | Båda verifierat rena (ej delade `stravaActivityId` med en längre distans) | ~10:38 | **Säker** — varken punkt är en mittlopps-split |

Den tredje raden var den här planens första kärnrekommendation — men se §1.5: en bättre lösning hittades genom att ifrågasätta `buildTrustedRacePBs()`s binära "behåll bara längsta"-regel direkt.

## 1.5 Användarens invändning, bekräftad med riktig data: "en 3000m-del av ett 5K-lopp är mer relevant än ett 3000m-lopp från för 5 år sedan"

Korrekt påpekande, och det avslöjar att §5.9:s ursprungliga regel (behåll BARA den längsta distansen per `stravaActivityId`-grupp, exkludera allt annat) är en trubbigare regel än nödvändigt. En split från ett lopp som bara är *lite* längre (t.ex. 3K ur ett 5K-lopp, kvot 5/3 ≈ 1,67) är paceringsmässigt nästan identisk med en egen 3K-insats — Riegel-exponenten (1,04–1,10, redan etablerad i den här kodbasen) antyder bara ~3–4% paceskillnad vid en så liten kvot. En split från ett lopp som är MYCKET längre (3K ur ett 10K-lopp, kvot 10/3 ≈ 3,33, eller värre, 5K ur ett 10K-lopp exakt kvot 2,0) antyder en betydligt större, verkligt missvisande paceskillnad (~7–9%) — och verifierat konkret mot just den kontaminerade 2026-04-26-gruppen: dess 5000m-split (paceringsmässigt identiskt med vad ren 10K-fart skulle ge vid halvvägs, 3:39/km uppmätt mot 3:39,4/km Riegel-förutsagt) bär **noll** ny information om verklig 5K-förmåga.

**Reviderad regel, verifierad mot riktig data:** istället för "behåll bara gruppens längsta distans," behåll varje post i en `stravaActivityId`-grupp vars kvot till gruppens längsta är **≤ 1,8** (en gräns vald för att hålla marginal på båda sidor: 1,67 — den genuint användbara 3K-ur-5K-splitten — måste vara KVAR, 2,0 — den verifierat missvisande 5K-ur-10K-splitten — måste fortsätta vara BORTA):

```text
Grupp 2026-03-20 (5K-lopp): 3000m i 11:00, kvot till 5000m-längsta = 1,67 → BEHÅLL (ny!)
Grupp 2025-05-20 (5K-lopp): 3000m i 11:07, kvot till 5000m-längsta = 1,67 → BEHÅLL (ny!)
Grupp 2026-04-26 (10K-lopp): 3000m i 10:48, kvot till 10000m-längsta = 3,33 → fortsatt EXKLUDERAD
Grupp 2026-04-26 (10K-lopp): 5000m i 18:15, kvot till 10000m-längsta = 2,00 → fortsatt EXKLUDERAD
```

**Verifierat resultat** (kört mot riktig data, samma `buildKnownPerformances()`-pipeline, throwaway-skript raderat efter användning): med kvot-regeln blir 3000m-ankaret **11:00 från 2026-03-20** — inte 11:09 från 2021. Det är samtidigt **9 sekunder snabbare OCH ~5 år färskare** än dagens (redan skickade) regel ger, eftersom `buildKnownPerformances()`s "behåll snabbaste"-sammanslagning nu får välja mellan TRE rena 3000m-punkter (2021/11:09, 2025/11:07, 2026-03-20/11:00) istället för bara en.

**Detta är en bättre, enklare första åtgärd än §3:s recency-mekanism** — den löser samma konkreta problem genom att korrigera en regel som redan visat sig vara för trubbig, istället för att lägga till en ny, separat parallell mekanism. §3 (recency-preference) behövs fortfarande för det GENERELLA fallet (en distans där ALLA tillgängliga punkter, oavsett kvot-regel, råkar vara gamla) men är inte längre den primära fixen för just 3K-fallet.

**Kvarstående, mindre inkonsekvens efter kvot-fixen:** 3K-pace blir 3:40/km, fortfarande någon tiondel långsammare per km än 5K:s 3:39/km — och `Activity.bestEfforts`s 3219m-segment (3:36/km, från samma 10K-lopp, §1 ovan) är fortfarande snabbare än båda. Den sista, kvarvarande inkonsekvensen kommer alltså specifikt från att `bestEfforts` ännu inte har samma kvot-baserade skydd som `RaceRecord` nu skulle få — exakt det §4 nedan föreslår att bygga, nu med en konkret, kvantifierad kvarstående lucka att mäta framgång mot istället för en hypotetisk.

## 2. Etablerad praxis utanför kodbasen (kort sökning)

Daniels'/McMillan-stilkalkylatorer (samma familj av VDOT-baserade verktyg som redan ligger till grund för denna app) instruerar explicit användaren att **mata in ett resultat från de senaste 3–6 veckorna** för bästa precision — de försöker inte algoritmiskt blanda ihop resultat från olika år, de skjuter över "är detta fortfarande representativt"-bedömningen på användaren. Det bekräftar riktningen här (föredra färskt, varna för/nedprioritera gammalt) som vedertagen praxis i fältet — inte en ny uppfinning. Ingen djupare extern litteratur behövs för det här problemet; det är primärt en data-design-fråga inom den egna kodbasen, inte en fysiologisk modelleringsfråga.

## 3. Föreslagen lösning: tre kompletterande mekanismer, prioriterade efter §1.5:s fynd

### 3.0 [Huvudåtgärd, högst prioritet] Kvot-baserad revision av `buildTrustedRacePBs()` (§1.5)

Ändra "behåll bara gruppens längsta distans per `stravaActivityId`" till "behåll varje post vars kvot till gruppens längsta är ≤ 1,8." Detta är en revision av redan skickad kod (§5.9 i föregångsplanen), inte ett helt nytt system — minsta möjliga ändring som löser det konkreta, verifierade 3K-fallet (§1.5) direkt, utan att behöva röra `personalizedRacePrediction()`, `KnownPerformance`s typ, eller införa något nytt `date`/`verifiedClean`-koncept alls. Implementeras och valideras FÖRST, oberoende av §3.1/§3.2 nedan.

### 3.1 [Kompletterande, för det generella fallet] `personalizedRacePrediction()` försöker en färsk-bara-pool först

1. Utöka `KnownPerformance` med `date?: Date` och `verifiedClean?: boolean` (sant för `RaceRecord`-källor post-`buildTrustedRacePBs()`; **falskt/odefinierat för `Activity.bestEfforts`** tills §4 nedan är byggt — det är den explicita spärren mot att återintroducera §5.9:s redan fixade problem).
2. Nytt valfritt argument till `personalizedRacePrediction()`: `preferFreshSince?: Date`. När satt:
   - Filtrera `knownPerformances` till `verifiedClean && date >= preferFreshSince`.
   - Försök bygga bracket/ankare **bara** ur den filtrerade poolen, med samma befintliga logik (regimgräns, ratio≥1.02, etc. — oförändrat).
   - Om det ger ett giltigt resultat (bracketed ELLER single-sided), använd det.
   - **Annars** (ingen färsk-och-ren data nära targetM), fall tillbaka till hela poolen exakt som idag — ingen regression för distanser där det redan fungerar.
3. `preferFreshSince` sätts till `now - 540 dagar` i alla anropsställen — återanvänder **samma brytpunkt** som redan finns och är validerad i `estimateVO2max()`s `pbAgeFactor` (540 dagar = helt avklingad till 35% tillit i den blandade VDOT:en) snarare än att uppfinna en ny godtycklig konstant.

**Konkret effekt på 3K-fallet:** med `preferFreshSince` satt, och bara `RaceRecord`-källor markerade `verifiedClean`, blir den färska poolen för 3K-bracket: 400m, 1000m, 5000m, 10000m (alla `RaceRecord`, alla inom 540 dagar utom 400m som är precis på gränsen — se §5 för en kantfallskontroll). Bracket 1000m↔5000m (ratio=5.0, tillåtet — ingen övre ratio-spärr finns redan idag, och det är konsekvent med hur modellen redan hanterar glesa fall vid andra distanser) ger **~10:38**, snabbare än både dagens 11:08 OCH den osäkra bestEffort-baserade 10:46 — och utan att röra någon kontaminerad data.

### 3.2 Komplement — låt lågkonfidens-nivåerna (§5.4/§5.10 i föregångsplanen) konkurrera med en STALE betrodd punkt, inte bara fylla tomma luckor

Idag exkluderar `buildKnownPerformances()`s `tooCloseToTrusted()`-regel (1,5× avståndsgräns) en lägre-nivå-kandidat även om den betrodda punkten den ligger nära är gammal. Om den betrodda punkten är äldre än `preferFreshSince`, ska den INTE längre blockera en närliggande lägre-nivå-kandidat — en uppskattad-men-färsk signal är sannolikt mer relevant än en exakt-men-gammal. Litet, billigt tillägg ovanpå samma infrastruktur (kräver bara att även betrodda punkter bär `date`, vilket §3.1 redan kräver).

### 3.3 Vad som INTE byggs i den här omgången, och varför

- **Recency-filtrering för `Activity.bestEfforts`** (dvs. att låta bestEfforts-källor också bli `verifiedClean: true` under rätt villkor) — se §4, en separat, uttryckligen avgränsad delplan. Den här planens §3.1 fungerar oberoende av om §4 byggs eller inte; §4 gör mekanismen mer kraftfull men är inte en förutsättning.
- **En kontinuerlig recency-konfidensblandning** (t.ex. vikta `wLocal` proportionellt mot en exponentiell åldersfaktor istället för en binär färsk/gammal-spärr) övervägdes men avstyrks för denna omgång: den diskreta "försök färskt först, annars allt"-regeln är enklare att resonera om, enklare att validera mot riktig data, och stämmer med hur resten av bracket-modellens trösklar redan är utformade (diskreta ratio-gränser, inte kontinuerliga vikter). En kontinuerlig variant kan övervägas senare om den diskreta regeln visar sig för trubbig i fler verkliga fall.

## 4. Separat delplan (lägre prioritet, men nu med ett konkret mål att mäta mot): generalisera split-detektion till `Activity.bestEfforts`

Efter §3.0 (kvot-fixen) är den kvarstående inkonsekvensen exakt kvantifierad (§1.5, sista stycket): 3K landar på 3:40/km, 5K på 3:39/km, och `bestEfforts`s 3219m-segment (3:36/km, samma 10K-lopp) är fortfarande snabbast av alla — vilket bara kan bero på att just det segmentet inte fångas av kvot-regeln eftersom den bara appliceras på `RaceRecord`. Det här kapitlet är alltså inte längre en hypotetisk "tänk om bestEfforts också behöver det" — det är den enda återstående pusselbiten för att helt eliminera 3K/5K-inkonsekvensen.

`buildTrustedRacePBs()` kan upptäcka mittlopps-splits för `RaceRecord` eftersom flera RADER delar samma `stravaActivityId`. Ett enskilt `bestEffort`-segment har ingen sådan tvilling att jämföra med — men det BÄR information om sin egen källaktivitets totala distans, om man slutar kasta bort den kontexten innan den når `buildKnownPerformances()` (idag plattas `bestEfforts` ut till `{distance, elapsed_time}` per aktivitet, utan total-distans-kontext).

**Samma kvot-princip som §3.0, applicerad per aktivitet istället för per `stravaActivityId`-grupp:** ett `bestEffort`-segment är bara trovärdigt som "max-insats vid den distansen" om aktivitetens EGEN totala distans inte är mer än ~1,8× segmentets distans (samma tröskel som §3.0, av samma skäl — ingen anledning att ha två olika gissade konstanter för samma underliggande fysiologiska resonemang). "Åmilen!"s 3219m-segment (10,1km aktivitet, kvot ≈3,14) skulle exkluderas; ett 1000m-segment ur ett 1200m-pass (kvot 1,2) skulle behållas.

**Förslag:** ett `bestEffort`-segment markeras `verifiedClean: true` bara om dess distans är minst, säg, 85–90% av källaktivitetens egen totala registrerade distans (dvs. aktiviteten VAR i praktiken ett tidsförsök ungefär vid den distansen, inte ett snabbt delsegment inuti ett mycket längre lopp). Det 3219m-segmentet från "Åmilen!" (en 10,1km-aktivitet) skulle med en 85%-tröskel ge 3219/10100 ≈ 32% — **exkluderad**, exakt det önskade utfallet.

**Varför detta är en EGEN, lägre prioriterad delplan och inte bara en rad i §3:**
- Det rör den redan validerade, kärn-betrodda "bestEfforts ≤10K"-regeln som har stått oförändrad och bevisat fungerande sedan 06-23/06-24-omgångarna — en bredare ändring där kräver egen, noggrann leave-one-out-validering (samma metod som redan etablerats i tidigare plan-iterationer) innan den rör vid något som redan fungerar bra för 800m–10K.
- En för aggressiv tröskel (t.ex. 95%) kan oavsiktligt exkludera legitima bestEfforts från korta, dedikerade pass (t.ex. ett 1000m-tempopass där aktivitetens totala distans är 1200m inklusive in/utjogg skulle ge 1000/1200≈83%, nära gränsen) — tröskelvärdet måste kalibreras mot riktig data, inte bara antas.
- Den här planens §3.1 löser det **akuta, konkreta** 3K-problemet helt på egen hand utan att behöva röra bestEfforts-regeln alls.

## 5. Kantfall att testa explicit (innan implementation anses klar)

1. **En distans där den enda kända prestationen är gammal OCH ingen färsk RaceRecord-bracket går att bilda** (t.ex. om alla andra RaceRecord-punkter också råkar vara gamla) — måste falla tillbaka till dagens beteende (hela poolen, inklusive den gamla punkten), inte ge `null`/krascha.
2. **400m-PB:t ligger precis vid 540-dagarsgränsen** (skapad 2024-06-01, ~755 dagar gammal vid denna sessionens datum — alltså redan UTANFÖR `preferFreshSince` med 540-dagarsgränsen!). Verifiera att detta inte oavsiktligt exkluderar den enda kort-distans-ankarpunkten för 800m/1500m-prediktioner — om 400m-punkten är den ENDA nära ankaren för en kort distans och ingen annan färsk punkt finns där, måste fallback-till-hela-poolen-regeln (§3.1 punkt 2, "annars") träda in och återanvända den, exakt som idag.
3. **En distans med EXAKT en känd prestation totalt, och den är gammal** (samma robusthetskrav som tidigare plan-iterationer redan ställt) — bekräfta att §3.1 degraderar snyggt till dagens (oförändrade) beteende, inte producerar `NaN` eller ett orimligt tal.
4. Kör om hela leave-one-out-diagnostiken (samma mönster som etablerats i tidigare omgångar — bygg, kör, radera ett engångsskript) och bekräfta: 3K-pace blir snabbare än 5K-pace igen (monotont avtagande pace med ökande distans, hela vägen 800m→Marathon), utan att någon annan distans försämras.

## 6. Kritisk granskning

### 6.1 Är 540 dagar rätt tröskel?

Återanvänds direkt från `pbAgeFactor` av konsekvensskäl, men den konstanten designades ursprungligen för en ANNAN sak (hur mycket en gammal PB ska väga ner i den blandade populations-VDOT:en, en kontinuerlig avklingning) — inte för en binär "är denna data fortfarande relevant för bracket-modellen"-gräns. Det är en rimlig återanvändning, inte ett bevisat optimalt val. Om §5 punkt 2 visar att 540 dagar olyckligt utesluter en viktig kort-distans-ankarpunkt (400m-fallet), är nästa steg att antingen höja gränsen något (t.ex. 730 dagar) eller acceptera att fallback-regeln redan hanterar det korrekt (vilket den ska göra per design) — inte att panik-justera konstanten utan att först bekräfta om fallbacken verkligen triggas och ger rätt svar.

### 6.2 Risk: en bred 1000m↔5000m-bracket (ratio 5,0) är inte en "lokal" exponent i någon meningsfull mening

Detta är redan ett accepterat, befintligt beteende i modellen för andra glesa distanser (t.ex. 15K extrapolerar redan brett när inget närmare finns) — den här planen inför inget NYTT risktagande av den typen, den bara LÅTER 3K-prediktionen falla in i samma redan-existerande, redan-accepterade extrapoleringsbeteende istället för att förlita sig på en stale exakt-match. Om en framtida omgång vill täta detta (t.ex. en mjuk övre ratio-spärr som gör att breda brackets viktas ner mer aggressivt mot den globala Daniels-kurvan), är det en separat, generell förbättring — inte specifik för recency-problemet här.

### 6.3 Risk: `verifiedClean` blir ett tredje, lätt-att-glömma-uppdatera fält

Om en framtida ändring lägger till en FJÄRDE datakälla till `buildKnownPerformances()` (utöver racePBs/bestEfforts/lowerTier) måste den nya källans `verifiedClean`-status sättas medvetet, inte av misstag ärva `true`. Rekommendation vid implementation: gör `verifiedClean` ett **obligatoriskt** fält på `KnownPerformance` (inte valfritt med en defaultkänd risk) så TypeScript tvingar varje ny källa att ta explicit ställning, istället för att en framtida bugg tyst smyger igenom en okontrollerad källa som "ren" via ett valfritt fälts implicita `undefined→falsy`-beteende.

### 6.4 Detta är fortfarande personalisering för EN användare

Samma avgränsning som alla tidigare omgångar i denna plan-serie: validera mot den här atletens riktiga data (§5), inte mot ett syntetiskt facit. Om en framtida andra användare har en annan datakaraktär (t.ex. fler färska men glesare PB:n), måste samma kantfallstestning (§5) köras om för dem innan man litar på att tröskelvärdena fortfarande är rätt.

## 7. Slutinstruktion till implementerande agent

1. **Implementera §3.0 (kvot-fixen i `buildTrustedRacePBs()`) först.** Minsta möjliga ändring, löser det konkreta 3K-fallet direkt (verifierat: 11:09→11:00, 2021→2026-03-20), rör ingen ny typ eller någon annan funktion. Validera omedelbart: kör leave-one-out-diagnostiken (§5.4) och bekräfta att 3K landar på 11:00 från 2026-03-20, att den kontaminerade 2026-04-26-gruppens poster fortfarande är exkluderade (ratio 2,0/3,33 > 1,8), och att ingen annan distans försämras.
2. **§3.1/§3.2 (recency-preference + lågkonfidens-konkurrens mot stale data) härnäst** — det generella fallet (en distans utan någon ratio-räddningsbar färsk punkt alls). Inte längre den akuta fixen för 3K specifikt (§3.0 löser det), men fortsatt värdefullt för framtida fall av samma klass. **Markera bestEffort-källor `verifiedClean: false` explicit** (inte bara "inte satt till true") så kontamineringsrisken i §1 inte kan smyga sig in via en defaultvärde-miss.
3. **§4 (bestEfforts-split-detektion via samma kvot-princip) härnäst** — efter §3.0 är den kvarstående luckan exakt kvantifierad (3K 3:40/km vs 5K 3:39/km, `bestEfforts`s 3219m-segment 3:36/km fortsatt snabbast och fortsatt okontrollerat) — det här är nu den sista pusselbiten, inte en hypotetisk efterkonstruktion. Gör den INTE i samma commit som §3.0/§3.1 utan en egen, fullständig leave-one-out-validering specifikt för 800m–10K (den regeln som redan är validerad och inte ska riskeras lättvindigt) — men prioritera den högre än innan §1.5:s fynd, eftersom den nu har ett konkret, kvantifierat mål.
4. Uppdatera `docs/fitness/race-time-predictions.md` och `docs/planning/IMPLEMENTATION_PLAN.md` när klart, flytta denna fil till `docs/planning/archive/`.
