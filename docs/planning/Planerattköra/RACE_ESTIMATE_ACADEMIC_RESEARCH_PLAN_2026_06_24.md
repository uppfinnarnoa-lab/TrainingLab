# Race-tidsestimat: vidare förbättring via akademisk litteratur + det stora datasetet

**Status:** Research klar — konkreta, prioriterade förslag, **inget implementerat ännu**
**Skapad:** 2026-06-24
**Förutsätter:** [docs/planning/archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md](../archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md) (implementerad 2026-06-24, se `IMPLEMENTATION_PLAN.md` session 2026-06-24i) och [docs/fitness/race-time-predictions.md](../../fitness/race-time-predictions.md) (nuvarande modell, dokumenterad sanning om koden idag)

## 0. Varför denna fil finns

Användaren bad specifikt om en uppföljande, **akademisk** research-pass på race-estimatet — utöver den redan implementerade bracket/blend-fixen — med fokus på att utnyttja det stora egna datasetet (2 800+ aktiviteter) bättre. Detta är **research-only**, enligt etablerad konvention för denna typ av begäran (se tidigare sessioner 2026-06-23): en plan, ingen kod. Implementerande agent ska validera mot riktig data innan något av detta byggs (se §5).

**Viktigt att läsa innan du implementerar något här:** den redan implementerade modellen (§1 nedan) är redan ovanligt sofistikerad för en app i denna skala — bracket-baserad lokal Riegel-exponent, blandning mot Daniels-kurvan viktad efter avstånd från riktig data, TSB/Banister-formjustering, recency-viktad HR-pace-regression, Minetti-grade-adjustment. Förslagen nedan är **förfining av en redan bra modell**, inte en omskrivning. Validerat resultat idag: ±3,2 % fel för 1K–10K (ner från -5,6 %/+30 %). Bryt inte detta för att jaga en akademisk idé som inte mätbart förbättrar saken — se §5.

## 1. Vad som redan finns (för att undvika att uppfinna hjulet igen)

| Komponent | Fil | Använder redan |
|---|---|---|
| Daniels VDOT-kurva ("Peak") | `lib/fitness/vo2max.ts:53` `predictRaceTime` | Populationsgenomsnitts-%VO2max-vs-duration |
| Bracket-baserad lokal Riegel | `vo2max.ts:349` `personalizedRacePrediction` | Närmaste 2 verkliga resultat, lokal exponent mellan dem |
| Blandning Peak + lokal | `vo2max.ts:404` `blendedRacePrediction` | Vikt 0,85–0,95 om bracketed/nära, ner mot 0,15 vid lång extrapolering |
| Minetti grade-adjustment | `vo2max.ts:219` `gradeAdjustedPace` | Minetti (2002) femtegradspolynom (redan bytt från linjär 0,033-approximation) |
| TSB-formjustering | `vo2max.ts:572` `tsbAdjustedVdot` | Banister impulse-response (förenklad) |
| HR-pace-regression | `vo2max.ts:104` `vo2maxHRPaceRegression` | Recency-viktad (130 dagars halveringstid), exkluderar intervaller |
| **Critical Speed + W′ (2-param hyperbolisk)** | `lib/fitness/critical-speed.ts` `estimateCriticalSpeed` | Linjärregression över bestEfforts+PB:n upp till 15K — **beräknas men används ALDRIG i race-prediktionen** (se §3a) |
| **Aerobisk decoupling/LT1** | `lib/fitness/decoupling.ts` `estimateLT1FromDecoupling` | Citerar Oliveira (2021), Coggan (2003), Friel (2009) — **beräknas men feeds bara LT1-zonen, inte race-prediktionen** (se §3d) |
| Volymjusterad Riegel ("Alex Gascón-modellen") | `vo2max.ts:749` (Model 4 i `estimateVO2max`) | `avgWeeklyRunKm` — **feeds bara den blandade VO2max-siffran, inte `computeRacePredictions` direkt** (se §3c) |

De två sistnämnda är nyckelfyndet i denna research: **modeller som redan är byggda och redan körs på det stora datasetet finns i kodbasen, men deras output går till spillo** — de matas aldrig in i `blendedRacePrediction`. Det är den billigaste och mest konkreta vinsten nedan (§3a, §4 förslag 1–2).

## 2. Akademisk litteratur — vad jag faktiskt hittade (verifierat via källor, inte gissat)

### 2A. Critical Speed/Power — 2-parameter-modellen är validerad, men marathon-faktorn varierar mer än kodens enda konstant antar

[Field-based tests for determining critical speed among runners and its practical application: a systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC11933073/) (2024/2025, PMC) — fältbaserad CS/D′-testning slår faktiskt labbtest för att förutsäga utomhuslopp ("treadmill-based CS estimates tended to underestimate 5 km race performance by 5–9 %"). Rapporterade andelar av CS som faktiskt hålls i lopp:

- Halvmaraton: **~97,3 %** av CS — matchar nuvarande hårdkodade `0.97`-faktor i `critical-speed.ts:54` nästan exakt. Bra korsvalidering av en siffra som redan finns i koden.
- Elitmaratonlöpare: **~95 %** av CS.
- Maraton, alla nivåer (genomsnitt): **84,8 %** av CS.

Nuvarande kod använder EN fast `0.93`-faktor för maraton (`critical-speed.ts:54`), vilket ligger mitt emellan elit (95 %) och genomsnitt (84,8 %). Det är inte fel i sig — men det är en generisk konstant, inte härledd för den specifika löparen. Den redan implementerade förra planen (§3–4 i `RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md`) visade redan **empiriskt** att denna löpares uthållighet faller kraftigt bortom 10K (implicit VDOT 53,8–60 genom 10K, ner mot 27 vid maratondistans) — alltså en profil som ligger närmare "genomsnitt" (84,8 %) än "elit" (95 %). Se §4 förslag 3.

Samma review: 3-minuters all-out-test (3MT) har test-retest-reliabilitet >0,90 för CS men underskattar D′ med ~16 %; icke-linjära (2-HYP/3-HYP) modeller är mer tillförlitliga för D′ men mer variabla än linjära. Ingen anledning att byta till 3-parametermodell här — komplexiteten väger inte upp (se avstyrkt förslag i §4.6).

### 2B. Mean-Maximal-Power-metodik — exakt den "stora dataset"-vinkeln användaren bad om

[An improved methodology for estimating critical power from mean maximal power output data](https://pubmed.ncbi.nlm.nih.gov/37660315/) (2023) — jämförde fast-duration MMP-analys (2/5/12 min) mot en finmaskigare sekund-för-sekund-filtrerad MMP-kurva: den filtrerade metoden korrelerade starkare med verkliga testresultat (r=0,922 vs 0,872). [Can Critical Power be Estimated from Training and Racing Data using Mean Maximal Power Outputs?](https://www.researchgate.net/publication/346426196_Can_Critical_Power_be_Estimated_from_Training_and_Racing_Data_using_Mean_Maximal_Power_Outputs) bekräftar att vanlig träningsdata (inte bara isolerade maxtester) ger jämförbara CS-skattningar — habitual training data, alltså exakt det denna app redan har 5 års historik av.

**Relevans för TrainingLab:** `estimateCriticalSpeed()` använder idag bara Stravas ~10–14 fördefinierade standarddistanser (`bestEfforts`) per aktivitet, deduplicerat till en bästa-tid per distans. Med 2 800+ aktiviteter finns sannolikt betydligt fler datapunkter tillgängliga om man bygger en tätare personlig "bästa-tid-vid-varje-duration"-kurva ur `splitsMetric` (samma rådata som redan används för `bestNkmSpeed()` i `vo2max.ts:492` och decoupling-beräkningen i `decoupling.ts`) snarare än bara de Strava-flaggade standarddistanserna. Se §4 förslag 5 — flaggat som värt att återbesöka, men INTE en uppgift att göra nu (se avgränsning i §4.6).

### 2C. Stora populationsstudier om maraton-specifik felmarginal — bekräftar att nuvarande breddning av osäkerhet vid maraton är rätt riktning

[Oficial-Casado, Priego-Quesada, Pérez-Soriano (2025/2026), Frontiers in Physiology](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2025.1718298/full) — N=7 663 löpare (Valencia halvmaraton+maraton, samma år). En enkel linjär modell (halvmaratontid + kön) gav MAE 5,67 % och slog Daniels VDOT (MAE 7,92 %) för **rekreationslöpare** (sub-4h och långsammare), men VDOT var fortsatt bättre för elit (sub-2:30/3:00). Tydlig, storskalig bekräftelse av samma mönster som redan diagnosticerades i förra planen: en global, elitkalibrerad kurva (Daniels) underpresterar specifikt för maratondistans hos icke-elitlöpare.

[Vickers & Vertosick (2016), BMC Sports Science, Medicine and Rehabilitation](https://bmcsportsscimedrehabil.biomedcentral.com/articles/10.1186/s13102-016-0052-y) — enkätstudie, N=2 303 rekreationslöpare. Fynd: Riegel fungerar bra upp till halvmaraton men den verkliga uttröttningsexponenten vid maratondistans ligger högre (rapporterat ~1,07–1,09) än standard 1,06 för typiska löpare — **och** vecklig träningsvolym och träningstyp (intervaller vs. tempo vs. lugna pass) predikterar maraton-specifik uttröttning **oberoende av** vilken exponent man härleder från kortare PB:n. Detta är samma typ av signal som redan finns i denna apps `weeklyVolumeJson`/`avgWeeklyRunKm` (se §1, "Volymjusterad Riegel") — men den signalen matar idag bara den blandade VO2max-siffran, inte den distansspecifika maraton/HM-osäkerheten i `blendedRacePrediction`. Se §4 förslag 4.

**Viktig avgränsning:** dessa två studier är populationsmodeller (byggda på tusentals andra löpares data), inte denna användarens egen data. De ska INTE ersätta den redan implementerade personliga bracket-modellen — de är bäst använda som en **sanity-check/cross-reference** specifikt för maratonraden när den egna datan är gles (se §4 förslag 6), inte som en ny primär prediktor.

### 2D. Redan citerat i koden — ingen ny upptäckt, men bekräftar att grunden är solid

`decoupling.ts` citerar redan Oliveira (2021) för drift-tröskeln (3,5 % över 40+ min), Coggan (2003) och Friel (2009) för decoupling-konceptet. Jag hittade ingen nyare (2023–2026) studie som motsäger eller väsentligt skärper dessa tröskelvärden — Oliveira (2021) förblir referensen att stå på.

## 3. Konkreta luckor — vad forskningen pekar på som faktiskt saknas i koden idag

a. **`estimateCriticalSpeed()`'s output (`csMetersPerSec`, `wPrimeMeters`, `rSquared`) matas aldrig in i `blendedRacePrediction`/`personalizedRacePrediction`.** Den används idag enbart som informationstext i AI-coachen (`lib/ai/tools.ts:712`: `"Critical speed: X km/h | W': Yym"`). Det är en redan beräknad, fysiologiskt fristående modell (hyperbolisk, inte log-log-Riegel) som bygger på samma stora bestEfforts+PB-pool — men dess prediktiva värde för t.ex. 10K–15K kastas bort.
b. **`csResult.rSquared` och `effortsUsed` sparas aldrig i `FitnessCache`** (`cache.ts:467-468` sparar bara `csMetersPerSec`/`wPrimeMeters`) — modellens egen godhet-i-fit beräknas (`critical-speed.ts:87-91`) men kasseras tyst direkt. Utan den går det inte att vikta CS-modellen efter hur bra den faktiskt passar just denna löparens data.
c. **`avgWeeklyRunKm` (Model 4, "Volymjusterad Riegel") feeds bara den blandade VO2max-siffran** som sedan går in i `predictRaceTime` (Peak-kurvan) — den lokala bracket-modellen och `lowConfidenceShort`/osäkerhetsbredden i `computeRacePredictions` har ingen direkt koppling till veckovolym eller långpasshistorik, trots Vickers & Vertosicks fynd (§2C) att just detta oberoende predikterar maraton-specifik uttröttning.
d. **`estimateLT1FromDecoupling()`'s resultat feeds bara LT1-zonen**, inte race-prediktionen. En löpare med låg decoupling (god aerob uthållighet vid långa pass) borde rimligen få en mindre brant uttröttningsexponent vid långa distanser än en med hög decoupling — denna koppling görs inte idag.
e. Den fasta `0.93`-maraton-CS-faktorn (`critical-speed.ts:54`) är en generisk litteraturkonstant, inte härledd från användarens egen data — se §2A.

## 4. Förslag, prioriterade efter (uppskattad nytta) / (komplexitet)

1. **[Låg komplexitet]** Spara `csResult.rSquared` och `csResult.effortsUsed` i `FitnessCache` (nya fält, `Float?`/`Int?`, ingen migration-logik behövs utöver schema-tillägg). Förutsättning för förslag 2 och 3 — utan detta går det inte att veta om CS-modellen är pålitlig för just denna löpare just nu.
2. **[Medel komplexitet, sannolikt störst mätbar vinst]** Väv in CS/W′-modellen som en **tredje komponent** i `blendedRacePrediction`, men bara för måldistanser inom modellens kalibrerade räckvidd (≤`CS_MAX_DIST`=15 000 m, samma gräns som redan finns i `critical-speed.ts:23`), viktad efter `rSquared` (lågt R² → liten eller ingen vikt, hög R² → meningsfullt bidrag). Detta ger en tredje, fysiologiskt oberoende skattning (hyperbolisk modell, skild från log-log-Riegel) som specifikt kan stärka 10K–15K-intervallet — exakt det område där dagens bracket-modell ofta är ensidig, eftersom `personalizedFatigueExponent`/`buildKnownPerformances` cappar `bestEfforts`-tillit vid 10K (se §3a i föregångsplanen) men CS-modellen redan litar på data upp till 15K.
3. **[Låg komplexitet]** Sluta använda en enda fast `0.93`-konstant för maraton-andelen av CS. Två alternativ, välj efter vad som är enklast att validera mot riktig data:
   - (a) Bredda intervallet 84,8–95 % (§2A) explicit i `predictionRange()`/`uncertaintyMultiplier` för maratonraden specifikt när ingen egen maraton/HM-data finns, istället för att låtsas ha ett skarpt tal, ELLER
   - (b) Om/när användaren loggar en riktig maraton- eller halvmaraton-`RaceRecord`, räkna tillbaka **den personens egen** CS-andel vid den distansen och cacha den för framtida prediktioner istället för litteraturkonstanten.
4. **[Medel komplexitet]** Koppla `avgWeeklyRunKm` (redan beräkningsbar, redan använd i Model 4) — och idealt längsta löppasset senaste 8 veckorna (beräkningsbart ur redan inläst `activities`/`weeklyVolumeJson`, ingen ny datakälla behövs) — som en explicit confidence/correction-signal specifikt för HM/maraton-raderna i `computeRacePredictions`, inte bara i VO2max-blandningen. Konkret: låg långpassvolym relativt måldistansen bör skjuta vikten ytterligare mot den breda Daniels-kurvan/litteraturintervallet i förslag 3, inte bara mot den lokala bracket-modellen som redan görs.
5. **[Hög komplexitet, flaggas men avstyrks för nu]** Mean-Maximal-Power-stil tätare personlig kurva ur `splitsMetric` över alla 2 800+ aktiviteter (inte bara Stravas ~10–14 standarddistanser) för att ge `estimateCriticalSpeed()` fler datapunkter (§2B). Värt att återbesöka **om** förslag 1–4 inte räcker för att få ner felet ytterligare vid 10K–15K — men bygg och validera 1–4 först; det är betydligt billigare och adresserar samma grundproblem (för lite tillförlitlig data i 10–21K-intervallet).
6. **[Låg komplexitet, referens/sanity-check, inte en ny primär prediktor]** När maratonraden saknar all egen ankardata (ingen RaceRecord, inga bracketable bestEfforts), jämför den blandade prediktionen mot Valencia-ekvationen (§2C: `tid = -701.85 + 2.28×HM-tid + 329.59×(kön==man)`, i sekunder) som en ren sanity-bound — flagga om de avviker mer än t.ex. 10 % från varandra, men låt inte den styra den faktiska siffran (det är en populationsmodell, inte personlig data).

## 5. Validering (obligatorisk innan något av §4 implementeras)

1. Återskapa diagnostikmetodiken från föregångsplanen (leave-one-out mot riktiga `RaceRecord`, samma throwaway-skript-mönster, raderas efter användning) som **baslinje** — kör den FÖRST mot dagens redan implementerade modell för att bekräfta att ±3,2 %-resultatet fortfarande står (datan kan ha förändrats sedan 2026-06-24i).
2. Implementera ett förslag i taget, kör om samma diagnostik, jämför mot baslinjen. Acceptera bara en ändring som **mätbart** minskar felet (eller breddar osäkerheten ärligare utan att försämra punktskattningen) — inte bara "ser teoretiskt mer korrekt ut".
3. Specifikt för förslag 2 (CS/W′ i blendedRacePrediction): verifiera att 10K–15K-felet förbättras eller står still — om det försämras, är `rSquared`-viktningen fel kalibrerad eller CS-modellens data för denna löpare för gles; backa då ut ändringen snarare än att tvinga in den.
4. Specifikt för förslag 3/4 (maraton-faktor): denna löpare har sannolikt fortfarande ingen egen maraton-`RaceRecord` (verifiera vid implementationstillfället) — om så, går (3b) inte att validera ännu och (3a) breddad osäkerhet är det rimliga valet just nu.
5. `pnpm build --no-lint` utan TypeScript-fel.

## 6. Vad detta INTE är

Detta är inte en uppmaning att byta modellfamilj (t.ex. till en 3-parameter CP-modell, eller en ren maskininlärningsmodell tränad på Strava-skala data — det senare kräver tusentals ANDRA användares data, inte bara denna enda användares historik, och är inte vad "stort dataset" syftar på här). Det är inte heller en uppmaning att riva upp den redan validerade bracket/blend-modellen. Det är specifikt: **väv in modeller som redan beräknas från det stora egna datasetet men vars output idag kastas bort (CS/W′, decoupling, volym), och ersätt en generisk litteraturkonstant (maraton-CS-faktorn) med antingen ett ärligare intervall eller personens egen data när den finns.**

---

## Slutinstruktion till implementerande agent

Implementera ett förslag i taget från §4, i prioritetsordning, och validera mätbart mot riktig data (§5) efter varje steg — inte bara i slutet. Om ett förslag inte mätbart förbättrar felet (eller gör osäkerhetsbandet ärligare utan att försämra punktskattningen), dokumentera varför och hoppa till nästa snarare än att tvinga in det. Förslag 5 ska INTE byggas i samma omgång som 1–4 — bara om 1–4 visar sig otillräckliga.

1. **Dubbelkolla att implementationen fungerar korrekt** — kör samma leave-one-out-diagnostik som i den redan implementerade föregångsplanen mot riktig data, jämfört mot baslinjen från §5.1, inte bara att koden kompilerar.
2. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` (sessionspost) och `docs/fitness/race-time-predictions.md` (modellbeskrivningen — den filen måste fortsätta vara sanningen om vad koden faktiskt gör, inte vad den gjorde innan denna omgång).
3. Flytta denna fil till `docs/planning/archive/` när allt ovan är bekräftat klart.
