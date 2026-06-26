# Race-tidsestimat: bygg på träningsdata, inte bara tävlingsdata

**Status:** Implementerad i sin helhet 2026-06-26 (session 2026-06-26g) — se `IMPLEMENTATION_PLAN.md` för exakt vad som byggdes, vilka två buggar som hittades och fixades under implementationen (GPS-brus i intervallvarv, för tät tempo-pass-svep som bildade falska brackets), och den kvarstående, medvetet odokumenterat-olösta begränsningen (3K:s enda rena ankare är från 2021).
**Skapad:** 2026-06-26, reviderad samma dag efter ny evidens
**Förutsätter:** [RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md](../archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md) (bracket-modell), [RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md](../archive/RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md) (CS/W′-vote), [BUG_AUDIT_2026_06_25.md](../archive/BUG_AUDIT_2026_06_25.md) (isManual-filtret bortom 10K) — alla redan implementerade.

**Revisionshistorik:** Första utkastet (samma dag) spekulerade i att produktionens siffror kunde vara en stale cache, eftersom en fristående dev-DB-körning inte reproducerade "helt galet" magnitud. Användaren bekräftade sedan med en skärmdump av produktionens FAKTISKA tabell + en konkret fysiologisk invändning ("sub 2:40 marathon är typ min LT2 pace, omöjligt"). Det visade sig vara **rätt** — och gick att verifiera exakt mot redan cachad data (§2). Stale-cache-hypotesen är därmed avskriven; detta är en riktig, nu precist kvantifierad modellbrist. Hela dokumentet är omstrukturerat runt detta fynd.

## 0. Problemet (från användaren)

> "Alla ändringar vi har gjort för race estimator har inte gjort den bättre [...] som det ser ut nu så är maraton och HM orimligt långsamt [...] estimatet är bara okej där den redan har tävlingsdata, that defeats the purpose."

Uppföljning efter att jag visade en första analys:

> "Jo men riegel är för snabbt hursomhelst och anpassar inte efter atletens individuella fysiska profil. Det är mitt problem."

Och, med en skärmdump av Stats-sidans faktiska tabell:

> "Jag har liksom inte någon chans i helvetet att springa sub 2:40 det är typ min LT2 pace. Men däremot bör jag rimligen kunna gå under 10:15 ÅTMINSTONE på 3K."

Den andra och tredje precisering är nyckeln: det är inte (primärt) en riktning (för snabbt/för långsamt) — det är att **ingen del av modellen vet var atletens egen fysiologiska tröskel ligger**, och kan därför inte hindra ett punktestimat från att hamna vid eller bortom den, oavsett vilken formel (Riegel, Daniels, CS) som råkar dominera blandningen för en given distans.

## 1. Produktionens faktiska tabell (skärmdump, 2026-06-26)

| Distans | Estimate (personalized) | Riegel (your PBs) | Today (TSB −12) |
|---|---|---|---|
| 800m * | 2:37 ±0:04 | 2:37 | 2:38 |
| 1500m | 5:10 ±0:09 | 5:12 | 5:12 |
| Mile | 5:37 ±0:09 | 5:37 | 5:39 |
| 3K | 10:47 ±0:17 | 10:48 | 10:51 |
| 5K | 18:14 ±0:29 | 18:15 | 18:21 |
| 10K | 38:34 ±1:13 | 38:41 | 38:48 |
| 15K | 58:33 ±2:06 | 59:27 | 58:54 |
| Half Marathon | 1:22:37 ±4:40 | 1:25:20 | 1:23:07 |
| Marathon | **2:37:18** ±31:15 | 2:57:53 (flaggad +8 min) | 2:38:15 |

Detta är **inte** en stale cache — en oberoende körning mot dagens kod och samma underliggande data (men med `tsb=0` istället för den faktiska cachade `tsb`) gav nästan identiska tal rad för rad (800m–HM), och Marathon-skillnaden (2:43:51 vid tsb=0 vs 2:37:18 i produktion vid tsb=+12 — observera: skärmdumpens "Today (TSB −12)"-kolumnrubrik visar dagens TSB-justering, men cachens lagrade `tsb`-värde var +29,3 vid beräkningstillfället, se §3.3) förklaras helt av TSB-effekten. Båda körningarna delar samma rotfel.

## 2. Den centrala upptäckten: maraton-prediktionen kräver att atleten håller ~LT2-pace i 42 km

Ett tredje diagnosskript (`scripts/_tmp_lt2_vs_marathon_check.ts`, kört och raderat) läste `FitnessCache`s redan lagrade, oberoende fysiologiska trösklar och jämförde dem direkt mot `predictionsJson`:

```text
statZonesJson: lt1HR=152  lt2HR=162  lt1PaceSecPerKm=276 (4:36/km)  lt2PaceSecPerKm=232.6 (3:52,6/km)
              rSquared=0.99  bucketCount=12   ← statistisk brytpunktsanalys av atletens EGNA pace/HR-data
criticalSpeedMs=4.178 (pace 3:59/km)  rSquared=0.582  effortsUsed=11   ← CS-regression, samma "LT2-proxy"-syfte

Marathon: predicerad pace 3:53/km vs LT2-pace 3:52,6/km → 99,5 % av LT2-hastigheten
Half Marathon: predicerad pace 3:58/km vs LT2-pace 3:52,6/km → 97,5 % av LT2-hastigheten
```

### 2.1 Två saker att lägga märke till

**Half Marathon är faktiskt okej.** 97,5 % av en R²=0,99-skattad LT2-pace matchar nästan exakt litteraturens redan citerade 97,3 %-siffra för halvmaraton (§4 i tidigare version, field-based CS-review). HM är inte huvudproblemet — användaren klagade inte på HM-siffran specifikt, och datan visar att den inte borde vara det.

**Marathon är inte okej.** 99,5 % av LT2-pace i 42 km är fysiologiskt orealistiskt för **alla** löpare, inklusive elit (litteraturens övre gräns är ~95 % av CS/LT2 för elitmaratonlöpare, ~84,8 % för genomsnittet — se §4). Det matchar användarens fysiologiska invändning nästan exakt: 232,6 s/km × 42,195 km = 2:43:30 — i samma härad som det faktiska punktestimatet (2:37:18–2:43:51 beroende på TSB). Modellen predikterar bokstavligen "håll din tröskelfart i nästan tre timmar", vilket ingen människa klarar.

**Detta håller även vid `tsb=0`** (kontrollerat direkt): 3:56/km, 98,6 % av LT2 — fortfarande orealistiskt, bara något mindre extremt. TSB-skillnaden (§3.3) förstärker felet, men är inte grundorsaken.

### 2.2 Roten: två oberoende, OENIGA LT2-skattningar finns redan i kodbasen — modellen lyssnar på den sämre

| Metod | Källa | Pace | R²/tillförlitlighet |
|---|---|---|---|
| Statistisk brytpunktsanalys (`estimateZonesFromActivities`, `zones.ts`) | Atletens egna pace/HR-brytpunkter över träningsdata | **3:52,6/km** | **R²=0,99** |
| Critical Speed-regression (`estimateCriticalSpeed`, `critical-speed.ts`) | Linjärregression över bestEfforts/PB:n ≤15K | 3:59/km | R²=0,582 |

7 sekunder/km i skillnad mellan två metoder som mäter ungefär samma fysiologiska gräns är stort (~3 %). CS-modellens lägre R² är **exakt förväntat** givet §3.2 i föregående version av denna plan (kvarstår, se §3.2 nedan): dess bestEffort-pool kontamineras av submaximala "LT!"-tröskelpass i 10–15K-intervallet, vilket drar regressionen mot en långsammare, mindre tillförlitlig linje.

`blendedRacePrediction()` (`vo2max.ts:463-544`) använder idag **bara** CS-modellen (`criticalSpeedVote`, `vo2max.ts:415-428`) som fysiologisk korsreferens för HM/Marathon — och bara för att bredda osäkerhetsintervallet vid maraton, aldrig för att sätta ett golv för punktestimatet (se §3.4, kvarstår). Den **betydligt mer tillförlitliga** `statZonesJson.lt2PaceSecPerKm` (R²=0,99, beräknad av en helt annan metod från träningsdata, inte tävlingsdata) används **aldrig alls** i race-prediktionen — bara för HR-zoner och pace-zoner (`buildPaceZonesFromLT`, `zones.ts:890-902`, som faktiskt redan existerar och redan anchorar `paces.threshold` till exakt dessa LT1/LT2-värden, men den funktionen matar bara träningspace-zonerna, inte `computeRacePredictions`).

### 2.3 Samma typ av fel åt andra hållet: 3K-"PB:et" är inte en egen maxinsats — det är en mittlopps-split

Användaren påpekade direkt: "10:48 är också från ett 10k lopp." Verifierat **definitivt** mot databasen (fjärde diagnosskriptet, `scripts/_tmp_split_contamination_check.ts`, kört och raderat) — grupperade alla manuella `RaceRecord`-poster efter `stravaActivityId`, inte bara datum:

```text
2026-04-26 — stravaActivityId=18265972334 (SAMMA aktivitet för alla tre rader):
  3000m   10:48   pace 3:36/km
  5000m   18:15   pace 3:39/km
  10000m  38:41   pace 3:52/km

2025-05-20 — stravaActivityId=14541543513 (SAMMA aktivitet för alla fem rader):
  1000m   3:19    pace 3:19/km
  1609m   5:37    pace 3:29/km
  2000m   7:05    pace 3:32/km
  3000m   11:07   pace 3:42/km
  5000m   18:34   pace 3:43/km
```

**Varenda "3000m PB" i hela datasetet** (10:48, 11:07, 11:09, 11:00 — samtliga fyra manuella poster) delar `stravaActivityId` med en längre distans från samma löptillfälle. Det finns **ingen** fristående, maximal 3000m-insats i datan — bara kumulativa mellantider plockade ur 5K- eller 10K-lopp. Pace-mönstret bekräftar det: i 2026-04-26-gruppen ÖKAR farten per km stadigt från 3:36/km (3K-märket) till 3:52/km (full 10K) — exakt det man förväntar sig av en löpare som disponerar sig för 10K, inte av någon som sprintar ett fristående 3K all-out. Samma logik som §2 (LT2-blindhet) gäller här i en annan form: modellen behandlar en **disponerad delsträcka** som om den var en **maximal insats vid just den distansen** — och `buildKnownPerformances()` har inget sätt att se skillnaden, eftersom den bara känner till `{distanceM, timeSec}`, inte vilken `stravaActivityId` (eller längre slutdistans) tiden kom ifrån.

Detta förklarar punkt 3 i §0:s ursprungliga klagomål ("estimatet är bara okej där den redan har tävlingsdata") på ett djupare plan än §3.1 (det smala fönstret) redan gjorde: även **inom** det smala, "betrodda" 1000–10000m-fönstret är flera av ankarpunkterna i sig systematiskt för konservativa, eftersom de reflekterar pacing för en LÄNGRE distans, inte en maximal insats vid den distans de registrerats som.

### 2.4 Bekräftat oberoende: träningspass visar att en snabbare insats är fysiologiskt rimlig

Användaren pekade specifikt på "400ingar" och "5x4min"-pass som bevis. Ett femte diagnosskript (`scripts/_tmp_interval_laps_check.ts`, kört och raderat) läste `Activity.laps` (inte `bestEfforts` — en annan datakälla, redan synkad från Strava men aldrig använd för race-prediktion) för aktiviteter med intervallartade namn, och tittade på de SNABBASTE enskilda varven (arbetsintervallerna), inte aktivitetens utspädda helhetssnitt:

```text
"400ingar!" (2025-12-04): 400m-varv i 1:18–1:20 (pace 3:15–3:20/km) vid HR 125–147 (68–80 % av maxHR 183)
"5x4!" (2026-03-10): 1000m-varv (≈4 min) i 3:29 (pace 3:29/km) vid HR 150 (82 % av maxHR)
"5x4!" (2026-04-07): 1000m-varv i 3:37 (pace 3:37/km) vid HR 167,6 (91,6 % av maxHR — nära max)
```

Två saker att notera: (a) 400m-varven hölls i 3:15–3:20/km-fart **utan att pulsen var nära max** (68–80 %) — det är inte ens en maximal insats, vilket betyder atleten har ytterligare marginal däröver; (b) 4-minutersintervallerna ("5x4") hölls i 3:29–3:37/km vid pulser från måttliga till nära-max. Daniels' etablerade I-pace-koncept (intervalltempo för VO2max-utveckling) motsvarar ungefär nuvarande 3K–5K-tävlingsfart — så ett 4-minutersvarv i 3:29/km, även vid bara 82 % av maxHR, är minst lika informativt om sann 3K-kapacitet som den kontaminerade 10:48-splitten (§2.3), och pekar åt samma håll som användarens självskattning: snabbare än 10:48/10:47 är fysiologiskt rimligt. Det räcker inte för att exakt bekräfta "10:15" som en skarp siffra (data ger en rimlig undre gräns runt 9:45–10:30 beroende på hur man konverterar varv-fart till uthållig 3K-fart, inte ett exakt facit) — men det bekräftar tydligt RIKTNINGEN i användarens klagomål, med en helt annan, oberoende datakälla än §2.3.

**Denna data används idag ingenstans.** `isQualitySession()`/`looksLikeIntervals()` (`vo2max.ts:585-588, 631-636`) exkluderar medvetet hela intervallpass från helhetspace-analys (rätt beslut — ett aktivitetssnitt som blandar arbete och vila är missvisande) — men ingenstans i kodbasen plockas de SNABBA enskilda varven ut som ersättning. Resultatet: exakt den typ av bevis användaren pekade på finns redan synkad (`Activity.laps`), men kastas bort i sin helhet istället för att brytas ner till sina användbara delar.

**Det är detta som är "anpassar inte efter atletens individuella fysiska profil."** LT1/LT2, statistiskt skattade med R²=0,99 ur atletens egen träningsdata (helt oberoende av tävlingsresultat), ÄR den individuella fysiologiska profilen användaren efterfrågar — den finns redan, den är högkvalitativ, och den används bara inte där den behövs mest.

## 3. Övriga rotorsaker (kvarstår från första utkastet, nu sekundära stödfynd)

Dessa förklarar **varför** modellen kunde missa LT2-gränsen helt, och är fortfarande värda att fixa — men §2 är huvudfyndet.

### 3.1 Ett konstgjort smalt förtroende-fönster (1000–10000m)

`buildKnownPerformances()` (`vo2max.ts:327-343`) litar bara på "riktiga prestationer" inom exakt 1000–10000m. Allt under 1000m (t.ex. ett 400m-PB med implicit VDOT 75,4 — den klart starkaste signalen om atletens anaeroba hastighetsreserv) och allt över 10000m hanteras av en befolkningskurva eller en extrapolerad exponent, aldrig av riktig egen data. Detta förklarar delvis varför korta distanser (≤3K) bara reflekterar exakt vad som redan finns som PB där (3K-prediktionen 10:47–10:48 matchar PB:t 10:48 nästan exakt) — men §2.3/§2.4 visar att den djupare orsaken är att själva PB:et i sig är en kontaminerad mittlopps-split, inte bara att fönstret är smalt.

### 3.2 CS-modellens 10–15K-data är kontaminerad av submaximala tröskelpass

Verifierat konkret (andra diagnosskriptet i förra utkastet): de snabbaste tillgängliga `bestEffort`-segmenten i 10–15K-fönstret kommer uteslutande från pass som heter **"LT!"** — medvetet submaximala lactate-threshold-pass (HR ~85–90 %), inte maxinsatser. `estimateCriticalSpeed()` (`critical-speed.ts:29`, `CS_MAX_DIST=15000`) saknar den filtrering `buildKnownPerformances`/`personalizedFatigueExponent` redan har (cap vid 10K) — exakt samma kontamineringsklass som redan fixades för `RaceRecord` i BUG_AUDIT_2026_06_25, en nivå djupare. Detta förklarar direkt varför CS-modellens R² (0,582) är sämre än den statistiska zonskattningens (0,99), och varför CS-pace (3:59/km) är **långsammare** än den sannolikt mer korrekta LT2-pace (3:52,6/km) — kontaminering drar alltid mot en långsammare, inte snabbare, regressionslinje.

### 3.3 TSB räknas in två gånger i samma riktning

Cachad `tsb=+29,3` vid beräkningstillfället (ovanligt högt — atleten var påtagligt formtoppad/vilad). Detta värde:

1. Bidrar till `model7Vdot = tsbAdjustedVdot(model1Vdot, tsb)` (`vo2max.ts:686-690`), som med vikt ~0,25 lyfter den **blandade VDOT:en som "peak" baseras på** — redan en uppåtjustering.
2. Appliceras SEDAN igen, separat, via `tsbAdjustedRaceTime(peak, tsb)` (`vo2max.ts:63-66`) för "Today"-kolumnen — ytterligare en uppåtjustering på samma underliggande TSB-signal.

Effekten är liten i sig (~1,5 % för "Today" utöver vad som redan satt i "peak"), men vid extrema TSB-värden (som +29,3) förstärker den exakt i samma riktning som §2:s huvudfel, och bör inte vara svår att fixa: antingen låt `model7Vdot`s bidrag till "peak" vara den ENDA TSB-justeringen, och låt "Today"-kolumnen visa samma tal som "peak" (förenkling), eller dokumentera explicit att "peak" är TSB-NEUTRAL (kräver att model7Vdot tas bort ur den vägda blandningen och TSB bara påverkar "Today"). Det andra alternativet är troligen mer korrekt — "peak" ska vara atletens **baslinje**-form, "Today" ska vara dagens form ovanpå den baslinjen, inte två oberoende TSB-justeringar staplade på varandra.

### 3.4 Långpass/decoupling påverkar bara osäkerhet, aldrig punktestimatet (oförändrat fynd, nu direkt kopplat till §5.2:s fix)

`longRunAdequacyWidenFactor` (`vo2max.ts:437-444`) breddar bara `rangeLo`/`rangeHi`. Det är precis den mekanism som behöver bli en **punktestimat-korrigering** för att §5.2 ska fungera (en personlig uthållighets-fraktion av LT2, inte en litteraturkonstant).

### 3.5 "Borde gå under 10:15 på 3K" — uppdaterad efter §2.3/§2.4: delvis bekräftat, men inte ett exakt facit

Första försöket sökte bara efter ett kontinuerligt bestEffort-segment nära 3000m snabbare än 10:48 i de senaste 90 dagarna — **inget hittades**, vilket var rätt sökt men fel datakälla. §2.3/§2.4 (nya fynd, samma session) visar varför det sökandet aldrig kunde ge ett positivt svar: (a) 10:48 självt är en kontaminerad 10K-pacing-split, inte ett äkta 3K-tak att jämföra mot, och (b) den relevanta evidensen ligger i `Activity.laps` för intervallpass, en helt annan datakälla än `bestEfforts`, som första sökningen inte tittade i.

Med rätt datakälla (§2.4): 400m-varv i 3:15–3:20/km vid bara 68–80 % av maxHR, och 4-minutersvarv ("5x4") i 3:29–3:37/km vid 82–92 % av maxHR. Detta **stödjer riktningen** i påståendet tydligt — atleten håller kortare arbetsintervaller snabbare än 10:48/3K-farten (3:36/km) antyder, ofta utan att vara nära maximal ansträngning. Det bekräftar INTE en skarp "10:15"-siffra exakt (varv-till-kontinuerlig-3K-konvertering är inherent approximativ — Daniels' I-pace är en tumregel, inte en exakt ekvation), men det finns inte längre någon anledning att skriva detta som "obekräftat": det är bekräftat i RIKTNING och ungefärlig STORLEKSORDNING (data pekar mot ~9:45–10:30 som en rimlig sann 3K-kapacitet, ett intervall som innesluter användarens "åtminstone under 10:15").

## 4. Litteraturgenomgång (oförändrad, plus en ny notering om CS↔LT2-substitution)

| Källa | Relevans |
|---|---|
| [Field-based critical speed testing: a systematic review (2024/2025, PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11933073/) | HM ≈ 97,3 % av CS; maraton elit ~95 %, genomsnitt ~84,8 %. **Ny tillämpning denna omgång:** dessa fraktioner antar att "CS" är en korrekt skattad LT2-proxy. För den här atleten är `statZonesJson`s LT2-pace (R²=0,99) en bättre skattning av samma underliggande storhet än `estimateCriticalSpeed()`s CS-pace (R²=0,582, kontaminerad — §3.2) — fraktionerna ska alltså tillämpas mot LT2-pace, inte blint mot CS-pace, när båda finns och deras R² skiljer sig så mycket.|
| [Garmin Race Predictor: Why the Marathon Estimate Is Often Wrong](https://the5krunner.com/garmin-features/performance/race-predictor/) | Rent VO2max-baserade modeller missar maraton-specifikt eftersom de "inte kan fånga glykogenhantering, pacing-disciplin och neuromuskulär trötthet" — exakt vad ett LT2-tak adresserar: det är inte en perfekt energimodell, men det sätter en hård, fysiologiskt grundad bromskloss där en ren VO2max/Daniels-kurva annars tillåter ett orealistiskt punktestimat. |
| [Problems with the Critical Speed Model — Running Writings](https://runningwritings.com/2024/01/problems-with-critical-speed-and-power-laws.html) | CS-modellen antar FELAKTIGT "oändlig uthållighet" strax under CS för långa distanser — bekräftar att även en perfekt, okontaminerad CS/LT2-skattning inte ska användas naivt som "håll den farten hela vägen", utan tillsammans med en uthållighets-fraktion (§5.2) som minskar med distans. |
| Vickers & Vertosick (2016, BMC) — redan citerad | Långpasshistorik/volym predikterar maraton-specifik uttröttning oberoende av kortdistans-exponent — den naturliga källan till en PERSONLIG uthållighets-fraktion (§5.2) snarare än en litteraturkonstant. |
| Daniels VDOT-kalkylatorer accepterar time trials/tempopass som indata — redan citerad | Stödjer §5.4 (tempopass som ankarpunkter), oförändrat. |

(Övriga källor från första researchpasset — Peronnet-Thibault, minimal-power-modellen, Riegel-exponent-spridning per löpartyp — kvarstår relevanta för §5.6/§7.2 nedan, se tidigare researchanteckningar i denna fil-historik; inte upprepade här för att hålla fokus på det nya huvudfyndet.)

## 5. Föreslagen modell

### 5.1 [Huvudåtgärd] Förankra HM/Marathon-punktestimatet i atletens egen LT2-pace — inte bara intervallet

Detta är den direkta, konkreta fixen för §2 och svarar direkt på "anpassar inte efter atletens individuella fysiska profil":

1. När `FitnessCache.statZonesJson` (eller motsvarande live-beräknade `estimateZonesFromActivities`-resultat) finns och har `rSquared` över en tillförlitlighetströskel (förslag: ≥0,7 — väl under detta fynds 0,99 men över CS-modellens 0,582), använd dess `lt2PaceSecPerKm` som den PRIMÄRA fysiologiska referensen för Half Marathon och Marathon — inte `criticalSpeedVote`s CS-pace, som idag är den enda korsreferensen.
2. Definiera `targetPace = lt2PaceSecPerKm / sustainFraction(targetM)`, där `sustainFraction` är litteraturens redan citerade, distansberoende andel (HM ≈ 0,973; Marathon ≈ 0,848–0,95 beroende på personlig uthållighetsbevis, se §5.2).
3. Detta `targetPace`-härledda tidsestimat blir en **fjärde röst** i `blendedRacePrediction()`, med hög vikt specifikt för Marathon (där dagens modell helt saknar ett tak) och måttlig vikt för HM (där dagens CS-vote redan gör ungefär rätt, §2.1) — och **agerar dessutom som ett hårt golv**: om den blandade prediktionen skulle hamna SNABBARE än `targetPace` (dvs atleten skulle behöva överskrida sin egen uppmätta LT2-hastighet), klipp den till `targetPace` innan resultatet returneras. Detta är skillnaden mot dagens `longRunAdequacyWidenFactor`, som bara breddar — här sätts en explicit, fysiologiskt motiverad **övre hastighetsgräns** på punktestimatet, inte bara på osäkerheten.
4. Fallback när `statZonesJson` saknas/låg R²: använd `criticalSpeedVote`s CS-pace som idag, men ändå med samma "hårda golv"-logik (bättre att golva mot en medioker CS-skattning än mot ingen alls).

### 5.2 Personlig uthållighets-fraktion istället för en fast litteraturkonstant

Litteraturens 84,8–95 %-spridning för maraton (§4) är bred eftersom den blandar väldigt olika atletprofiler. Atletens EGEN bevisbörda finns redan delvis beräknad:

- `decouplingLt1HR`/decoupling-drift (`decoupling.ts`) — lägre drift vid långa pass → bättre aerob uthållighet → högre `sustainFraction` (närmare elitens 0,95) är motiverat.
- `longestRunLast8wM` / `avgWeeklyRunKm` (redan beräknade, idag bara range-breddande) — god täckning av måldistansen → högre `sustainFraction`.

Konkret: `sustainFraction(targetM) = baseFraction(targetM) + adjustment`, där `baseFraction` är litteraturens genomsnittsvärde (0,848 för marathon, 0,973 för HM) och `adjustment` är en liten (cap ±0,04, dvs max ~4 procentenheter) positiv eller negativ justering baserad på decoupling-drift och långpasstäckning relativt måldistansen — analogt med hur `longRunAdequacyWidenFactor` redan är skalad, men nu riktad mot punktestimatet (via `sustainFraction`) istället för bara intervallet. **Denna atletens egen profil** (kort distans stark, uthållighet vid lång distans jämförelsevis svagare — etablerat redan i 06-23-planen) pekar mot att `adjustment` initialt bör luta NEGATIVT (närmare eller under 0,848), inte mot elitens 0,95 — vilket är konsekvent med att redan 98,6–99,5 % är för optimistiskt.

### 5.3 Dela filtreringslogik mellan bracket-modellen och CS-modellen

Oförändrat från första utkastet: extrahera `buildKnownPerformances()`s filtreringsregler (racePB: `isManual` bortom 10K; bestEffort: cap vid 10K) till en delad helper som även `estimateCriticalSpeed()` anropar, så CS:s 10–15K-pool slutar vara kontaminerad av "LT!"-pass (§3.2). Detta höjer förmodligen CS-modellens R² avsevärt och gör den till en bättre FALLBACK för §5.1 punkt 4 när `statZonesJson` saknas.

### 5.4 Ny förtroendenivå: "uppskattad prestation" från tempo/threshold-pass

Oförändrat från första utkastet — koppla `vo2maxFromSubmaxEffort()` (idag död kod, `vo2max.ts:201-210`) till `predictRaceTime()` för att ge bracket-modellen riktiga ankarpunkter i 15–25K-fönstret från de 77 kvalificerande tempopassen, som lägst-prioriterad tier under riktig PB/bestEffort. Detta är nu ett **komplement** till §5.1/§5.2, inte huvudfixen — LT2-taket (§5.1) garanterar att resultatet aldrig blir fysiologiskt orimligt även om §5.4 inte byggs; §5.4 förbättrar precisionen INOM det taket.

### 5.5 Sänk golvet under 1000m, men håll regimen lokal

Oförändrat, fortsatt flaggad som mest spekulativ (se §7.2) — adresserar §3.1/3.5:s korta-distans-sida, oberoende av §5.1/5.2:s långa-distans-fix.

### 5.6 Fixa TSB-dubbelräkningen (§3.3)

Låt `tsbAdjustedVdot`s bidrag till den blandade VDOT:en (`model7Vdot` i `estimateVO2max`) vara den enda TSB-justeringen av "peak"/basformen, och gör "Today"-kolumnen till en ren visning av samma TSB-medvetna tal — eller omvänt, ta bort TSB-viktningen ur `estimateVO2max` helt och låt ENDAST `tsbAdjustedRaceTime` (den explicita "Today"-kolumnen) representera TSB. Antingen är okej; att göra BÅDA samtidigt, som idag, är inte.

### 5.7 Vad som INTE ska göras — uppdaterad efter §2:s fynd

Användaren bad explicit (Q2-svar) om en modell med "riktiga individuella fysiologiska parametrar" istället för bara en bättre kurvanpassning. **§5.1/§5.2 är svaret på det** — men det är inte en ny Peronnet-Thibault-stil energimodell (separata anaerob kapacitet/aerob-avklingnings-parametrar skattade från noll). Anledningen att inte bygga den ändå, nu mer konkret än i förra utkastets §7.3:

- De parametrar en P-T-modell skulle behöva uppskatta (anaerob kapacitet `A`, maximal aerob effekt `MAP`, avklingningskonstant `E`) finns **inte** redan beräknade någonstans i kodbasen — de skulle kräva en helt ny skattningspipeline, med per definition LÄGRE statistisk tillförlitlighet (få datapunkter, ingen etablerad R²) än `statZonesJson`s redan existerande LT1/LT2-skattning (R²=0,99, 12 buckets, byggd på en redan validerad brytpunktsmetod som körs varje sync).
- LT1/LT2 ÄR riktiga, mätbara, individuella fysiologiska gränser (inte abstrakta modellparametrar) — att förankra prediktionen i dem uppfyller andan i begäran ("individuell fysisk profil") utan att bygga en ny, mindre tillförlitlig modell ovanpå en redan tillförlitlig mätning.
- Om §5.1/§5.2 efter implementation och validering (§6) fortfarande lämnar ett omotiverat gap (t.ex. om `sustainFraction`-justeringen inte räcker för att matcha verkliga framtida maratondata den dagen atleten faktiskt springer ett) är en energimodell fortfarande på bordet som NÄSTA steg — men inte före detta enklare, billigare, högre-konfidens-fix har fått chansen.

### 5.8 UI: gör modellväljaren till en egen, vänsterställd kolumn — komposit och TSB-justerat ska alltid synas

Användarens explicita krav (bekräftat via fråga med mockup): tabellens kolumnordning blir **Distance | [Modellväljare ▾] | Estimate (personalized) | Today (TSB)** — modellväljaren flyttas till den första datakolumnen (närmast Distance, dit dagens statiska "Riegel (your PBs)"-kolumn satt), och kompositen ("Estimate (personalized)") + det formanpassade talet ("Today") **ska alltid visas oavsett vad som väljs i dropdownen**. Att byta modell i väljaren påverkar ENDAST den vänstra kolumnen — aldrig de två andra.

```text
Distance | [Model: Riegel ▾] | Estimate (personalized) | Today (TSB -12)
---------|--------------------|--------------------------|------------------
800m     | 2:37               | 2:37                     | 2:38
1500m    | 5:12               | 5:10                     | 5:12
...
```

**Konkreta implikationer för datamodellen, inte bara layouten:**

1. `predictionsJson`s nuvarande form (`{ label, meters, peak, today, riegel, rangeLo, rangeHi, lowConfidenceShort }`, dokumenterad i [docs/fitness/race-time-predictions.md](../../fitness/race-time-predictions.md) §4) har bara EN sekundär modell (`riegel`). En riktig väljare kräver att `computeRacePredictions()`/`blendedRacePrediction()` returnerar **alla** individuella röster per distans, inte bara den blandade `peak` + en enda `riegel`-siffra: minst Riegel-lokal (`personalizedRacePrediction`s rena `local.timeSec`, redan beräknad men idag bara delvis exponerad), Daniels-populationskurvan rakt av (`predictRaceTime(vdot, meters)`, idag bara en mellanberäkning inuti `blendedRacePrediction`, aldrig returnerad separat), Critical Speed/W′ (`criticalSpeedVote`s `timeSec`, idag bara en blandningskomponent), och den nya LT2-förankrade modellen (§5.1). Förslag: utöka `RacePrediction`-interfacet med ett `models: Record<string, number>`-fält (modellnamn → tidsestimat), analogt med hur `vo2maxBreakdownJson` redan exponerar `estimateVO2max()`s modell-för-modell-uppdelning.
2. Båda `FitnessCache.predictionsJson`-konsumenterna (`components/stats/fitness-metrics.tsx` och AI-coachens `get_fitness_metrics`-verktyg i `lib/ai/tools.ts`) måste hållas i synk om fältformen ändras — samma regel som redan står i `race-time-predictions.md`. AI-coachens textformatering bör nämna att "Estimate" är kompositen och låta modellväljarens val vara en UI-bara detalj (coachen behöver inte bry sig om vilken modell användaren råkar ha valt att TITTA på i tabellen — den ska alltid resonera kring kompositen).
3. Default-val i väljaren: behåll dagens "Riegel (your PBs)" som förvalt värde (minst överraskande, matchar nuvarande beteende) — listan med valbara modeller utökas i takt med att §5.1–§5.4 implementeras, den behöver inte vara komplett från dag ett.

### 5.9 Upptäck och nedvikta mittlopps-splits (§2.3) via `stravaActivityId`

`RaceRecord` har redan ett `stravaActivityId`-fält — ingen schemaändring behövs. I `loadRacePBs()` (`cache.ts:80-100`), motsvarande block i `app/(dashboard)/stats/page.tsx`, och `buildKnownPerformances()`: gruppera manuella poster per `stravaActivityId`; inom en grupp med fler än en distans är ENDAST den längsta distansen en genuin "maximal insats vid sin egen måldistans" — alla kortare är mittlopps-checkpoints. Två alternativ:

- **(a) Exkludera** de kortare same-activity-posterna helt från `buildKnownPerformances`/bracket-modellen (de kan fortsatt visas i Races-vyn som historik — det är inte fel DATA, bara fel ANVÄNDNING av den som "max vid den korta distansen").
- **(b) Behåll men nedvikta kraftigt**, som en egen lågt-prioriterad tier (parallell med §5.4:s "uppskattad prestation"-nivå) — används bara om INGEN bättre källa finns för den distansen (t.ex. §5.10 nedan).

Rekommendation: (a) som default, med fallback till (b) om det är den enda datan som finns för en distans — annars riskerar en redan gles distans (t.ex. 800m, 2000m) att tappa all data den har.

**Samma underliggande bias finns även i `Activity.bestEfforts`**, fast mildare: Stravas bestEffort-algoritm hittar den SNABBASTE kontinuerliga sträckan av en given distans inuti en aktivitet — om den aktiviteten är ett 10K-lopp, är "snabbaste 3000m" fortfarande pace disponerad för 10K (möjligen något snabbare i starten, men inte en fristående 3K-insats). Detta är inte en ny separat bugg att fixa, men värt att notera: det är samma rotfel via en annan datapath, och `buildKnownPerformances` "behåll snabbaste per distans"-princip kan aldrig fullt skilja "ett äkta kort lopp" från "en snabb delsträcka i ett längre lopp" utan källkontext (`stravaActivityId`/aktivitetens totala distans) — vilket är precis vad §5.9/§5.10 tillsammans ger den.

### 5.10 Ny ankarpunkts-källa: bryt ut snabba varv ur intervallpass

Speglar §5.4, men för den KORTA/anaeroba änden istället för den långa/aeroba: för aktiviteter som matchar `looksLikeIntervals()` (`vo2max.ts:585-588`), läs `Activity.laps` (redan synkad, idag oanvänd för race-prediktion — se §2.4) och identifiera arbetsvarv (kortare/snabbare varv, skilda från vilovarv genom samma typ av pace-baserade klustring som redan finns i `bestNkmSpeed`/CV-filtreringen på andra ställen i kodbasen). För varje kvalificerande arbetsvarv: mata in `{distanceM: lapDistance, timeSec: lapTime}` direkt i `buildKnownPerformances()` som ytterligare en lägst-prioriterad tier (samma mönster som §5.4, inget nytt rabatt-konstant att uppskatta utan grund) — låt den befintliga bracket-viktningen (som redan nedviktar allt som inte är bracketed) hantera osäkerheten i att ett varv med återhämtning inte är identiskt med en kontinuerlig tävlingsinsats, istället för att uppfinna en ny justeringsfaktor.

Detta är den direkta åtgärden för §2.4/§3.5 — ger bracket-modellen ÄKTA, frekvent uppdaterad evidens för 200m–5000m-spannet (400m-repetitioner, 1000m/4-minutersintervaller, etc.) istället för att vara beroende av de kontaminerade mittlopps-splits §5.9 just exkluderade. **§5.9 och §5.10 hör ihop** — §5.9 tar bort dålig evidens, §5.10 ersätter den med bättre, redan synkad evidens från en datakälla (`laps`) som idag inte används alls för detta syfte.

## 6. Validering

1. Återskapa diagnostiken (`scripts/_tmp_lt2_vs_marathon_check.ts`-mönstret: läs `FitnessCache.statZonesJson`/`criticalSpeedMs`/`predictionsJson` direkt, beräkna predikterad pace som % av LT2-pace per distans). Kör som baseline.
2. Efter §5.1: bekräfta att Marathon-punktestimatets implicita pace hamnar inom `sustainFraction(42195)`-intervallet (initialt ~84,8–90 % av LT2 givet denna atletens profil, §5.2), INTE 98–99 % som idag. Bekräfta att HM (redan nära rätt, §2.1) inte försämras.
3. Efter §5.3: bekräfta att `criticalSpeedRSquared` stiger (mindre kontaminerad data) och att CS-pace rör sig NÄRMARE `statZonesJson`s 3:52,6/km (om kontamineringshypotesen är korrekt, bör gapet minska).
4. Efter §5.6: bekräfta att "Today"-kolumnen vid extrem TSB (+29 eller mer) inte längre adderar en andra, oberoende boost ovanpå en redan TSB-justerad "peak".
5. Edge case: kör med `statZonesJson=null` (ny användare/för lite data) och bekräfta att §5.1 degraderar snyggt till dagens CS-vote-beteende, inte kraschar.
6. Efter §5.9: bekräfta att de fyra kontaminerade 3000m-posterna (samt motsvarande poster för andra distanser som delar `stravaActivityId` med en längre distans) inte längre räknas som ett mätt 3K-tak i `buildKnownPerformances`. Kontrollera explicit att ingen distans tappar ALL sin data om den exkluderade posten var den enda — det är precis scenariot (b)-fallbacken i §5.9 ska täcka.
7. Efter §5.10: bekräfta att minst ett par verkliga intervallpass ("400ingar", "5x4" eller motsvarande) ger nya ankarpunkter i 200–5000m-spannet, och att 3K-punktestimatet rör sig i linje med §2.4/§3.5:s ~9:45–10:30-intervall — inte exakt "10:15" (det är inte målet; målet är att modellen slutar vara helt blind för den evidensen).
8. Uppdatera båda `cache.ts`-anropsställena + `stats/page.tsx`s fallback identiskt, `pnpm build --no-lint`, uppdatera `docs/fitness/race-time-predictions.md` + `IMPLEMENTATION_PLAN.md`.

## 7. Kritisk granskning (andra passet, efter omstruktureringen)

### 7.1 Är detta verkligen samma sak som "en fysiologiskt parametriserad modell"?

Delvis en avvikelse från den litterala begäran (Q2: "ja, undersök en modell med separat anaerob kapacitet vs aerob avklingning"). Jag väljer att rekommendera §5.1/§5.2 istället för en fullständig nybyggd energimodell, av skälen i §5.7 — men detta är en **rekommendation att ompröva riktningen användaren redan godkänt**, inte en tyst övergång. Om användaren efter att läsa §5.7 fortfarande vill ha en riktig multi-parameter-energimodell (t.ex. för att den ger mer än bara ett maraton-tak — den skulle också kunna förklara/förutsäga den korta änden, §3.1/3.5, i samma ramverk istället för som en separat lapp), är det fortfarande värt att bygga — men **efter** §5.1/§5.2 är på plats och validerade, inte istället för dem. De är inte ömsesidigt uteslutande; §5.1/§5.2 är den billiga, snabba, hög-konfidens-delen av samma idé.

### 7.2 Risk: `statZonesJson` kan vara `null` eller lågt R² för andra användare/framtida tillstånd

Hela §5.1 hänger på att den statistiska zonskattningen lyckas (kräver tillräcklig pace/HR-spridning i träningsdatan — se `docs/fitness/hr-zone-statistical-estimation.md` för dess egna förutsättningar). Detta är en enanvändarapp idag, men om/när fler användare läggs till (closed invite-systemet, per CLAUDE.md) måste §5.1:s fallback (punkt 4: CS-vote, sedan ingenting) vara robust testad mot en användare med för lite data — inte bara denna atletens ovanligt rena 12-bucket/R²=0,99-fall.

### 7.3 §3.3 (TSB-dubbelräkning) är en oberoende bugg — bör inte blandas ihop med §5.1:s validering

Om båda fixas i samma omgång, se till att diagnostiken (§6) mäter dem **separat** (kör med och utan §5.6 för att isolera vilken del av förbättringen kommer från LT2-taket och vilken från att TSB slutar dubbelräknas) — annars är det omöjligt att veta i efterhand vilken fix som faktiskt gjorde skillnad om något känns fel igen.

### 7.4 Vad som höll och vad som ändrades från första utkastet

Höll: §3.1–3.2 (smalt förtroendefönster, CS-kontaminering), litteraturgenomgången, avvisandet av modellbyte (nu mer specifikt motiverat i §5.7 istället för generellt). Ändrades: huvudfokus flyttades från "additiva småfixar runt Riegel/CS" till "förankra i den redan uppmätta, högkonfidenta LT2-pace" — en skarpare, mer direkt åtgärd som existerade i kodbasen (`statZonesJson`) men aldrig korsrefererades mot race-prediktionen. Det ursprungliga "stale cache"-spåret (§1.3 i förra utkastet) är helt avskrivet — skärmdumpen bevisade att koden kördes som tänkt, problemet är reellt.

### 7.5 Risk i §5.9: exkludera inte mer data än nödvändigt

`buildKnownPerformances` är redan känslig för att bli datafattig vid sparse-data-fall (se den ursprungliga 06-23-planens robusthetskrav, §6 där). Att exkludera ALLA same-`stravaActivityId`-splits utan en fallback (§5.9 punkt b) kan göra en redan gles distans (800m, 2000m, 1500m) HELT tom om det var den enda posten. Implementerande agent måste verifiera per distans, inte bara i aggregat, att ingen rad i `RACE_DISTANCES`-tabellen går från "har data" till "ingen data alls" efter §5.9 — om den risken realiseras för en specifik distans, är (b) (nedviktad behållning) obligatorisk för just den distansen, inte valfri.

### 7.6 Risk i §5.10: varv-till-rad-konvertering har ingen etablerad, validerad formel i denna kodbas

Till skillnad från §5.2/§5.4 (som lutar sig mot redan citerad litteratur — Daniels T-pace, CS-fraktioner) har §5.10 ingen lika väletablerad "varv-pace → motsvarande tävlingstid vid samma distans"-formel att luta sig mot — rekommendationen att mata in varvet RÅTT (utan rabattfaktor) och lita på bracket-modellens befintliga viktning är en förenkling, inte en validerad fysiologisk omräkning. Om validering (§6 punkt 7) visar att detta systematiskt gör korta distanser FÖR snabba (motsatt fel mot det vi just fixade), är nästa steg att lägga till en konservativ rabatt (t.ex. samma `0.95`-faktor `vdotFromTempoRun` redan använder för tröskelpass) snarare än att dra slutsatsen att hela idén är fel — testa det justerade alternativet innan §5.10 överges.

## 8. Slutinstruktion till implementerande agent

1. Implementera §5.1 (LT2-förankring + hårt golv) FÖRST — det är den enskilda ändringen som löser det konkreta, av användaren verifierade felet (sub-2:40-maraton). Validera mot §6 punkt 2 omedelbart.
2. §5.2 (personlig uthållighets-fraktion) näst — kräver §5.1 redan på plats för att ha något att justera.
3. §5.9 (exkludera mittlopps-splits) och §5.10 (intervallvarv som ny ankarkälla) härnäst, i den ordningen — §5.9 städar bort den dåliga datan, §5.10 ersätter den med bättre, samma "tabort-före-lägg-till"-ordning som §5.1/§5.2 redan följer för långa distanser. Validera mot §6 punkt 6–7, med §7.5:s per-distans-tomhetskontroll explicit körd, inte antagen.
4. §5.3, §5.4, §5.5, §5.6, §5.8 kan göras i valfri ordning därefter, var och en validerad separat (§7.3).
5. Fråga användaren explicit om §7.1:s avvikelse (LT2-förankring istället för en fullständig energimodell) är okej INNAN du börjar koda, om det inte redan är uppenbart från konversationen att de godkänt riktningen.
6. Uppdatera `docs/fitness/race-time-predictions.md` och `docs/planning/IMPLEMENTATION_PLAN.md`, flytta denna fil till `docs/planning/archive/` när klart.
