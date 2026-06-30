# Frontend UX-revision: kontrast, mobilanvändbarhet, riktade brister

**Status:** Research/audit + visuell profil klar. Aktiviteter/Historik (§4.6), Planner (§4.6), och Statistics-graferna (§4.5) är nu alla implementerade i kod (senast commit `c465fbe`, 2026-06-30) — se §10.1 för en fullständig, kodverifierad statustabell som korrigerar äldre påståenden i §4.5/§4.6 om att dessa "inte är implementerade". Bara §10:s två nya krav (väljbar workout-flaggfärg för Stravas "workout"-flagga, auto-skapande av sport från Strava) återstår av allt som rör färgsystemet.
**Skapad:** 2026-06-27 · **Utökad:** 2026-06-27 (§8 tillagd), 2026-06-29 (§10 tillagd — slutgiltig, enhetlig färgspecifikation + statuskorrigering)

## 1. Mål och avgränsning

Grunden är **inte** en redesign. Uttrycklig instruktion från användaren: behåll temat, statistikfokuset, trovärdighetskänslan, precisionen och minimalismen som finns idag — ändra bara det som faktiskt är en brist, framförallt på mobil. `frontend-design`-skillen (`@claude-plugins-official`) är installerad men dess process ("ta en estetisk risk", omarbeta typografi/palett/layout) tillämpas **inte** rakt av, eftersom den processen är till för att bygga ny visuell identitet, inte för att punktfixa en redan fungerande. §2–§7 nedan är en konkret UX/tillgänglighets-revision: varje fynd är mätt eller verifierat i faktisk kod, inte en estetisk åsikt.

Efter att en fristående, medvetet "bold" design-POC byggts ([FRONTEND_DESIGN_SKILL_POC_2026_06_27.html](FRONTEND_DESIGN_SKILL_POC_2026_06_27.html), ej kopplad till appen) bad användaren om ett mellansteg: låna det POC:ets mest lyckade idéer — mer intressanta diagram, ikoner, färger och font — men tonat ner, och utan att offra dagens "glance-and-understand"-enkelhet. Det är **§8**, tillagd i efterhand och avgränsad från resten av dokumentet, som hanteras nedan: en riktig men sansad visuell profil, inte POC:ets fulla orienterings-identitet.

Genomgången täcker hela appen (alla sidor under `app/(dashboard)/` + `app/(auth)/`), med extra vikt på mobil enligt instruktion.

## 2. Metod

- **Kontrast:** Samtliga 12 temavarianter (Forest/Ocean/Ember/Slate/Sky/Mono × ljust/mörkt) extraherade från `app/globals.css:1-217` och kontrollerade med WCAG 2.1:s relativa luminans-formel (samma beräkning som webbläsares devtools använder). Facit: text ≥4.5:1 (AA) / ≥7:1 (AAA), UI-komponenter/grafiska objekt ≥3:1.
- **Mobil:** Läst faktisk JSX/Tailwind-klasser för navigation (`components/sidebar.tsx`), coach-sidans interna layout (`components/coach/ChatInterface.tsx`), aktivitetsfilter (`app/(dashboard)/activities/activity-list.tsx`) och statistik-grid (`components/stats/fitness-metrics.tsx`) — inte bara skärmdumpar, utan faktiska breakpoint-klasser och paddings.
- Inget i denna lista är gissat — varje rad pekar på exakt fil:rad.

## 3. Vad som redan är bra — rör INTE

Listat explicit så att en implementerande session inte "fixar" saker som redan fungerar:

- **Sky-temats mobila default** (`components/color-scheme-provider.tsx:23-26`): appen väljer redan automatiskt det varma, solljus-optimerade "Sky"-temat (kommentaren i CSS kallar det av historiska skäl "Sand", se §4.4) på skärmar <768px, och "Slate" på desktop. Det är redan en medveten, dokumenterad mobil-UX-insats med uppmätta AAA/AA-kontraster i ljust läge.
- **Statistik-grid kollapsar korrekt**: `components/stats/fitness-metrics.tsx:52` — `grid-cols-2 sm:grid-cols-4` — fyra mätvärden per rad på desktop, två på mobil. Ingen overflow, inget behov av ändring.
- **Aktivitetsfilter** (`app/(dashboard)/activities/activity-list.tsx:65,102`): `flex flex-wrap gap-2` — radbryter korrekt på smala skärmar istället för att overflowa.
- **Aktivitetslistans extra kolumner döljs på mobil** (`activity-list.tsx:204`, `hidden md:flex`) — redan ett medvetet val att visa mindre data på små skärmar snarare än att klämma in allt.
- **Fokusindikatorer**: `focus-visible`/`focus:ring` finns redan brett implementerat på formulärfält (15 filer, bl.a. `login/page.tsx`, `ai-settings.tsx`, `WorkoutBuilder.tsx`) — tangentbordsnavigering är inte beroende av den svaga `--border`-kontrasten (se §4.3).
- **Huvudnavigeringens mobilmönster** (`components/sidebar.tsx:162-177`): overlay-drawer med backdrop-klick-för-att-stänga är rätt mönster — coach-sidans interna sidopanel (§5.2) borde följa samma mönster, inte tvärtom.

## 4. Färgtema-kontrastrevision

### 4.1 Systembrist: fyra sportfärger klarar inte 3:1 i NÅGOT ljust tema — **rättad, se regressionsgranskningen i §9.1: dessa CSS-variabler visade sig vara helt oanvända**

`--sport-run` (#10B981), `--sport-ski` (#38BDF8), `--sport-rski` (#0EA5E9) och `--sport-strength` (#F87171) är fasta hex-värden, **inte** tema/mode-medvetna som `--text-primary`/`--accent` är. Uppmätt kontrast mot samtliga 6 ljusa bakgrunder (identisk för alla, eftersom bakgrunderna är nästan likst ljusa):

| Sportfärg | Mot ljus bakgrund | Mot ljus surface | Mot mörk bakgrund (alla mörka teman) |
|---|---|---|---|
| sport-run | 2.4:1 **FAIL** | 2.5:1 **FAIL** | 7–8:1 AAA ✓ |
| sport-ski | 2.0:1 **FAIL** | 2.1:1 **FAIL** | 8–9:1 AAA ✓ |
| sport-rski | 2.6:1 **FAIL** | 2.8:1 **FAIL** | 6–7:1 AA/AAA ✓ |
| sport-strength | 2.6:1 **FAIL** | 2.8:1 **FAIL** | 6–7:1 AA ✓ |

Används som `fill` i stapeldiagram (`components/charts/WeeklyVolumeChart.tsx:9-12,68` — `SPORT_COLORS`-mappning) och som färgswatch i sport-/passtyp-väljaren (`app/(dashboard)/settings/sports/sports-manager.tsx:237-238`). Diagrammen har redan textlegend (`Legend iconType="circle"`) så identiteten går inte helt förlorad, men stapelfärgen blir svår att skilja mot en ljus bakgrund för användare med nedsatt synskärpa — en riktig, mätbar brist, inte kosmetisk.

`sport-ol` (#059669) och `sport-bike` (#6366F1) klarar "AA, stor text/grafik"-nivån (3.5–4.3:1) i samtliga ljusa teman och behöver inte röras.

**Föreslagen åtgärd (punktfix, inte ny palett):** lägg till mörkare varianter av bara dessa fyra färger för ljust läge (t.ex. emerald-700/sky-700/cyan-700/red-700-grannskap — exakt hex bör verifieras mot 3:1 vid implementation), använda endast där `--sport-*` renderas mot en ljus bakgrund. De fyra som redan klarar gränsen samt samtliga mörka varianter rörs inte.

### 4.2 Slate-light är det svagaste temat för statusfärger

Slate-temats ljusa bakgrund (`#CBD5E1`, medvetet en "dämpad" mellangrå, se `app/globals.css:94-98`) äter upp kontrastutrymmet för statusfärger på ett sätt övriga ljusa teman inte gör:

| Par i Slate-light | Kontrast | Betyg |
|---|---|---|
| `--warning` (#D97706) mot bakgrund | 2.15:1 | **FAIL** (klarar inte ens stor text) |
| `--error` (#DC2626) mot bakgrund | 3.25:1 | AA stor text/grafik endast |
| sport-run/ski/rski/strength | 1.4–1.9:1 | **FAIL**, sämst av alla teman |

Övriga 5 ljusa teman har `--warning` på 3.0–4.8:1 och `--error` på 4.5–4.6:1 — godkänt. Endast Slate-light är under gränsen för varningsfärgen, vilket är den färg som bär mest praktisk betydelse (t.ex. ACWR-varningar på `/stats`).

**Föreslagen åtgärd:** mörka `--warning` (och möjligen `--error`) specifikt i `.scheme-slate` (rad 100-105 i `app/globals.css`) tills 4.5:1 nås — samma fix-mönster som redan användes för Sky-temat (`--warning: #B45309` istället för standardens `#D97706`, se kommentaren rad 150). Övriga 5 teman rörs inte — de klarar redan gränsen.

### 4.3 `--border` under 3:1 i alla 12 varianter — låg prioritet, verifiera bara input-fält

Samtliga teman: bordern mot surface/bakgrund ligger på 1.18–2.29:1, långt under WCAG 1.4.11:s 3:1 för UI-komponentgränser. Detta är **inte automatiskt akut** eftersom (a) fokusindikatorer redan är separat implementerade (§3) och (b) många användningar är rent dekorativa avdelare där 3:1-kravet inte är meningsfullt. Den enda plats där det faktiskt kan vara ett problem är **ofokuserade fält** (text-input, select) där bordern är det enda som visar "detta är ett fält" innan man klickar — värt en snabb visuell kontroll vid implementation, men inte en bred temaändring.

### 4.4 Nit (en kommentarsrad, ingen funktionell effekt)

`app/globals.css:122-139` — kommentarsblocket ovanför temat heter "Theme: Sand" och har forskningsanteckningar som refererar till "Sand"-paletten, men CSS-selektorn är `.scheme-sky` (rad 140) och hela resten av kodbasen (`ColorScheme` typ, `COLOR_SCHEMES`-array, mobildefault-kommentaren i `color-scheme-provider.tsx:23`) kallar det "sky". Temat döptes om vid något tillfälle men kommentaren glömdes. Verifierat att det inte är användarsynligt heller: `appearance-settings.tsx:15` visar konsekvent `label: "Sand"` i temaväljaren — användaren ser bara "Sand", överallt, så det enda som drabbas är en utvecklarförvirrande kommentar/kod-namn-skillnad. Ren kodhygien, en enrads-omdöpning av kommentaren om man råkar vara i filen av annan anledning.

### 4.5 NY, verifierad bugg: samma sport/typ har olika färg på flera ställen i appen — utökad efter användarens rättning, se §9.2

Letade upp **alla** ställen i kodbasen som hårdkodar sportfärger (11 filer träffade på samma hex-värden) för att kunna svara på frågan "har samma sport samma färg överallt redan idag?" — svaret är **nej**, och det är inte en hypotetisk risk utan ett redan levande, mätbart fel:

| Sport | `WeeklyVolumeChart.tsx:10-15` | `volume-client.tsx:42-47` |
|---|---|---|
| Running | `#10B981` (grön) | `#6EE7B7` (ljusgrön) |
| Orienteering | `#059669` (grön) | `#F472B6` (**rosa**) |
| Cycling | `#6366F1` (indigo) | `#FBBF24` (**gul/amber**) |
| Skiing | `#38BDF8` (himmelsblå) | `#60A5FA` (annan blånyans) |
| Roller Skiing | `#0EA5E9` (blå) | `#A78BFA` (**lila**) |
| Strength | `#F87171` (röd) | `#F97316` (**orange**) |

Två oberoende, lokalt deklarerade `SPORT_COLORS: Record<string,string>`-objekt med exakt samma sportnamn som nycklar men helt olika hex — Orientering är grön i veckovolym-diagrammet på Dashboard men rosa i volymstatistiken på `/stats/volume`. Detta är precis den typ av inkonsekvens som gör appen svårare att läsa, inte lättare — en användare som lär sig "grönt = orientering" på en sida möter "rosa = orientering" på en annan.

**Övriga filer som matchade samma hex-sökning är INTE samma bugg, och ska inte ändras:** `fitness-metrics.tsx`/`stats-client.tsx`/`TrainingLoadChart.tsx`/`activity-charts.tsx` återanvänder bara de mörka temats `--error`/`--accent`/`--accent-2`-nyanser hårdkodat för **statusfärger** (ACWR-risk, CTL/ATL/TSB, mätsäkerhet) — orelaterat till sportidentitet, men värt en egen, separat notering: dessa hårdkodade statusfärger anpassar sig inte till ljust/mörkt läge eller temaval, till skillnad från `--error`/`--warning`-token som redan finns och borde användas istället. Lägre prioritet än sport-färgbuggen, men samma rotorsak (hårdkodad hex istället för delad källa). `WorkoutBuilder.tsx`/`BlockEditorModal.tsx`/`sports-manager.tsx`s träffar är färgVÄLJAR-paletter (`PRESET_COLORS`/`TYPE_COLOR_PALETTE`) — listor av valbara svatcher användaren kan tilldela en sport/typ, helt korrekt och avsiktligt annorlunda än en fast sport→färg-bindning; rör inte dessa.

**Föreslagen åtgärd — korrigerad efter att ha spårat hela kedjan (en delad statisk konstant räcker INTE):** `sports-manager.tsx`s färgväljare sparar redan korrekt till `SportCategory.color` via `PATCH /api/sports` (`app/api/sports/route.ts:107-125`, `prisma.sportCategory.update()`) — färgerna är **redan idag** användarbara i Settings, och måste **fortsätta vara det**, oförändrat. Problemet är djupare än "två hårdkodade listor skiljer sig": båda diagramfilerna ignorerar `SportCategory.color` helt. Datan som når dem (`weeklyVolumes`/`records`, byggd i föräldra-sidorna via `normalizeSport()`) innehåller bara sportnamn som text, ingen färg alls — `SPORT_COLORS`-objekten är **enda** färgkällan idag, vilket betyder att en användare som byter färg på "Löpning" i Settings inte ser det förändras i något diagram.

En delad statisk konstant (ursprungligt förslag ovan) hade bara bytt ut en omöjlig-att-ändra lista mot en annan — fortfarande frikopplad från databasen. **Rätt fix:** föräldrasidorna (`app/(dashboard)/dashboard/page.tsx` respektive `app/(dashboard)/stats/volume/page.tsx`) hämtar redan `SportCategory`-raderna för andra syften (sport-/typhantering) — de behöver skicka ner en `sportColors: Record<string, string>`-prop (sportnamn → `SportCategory.color`) till diagrammen istället för att diagrammen gissar själva. `--sport-*`-CSS-variablerna (inkl. §4.1:s ljusa light-mode-fix) blir kvar som **default-/fallback-värde** — använt när en sport saknar egen `SportCategory`-rad, eller som startfärg när en ny sport skapas — inte som den körande render-källan när en riktig anpassad färg finns. Detta löser samtidigt §4.1:s kontrastbugg och dagens "byter inte i Settings"-problem i en och samma ändring, eftersom diagrammen då alltid visar exakt den färg som faktiskt är sparad.

**KORRIGERAT 2026-06-29 (§10.1): denna åtgärd är redan implementerad i kod, trots att texten ovan beskriver den som ett öppet förslag.** `app/(dashboard)/stats/page.tsx:60-63` och `app/(dashboard)/stats/volume/page.tsx:29-32` bygger båda redan en `sportColors`-karta från `prisma.sportCategory.findMany()` och skickar den hela vägen till `WeeklyVolumeChart`/`VolumeClient`; båda filernas `SPORT_COLORS`-konstanter är numera uttryckligen kommenterade "Fallback only — used when the sport has no real SportCategory match". Se §10.1/§10.5 för den fullständiga kodverifieringen — texten ovan lämnas orörd som historik, men ska INTE längre tolkas som ett öppet att-göra.

### 4.6 Samma fix utökad till Planner, Aktiviteter och Historik — användaren bekräftade detta SKA vara enhetligt, inte bara diagrammen

**Status 2026-06-28d: Aktiviteter/Historik-delen implementerad** (`resolveActivityColor()` i `lib/planner/colors.ts` — se IMPLEMENTATION_PLAN.md, sessionen 2026-06-28d). **Korrigerat 2026-06-30:** Planner-tabellen nedan och §4.5:s diagramfix är nu också klara — fixade av en parallell session samma dag, committat som `c465fbe`. Se §10.1 för den fullständiga, kodverifierade statusen.

Användaren rättade §9.2:s ursprungliga slutsats ("lämna `lib/planner/colors.ts` orörd") explicit: planner-kalendern, aktivitetslistan och historiken ska visa **samma** sport-/typfärg som Settings, inte en fjärde separat palett. Spårade alla anropsställen till `workoutColor()`/`activityColor()`/`sportOnlyColor()` (`lib/planner/colors.ts`) innan jag skrev om rekommendationen, så fixen blir komplett:

**Planner-sidan — redan nästan klar, bara ett byte av vilken variabel som läses:**

| Anropsställe | Har redan riktig `.color` laddad? |
|---|---|
| `components/planner/WorkoutPill.tsx:45` | Ja — `workout.template?.type` |
| `components/planner/WorkoutBuilder.tsx:205` | Ja — `selectedSport` |
| `app/(dashboard)/planner/planner-client.tsx:193` | Ja — `template.sport`/`template.type` |
| `components/planner/TemplateCard.tsx:20` | Ja — `template.sport`/`template.type` |
| `app/(dashboard)/planner/week/page.tsx:68,135,256` | Delvis — rad 256 gör redan `w.color ?? workoutColor(...)` (föredrar sparad färg!), rad 68/135 gör det inte än |

`PlannedWorkout.typeId` är en riktig FK till `WorkoutType` (`prisma/schema.prisma:302`) och queries laddar redan relationen (`include: { template: { include: { sport: true, type: true } } }`, `week/page.tsx:42-48`). **Inga nya databasfrågor behövs** — varje anropsställe har redan `sport.color`/`type.color` i scope och ska använda dem direkt istället för att räkna om via regex. Rad 256:s `w.color ?? workoutColor(...)`-mönster är beviset att detta redan fungerar säkert någonstans i kodbasen — bara inte konsekvent överallt än.

**Aktiviteter/Historik — kräver namnslagning, samma form som diagramfixen:** `Activity` har **ingen** FK till `SportCategory`/`WorkoutType` (`prisma/schema.prisma:142-200`) — bara fritext `sportType` (från Strava), `workoutType: Int?` (Stravas egen kod), `customTypeName: String?` och `isRace: Boolean`. `activity-list.tsx:124,139` och `history-client.tsx:27,157` måste matcha den normaliserade sportsträngen mot användarens `SportCategory[]`-lista (hämtad en gång, litet bord) — exakt samma namnslagningsmönster som §4.5:s diagramfix, inte en ny teknik.

**Tävlingsgult behöver inte vara ett hårdkodat specialfall längre:** det finns redan en delad `WorkoutType` med namnet **"Race"** (`color: "#FBBF24"`, `isShared: true`), skapad av `app/api/planner/backfill-shared-race-type/route.ts:23-26` — alltså redan en redigerbar typfärg i samma system, inte en separat konstant. `workoutColor()`s regex-genväg (`/tävl|race|.../` → hårdkodad `#FBBF24`) och `activityColor()`s `if (isRace) return "#FBBF24"` kan båda bytas mot en slagning på den riktiga, delade "Race"-typens sparade färg. Eftersom den är `isShared: true` och egen, inte återanvänder en sports egen färg, finns ingen kollisionsrisk (en användare som väljer gult som sin löpfärg påverkar inte "Race"-typens egen, separat inställbara färg) — och om användaren vill ha tävlingar i en annan färg går det nu faktiskt att ändra, vilket det inte gjorde innan. `Activity.isRace` (Stravas boolean, ingen FK) slår upp samma delade "Race"-typ via namn, likt sportmatchningen ovan.

**Vad som blir kvar av `lib/planner/colors.ts` efter fixen:** `statusBorderColor()` (komplettering-status, ej sport-/typfärg) rörs inte. `sportOnlyColor()` har redan noll anropsställen — kan tas bort helt. `workoutColor()`/`activityColor()` kan retireras helt när alla ovanstående anropsställen är migrerade — inget anropsställe behöver dem längre. `scripts/recolor-workouts.ts:41,57,74` (ett engångs-bulkscript) använder samma funktion men är inte UI — låg prioritet, kan lämnas eller uppdateras separat, påverkar inget en användare ser.

### 5.1 Två ikonknappar i mobilnavigeringen är mindre än rekommenderad tap-target (44×44px)

- `components/sidebar.tsx:69` — hamburgerknappen: `p-2` (8px padding) + 20px ikon ≈ **36×36px**
- `components/sidebar.tsx:88-90` — stäng-knappen (X): `p-1.5` (6px padding) + 18px ikon ≈ **30×30px**, minsta tap-target i hela appen

Båda är primära, frekvent använda kontroller (öppna/stänga huvudmenyn på mobil), inte sällananvända ikoner — exakt den typ av kontroll där 44px-riktlinjen (Apple HIG / Material) spelar roll för faktisk träffsäkerhet med tummen.

**Föreslagen åtgärd:** höj `p-2` → `p-3` (hamburger, ger ~40px) och `p-1.5` → `p-3` (stäng-knapp, ger ~42px) eller motsvarande `min-w-[44px] min-h-[44px]`. Resten av sidofältets knappar (nav-länkar, settings/theme/collapse-raden) är fullbredds-rader på mobil där bredden kompenserar för höjden — rör inte dem.

### 5.2 Coach-sidans konversationslista är öppen by default på mobil — kapar chattytan i hälften

`components/coach/ChatInterface.tsx:96` — `sidebarOpen` startar som `true` oavsett skärmbredd. Panelen (rad 334-337) är `w-52` (208px) öppen / `w-10` (40px) stängd, styrt enbart av lokalt state — **ingen `md:`-brytpunkt**. På en telefon i normalbredd (375-390px) tar konversationslistan upp över hälften av skärmen som standard, vilket klämmer själva chatten (huvudfunktionen på sidan) till en smal remsa vid första besöket.

Detta är exakt det problem huvudnavigeringen (`components/sidebar.tsx`) redan har löst korrekt med overlay-drawer + backdrop (§3) — coach-sidans interna sidofält uppfann ett enklare men mobil-ovänligt mönster istället för att återanvända det.

**Föreslagen åtgärd (punktfix, inte ombyggnad):** sätt `sidebarOpen`-defaulten baserat på viewport-bredd vid mount (samma `window.innerWidth < 768`-mönster som redan finns i `color-scheme-provider.tsx:24`) istället för hårdkodat `true`. Self-knappen för att öppna/stänga (rad 339-342) finns redan och kräver ingen ändring — bara startvärdet.

## 6. Prioriterad åtgärdslista

| # | Fynd | Fil:rad | Prioritet |
|---|---|---|---|
| 1 | Coach-sidofält öppet by default på mobil | `ChatInterface.tsx:96` | **Hög** — påverkar huvudfunktionen på en hel sida, varje mobilbesök |
| 2 | Mobilnav hamburger/stäng under 44px | `sidebar.tsx:69`, `sidebar.tsx:88-90` | **Hög** — frekvent använd, lätt fix |
| 3 | Slate-light `--warning`/`--error`/sportfärger under gräns | `globals.css:100-105` | **Medel** — ett av sex teman, men det svagaste |
| 4 | Sportfärger (run/ski/rski/strength) <3:1 i alla ljusa teman | `globals.css` (sport-vars), `WeeklyVolumeChart.tsx` | **Medel** — legend mildrar, men mätbar brist |
| 5 | `--border` <3:1 generellt | `globals.css` (alla teman) | **Låg** — verifiera input-fält specifikt, annars lämna |
| 6 | Kommentarsmissmatch "Sand"/"sky" | `globals.css:122` | **Triviell** — gör bara om man redan är i filen |
| 7 | ~~Diagram ignorerar `SportCategory.color` helt~~ — **KLART, se §10.1**: redan löst i kod (`stats/page.tsx`, `stats/volume/page.tsx`) | `WeeklyVolumeChart.tsx`, `volume-client.tsx`, `app/api/sports/route.ts` (redan korrekt) | ~~Hög~~ Klar |
| 8 | ~~Planner/Aktiviteter/Historik — fjärde separat färgkälla~~ — **KLART, se §10.1**: fixat av commit `c465fbe` (2026-06-30) | `lib/planner/colors.ts`, `WorkoutPill.tsx`, `WorkoutBuilder.tsx`, `planner-client.tsx`, `week/page.tsx`, `activity-list.tsx`, `history-client.tsx` | ~~Hög~~ Klar |
| 9 | NYTT (§10): väljbar typfärg för Stravas "workout"-flagga, per sport | `prisma/schema.prisma`, `sports-manager.tsx`, `lib/planner/colors.ts`, `lib/strava/sync.ts` | **Medel** — ny datamodell + UI, se §10.2–§10.4 |
| 10 | NYTT (§10): auto-skapa `SportCategory` för okänd Strava-sporttyp vid synk | `lib/strava/sync.ts` | **Medel** — ny funktion, 3 anropsställen, se §10.4 |

## 7. Explicit utanför scope (för §2–§6)

Per ursprunglig instruktion: ingen layoutomarbetning av sidor som redan fungerar (dashboard-kort, stats-gridet, aktivitetsfiltren, login-kortet) och inget arbete drivet av `frontend-design`-skillens fulla "ta en estetisk risk"-process. §2–§6 är riktade fixar mot mätta brister, inte en designöversyn. Typografi och en ny accentfärg är **inte** längre helt utanför scope — se §8, tillagt efter ett separat senare beslut att tillåta en avgränsad visuell profil.

## 8. Visuell profil (tonad ner från design-POC)

### 8.0 Princip

Låna fyra konkreta saker från [FRONTEND_DESIGN_SKILL_POC_2026_06_27.html](FRONTEND_DESIGN_SKILL_POC_2026_06_27.html) — font, en accentfärg, ikonkaraktär, diagramstil — men **inte** POC:ets orienterings-tema, konturlinje-motiv eller kontrollkorts-listor. Allt nedan är litet, additivt och påverkar inget av det som redan listas som "rör INTE" i §3: samma layout, samma informationsdensitet, samma navigation, samma 6-temasystem (forest/ocean/ember/slate/sky/mono) som grund. Loggan (`components/logo.tsx`) behålls oförändrad i form — färgen får följa den nya accenten om det behövs, formen rörs inte.

Testbar tumregel använd för varje förslag nedan: **om det kräver att användaren stannar upp och tolkar något nytt för att förstå en siffra eller ett diagram, är det fel — det ska gå snabbare eller lika snabbt att läsa av som idag, bara snyggare.**

### 8.1 Typografi — en displayfont, bara för siffror och rubriker

Lägg till **Space Grotesk** (Google Fonts, vikter 500/700) som en tredje fontroll, vid sidan av de två som redan finns:

| Roll | Font | Används till | Ändras? |
|---|---|---|---|
| Display/siffror | **Space Grotesk** (ny) | Stora mätvärden (`OverviewCard`s värde-rad), sidornas H1, beredskaps-/poäng-tal | Nytt |
| Brödtext/UI | Inter | Navigation, knappar, formulär, brödtext, tabeller | Oförändrad |
| Data/mono | JetBrains Mono | Tal i tabeller, splits, kod | Oförändrad |

Space Grotesk är geometrisk och något mer karaktärsfull än Inter men fortfarande en sans utan seriffer eller dramatik — en "lugn" uppgradering, inte POC:ets kondenserade Big Shoulders Display. Eftersom den bara appliceras på stora, fristående tal/rubriker (aldrig löpande text eller tabellrader) finns ingen läsbarhetsrisk — exakt samma siffror på exakt samma platser, bara med lite mer personlighet. Implementation: en rad i `app/layout.tsx` (`next/font/google`) + `--font-display` i `@theme inline`-blocket (`app/globals.css:204`), använd via en Tailwind-klass på stat-komponenter (`OverviewCard.tsx`, sidors `<h1>`).

### 8.2 Färg — en ny delad accent, plus en redan beslutad bugfix

**Ny token `--feature`** (en bränd lera/terrakotta, inspirerad av men mycket mer dämpad än POC:ets klarröda OL-skärm-orange `#FF5A1F`) — verifierad kontrast:

| Variant | Hex | Mot bakgrund | Betyg |
|---|---|---|---|
| Ljust läge | `#B45A2C` | 4.5–4.7:1 mot vit/ljusa ytor | AA |
| Mörkt läge | `#E8956A` | 7.2–8.0:1 mot mörka ytor | AAA |

Används sparsamt — **en signaturplats per vy**, exakt enligt POC:ets eget "spend your boldness in one place"-råd: PB-badgen på `/races`, beredskapsringens fyllda del på `/dashboard`, och rubriken på det enskilt viktigaste talet på varje sida. Inte en ny global knappfärg, inte överallt — `--accent`/`--accent-2` (grön/indigo) förblir de vanliga interaktionsfärgerna oförändrade i alla 6 teman.

**Samtidigt fixas §4.1:s redan dokumenterade kontrastbrist** med riktiga, verifierade värden istället för platshållartexten som stod där tidigare — light-mode-varianter för de fyra sportfärgerna som idag failar 3:1:

| Sportfärg | Ny light-hex | Kontrast mot vit | Mörk variant |
|---|---|---|---|
| sport-run | `#0E7A55` | 5.3:1 AA | oförändrad (`#10B981`, redan AAA mot mörk bg) |
| sport-ski | `#0369A1` | 5.9:1 AA | oförändrad (`#38BDF8`) |
| sport-rski | `#0C5C8C` | 7.2:1 AAA | oförändrad (`#0EA5E9`) |
| sport-strength | `#C0392B` | 5.4:1 AA | oförändrad (`#F87171`) |

Implementation: lägg till `-light`-suffixerade CSS-variabler bredvid varje `--sport-*` (`app/globals.css:17-22` per tema) och låt `WeeklyVolumeChart.tsx`/`sports-manager.tsx` välja variant baserat på `.dark`-klassen, samma mönster `--text-primary` redan använder.

### 8.3 Ikoner — egen sportkaraktär, generisk navigation orörd

Lucide förblir ikonbiblioteket för **all** navigation, knappar och generiska UI-ikoner (sidebar, inställningar, planner-actions) — noll risk, noll ändring. Det enda nya: **fem egna, enkla linjeikoner** för sporterna (löpning, orientering, cykel, skidor, styrka) som ersätter dagens generiska Lucide-substitut specifikt i sport-väljaren (`sports-manager.tsx`) och aktivitets-badges. Varje ikon hämtar sin färg från **samma riktiga, redan-användarbara källa som §4.5 (korrigerad) pekar på** — `SportCategory.color`, samma fält Settings redan skriver till — inte en fjärde, egen färggissning och inte en fast lista. Ändrar en användare en sports färg i Settings ska ikonen (precis som diagrammen och swatchen) byta färg automatiskt.

**StrokeWidth-detaljen rättad efter regressionsgranskning (§9.4):** "en enda propändring i `ICON_SIZE`-konstanterna" var fel — grep mot hela kodbasen hittade noll explicita `strokeWidth=`-anrop någonstans; alla Lucide-ikoner kör på bibliotekets default och `ICON_SIZE` styr bara `size`, inte linjebredd. Att sätta `strokeWidth={1.75}` på varje enskilt ikon-anrop hade varit en mycket större, spridd ändring än planerat. Rätt väg: Lucide-ikoner renderas redan med en `lucide`-CSS-klass på `<svg>`-elementet, så en enda global regel i `app/globals.css` (`svg.lucide { stroke-width: 1.75; }`) ger exakt samma visuella effekt utan att röra ett enda call-site — en sant minimal ändring, bara på rätt nivå.

Första ikon-utkastet (i [FRONTEND_VISUAL_PROFILE_2026_06_27.html](FRONTEND_VISUAL_PROFILE_2026_06_27.html)) höll inte måttet — för abstrakta/oproportionerliga för att läsas som sin sport vid en snabb blick. Ritades om till tydligare siluetter: löpning som en proportionerlig löparpose med tydligt isärsärade fram-/bakben (huvud, lutande bål, ben i motsatta diagonaler) istället för en stel, korsbent pinngubbe; orientering som en kompass med en kort/lång nål (N/S) och mittpunkt istället för bara en tom cirkel; cykel med korrekt hjul-till-ram-geometri (två hjul + en sluten ramtriangel + sadel + styre) istället för korsande linjer; skidor som korsade skidor med uppåtvinklade spetsar — det universella skidspår-skylt-motivet — istället för två raka streck som lätt lästes som bokstaven "H"; styrka oförändrad (redan tydlig).

**Rättat igen 2026-06-30, efter direkt användarfeedback: v1/v2 ovan ska INTE användas — hand-ritade ikoner (av Claude) ser inte tillräckligt korrekta/professionella ut, oavsett hur många omritningar.** Istället hämtas riktiga, etablerade ikoner från ett befintligt öppen källkods-bibliotek. Valt: **Tabler Icons** ([tabler.io/icons](https://tabler.io/icons), MIT-licens, `github.com/tabler/tabler-icons`) — samma tekniska konvention som Lucide (24×24 `viewBox`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `stroke="currentColor"`), eftersom Tabler och Lucide båda har sina rötter i Feather Icons och därför blandas sömlöst med den oförändrade Lucide-navigeringen i resten av appen — till skillnad från t.ex. Phosphor eller Material Symbols, vars ikoner antingen är fyllda eller har en annan linjekaraktär och därför skulle sticka ut.

Verifierade exakta filnamn (hämtade och kontrollerade direkt mot `unpkg.com/@tabler/icons@latest/icons/outline/<namn>.svg`, 2026-06-30 — inte gissade ur minnet):

| Sport | Tabler-fil | Anmärkning |
|---|---|---|
| Löpning | `run.svg` | Proportionerlig löparpose, redan korrekt utan ändring |
| Cykel | `bike.svg` | Korrekt hjul/ram/sadel/styre-geometri |
| Styrka | `barbell.svg` | Skivstång med vikter, tydlig vid små storlekar |
| Orientering | `compass.svg` | Inget bibliotek (Tabler, Lucide, Phosphor, Iconoir) har en egen "orienterings"-ikon — kompass är närmaste vedertagna symbol och matchar redan v2:s kompass-koncept ovan |
| Skidor / Rullskidor | `ski-jumping.svg` | **Känd, medveten brist, inte dold:** `ski.svg`/`nordic-ski.svg`/`cross-country-ski.svg` finns inte i Tabler (kontrollerat, 404) och inget annat större bibliotek har heller en dedikerad längdskidor- eller rullskidor-ikon. `ski-jumping` (utförsåknings-/hoppställning) är närmaste tillgängliga alternativ inom SAMMA bibliotek/stil — vid normal ikonstorlek (16–24px) är den exakta grenen inte urskiljbar, så den läses ändå som "skidor". Samma fil återanvänds för både "Skidor" och "Rullskidor" eftersom ingen källa har en separat rullskidor-symbol — identiskt med hur v1/v2 ovan redan löste det (en gemensam skid-ikon för båda) |

**Implementation:** ladda ner och inline:a dessa 5 SVG:er som statiska React-komponenter i t.ex. `components/icons/sport-icons.tsx`, i samma stil som `components/logo.tsx` (egen komponent per ikon, `size`/`color`/`className`-props) — INTE genom att lägga till `@tabler/icons-react` som nytt npm-beroende för 5 av dess 6000+ ikoner, vilket vore en onödigt tung dependency för fem statiska path-strängar appen redan kan äga själv. Färgen kommer fortfarande från `SportCategory.color` (oförändrat krav från stycket ovan) — bytet gäller bara VARIFRÅN path-datan kommer, inte färglogiken.

### 8.4 Diagram — samma data, mer karaktär, inte mer att tolka

Fyra konkreta, var för sig låg-risk ändringar i `components/charts/*` (Recharts):

1. **Gradientfyllning under linjer** istället för bar linje — `LineChart`/`AreaChart` (LT-trend, HRV-trend, sömn-trend m.fl.) får en mjuk gradient (seriens färg → transparent) under kurvan via `<defs><linearGradient>` + `fillOpacity`. Detta är samma mönster Linear/Vercel/Stripe-dashboards använder specifikt *eftersom* det är lika lätt att läsa som en bar linje — ingen ny tolkningsbörda. **Avgränsning efter regressionsgranskning (§9.5): gäller bara diagram där värdet alltid håller sig åt ett håll** (HRV-trend, sömn-trend, LT-pace-trend, VO2max-trend m.fl. — alla alltid-positiva). `components/charts/TrainingLoadChart.tsx:74-76` undantas explicit: TSB-linjen (rad 76, streckad, `strokeDasharray="5 2"`) korsar legitimt noll i båda riktningar — en gradient ner mot diagrambotten hade sett trasig/missvisande ut där och kombinerar dåligt med en streckad linje. CTL/ATL-linjerna i samma diagram (alltid positiva) kan få gradient om så önskas, TSB ska inte. `WeatherPaceScatterChart.tsx` har en inverterad Y-axel (rad 79) där gradientens visuella riktning skulle kännas bakvänd — undantas också, ingen gradient där.
2. **Rundade stapeltoppar konsekvent** — redan delvis implementerat (`WeeklyVolumeChart.tsx:68`), utöka till samtliga `BarChart`-instanser.
3. **Zon-band istället för bara streckad mållinje** — där ett mål/zonintervall redan visas (LT2-pace-trend, HR-zoner) lägg till ett tonat horisontellt band (`<ReferenceArea>`) bakom kurvan istället för bara en `<ReferenceLine>` — samma information, en visuell ledtråd till.
4. **Tooltip-omdesign** — kort-stil mot `--surface` (befintlig border-token), värdet i Space Grotesk, en liten färgad punkt per serie istället för Recharts standardlayout. Ren polish, ingen ny information.

Explicit **inte**: 3D-diagram, polära/radar-diagram, animerade enter-transitions utöver befintlig 150ms ease, eller flera diagramtyper överlagrade i samma vy — allt sådant skulle bryta mot 8.0:s tumregel.

### 8.5 Åtgärdslista, §8

| # | Ändring | Var | Risk/omfattning |
|---|---|---|---|
| 1 | Space Grotesk för stora tal/H1 | `app/layout.tsx`, `globals.css`, stat-komponenter | Låg — additiv fontroll |
| 2 | `--feature`-token (ljus/mörk) | `app/globals.css`, en signaturplats/vy | Låg — ny token, sparsam användning |
| 3a | Trä riktig `SportCategory.color` ner till diagrammen, ny delad fallback-konstant (ersätter §4.1:s döda CSS-variabler, se §9.1) | `WeeklyVolumeChart.tsx`, `volume-client.tsx`, deras föräldrasidor, ny delad färghjälpare | Låg-medel — löser §4.1 OCH §4.5 i samma ändring |
| 3b | Samma riktiga färg till Planner (byt regex-anrop mot redan inladdad `sport.color`/`type.color`) + Aktiviteter/Historik (namnslagning) + gör "Race" till en vanlig redigerbar typfärg (§4.6, utökat efter användarens rättning av §9.2) | `WorkoutPill.tsx`, `WorkoutBuilder.tsx`, `planner-client.tsx`, `TemplateCard.tsx`, `week/page.tsx`, `activity-list.tsx`, `history-client.tsx`, `lib/planner/colors.ts` (retireras) | Låg (planner, ingen ny query) till Medel (aktiviteter/historik, kräver namnslagning) |
| 4 | 5 sportikoner hämtade från Tabler Icons (MIT-licens, ej hand-ritade — se rättningen i §8.3) + global strokeWidth 1.75 via CSS (rättad, se §9.4) | `components/icons/sport-icons.tsx` (ny), `sports-manager.tsx`, aktivitets-badges, `app/globals.css` (`svg.lucide` regel) | Låg — fem statiska SVG:er, ingen ny npm-dependency, CSS-regel istället för per-call-site-ändring |
| 5 | Gradientfyllning (avgränsad, se §9.5), zon-band, tooltip-omdesign i diagram | `components/charts/*` utom `TrainingLoadChart.tsx`s TSB-linje och `WeatherPaceScatterChart.tsx` | Medel — flest filer berörs, men varje ändring är mekanisk/repetitiv |

### 8.7 Logotyp — fullständig specifikation (tillagd 2026-06-30, efter direkt begäran: loggan ska vara en riktig del av profilen, inte bara visas dekorativt i headern)

Loggan är redan byggd (`components/logo.tsx`) men har aldrig haft en egen specifikation i denna profil. Detta avsnitt extraherar och dokumenterar den FAKTISKA, redan-kodade konstruktionen som en riktig märkesspec — inte ett nytt designförslag — och fyller bara i två luckor (clearspace, minsta storlek) som koden idag saknar helt.

#### 8.7.1 Konstruktion — märket ("T":et)

- 40×40 SVG-`viewBox`. Formen är bokstaven **T**, byggd av en enda `path`: `M2,7 H38 V17 H27 V40 H13 V17 H2 Z` (`components/logo.tsx:33`) — ett 36px brett, 10px högt tak (x=2–38, y=7–17) och en 14px bred, 23px hög stam (x=13–27, y=17–40). Stamen sträcker sig hela vägen till y=40 (SVG-kantens underkant) — detta är nödvändigt för att T:ets visuella underkant ska sammanfalla med SVG-rektangelns underkant (se 8.7.3).
- En **inskuren vågform** ("aktivitetspuls", EKG-liknande) klipps ut ur formen via en SVG-`mask` (`logo.tsx:19-31`) — en `polyline` (`points="7,27.5 15,27.5 16.5,27 18.5,22.5 18.8,22.5 21,27.5 22,32.5 23.5,27.5 33,27.5"`, `stroke-width="3"`, `stroke-linecap="butt"`, `stroke-linejoin="miter"`) som löper genom stammens mittlinje (y=27.5) och sticker ut genom båda sidorna av stammen — en topp/dal centrerad på x=20. Detta är den enda grafiska detaljen utöver bokstavsformen: ett T som samtidigt läses som ett pulsslag/aktivitetsdiagram, en direkt visuell koppling till appens syfte.
- Formen är AVSIKTLIGT inte fristående — den fungerar som bokstaven "T" i ordet "TrainingLab" (se 8.7.3), inte som ett oberoende ikon-märke som även ska kunna stå för sig själv i löpande text.

#### 8.7.2 Färg — två olika regler, redan så koden fungerar

| Sammanhang | Källa | Värde |
|---|---|---|
| I appen (React, `Logo`/`LogoWordmark`) | Tailwind-klass `fill-accent` på `<path>` (`logo.tsx:34`) | **Tema-medveten — INTE en fast färg.** Resolves till `--accent` för vilket av de 6 temana (Forest/Ocean/Ember/Slate/Sky/Mono) × ljust/mörkt läge som är aktivt, exakt samma princip som all annan UI-färg i appen. Loggan ska kunna anta vilken som helst av appens accentfärger — den byter färg automatiskt när användaren byter tema, det är arkitekturen, inte en bugg eller en avgränsning. |
| Statisk (favicon, PWA-ikon) | `public/icon.svg` (samma path/mask, hårdkodad `fill`) + genererade PNG:er (`icon-16/32/48/64/128/192/512.png`, `public/manifest.json`) | **Fast hex, `#6EE7B7`** (mintgrön) — den ENDA platsen där märket inte kan vara tema-medvetet, av en hård teknisk begränsning: faviconer/PWA-ikoner renderas av OS:et/webbläsaren helt utanför appens CSS-kontext och kan inte läsa `--accent`. Samma värde står även som `theme_color` i `manifest.json:8`; `background_color: #0F1117` (`manifest.json:7`) är PWA-splashskärmens bakgrund. |

Wordmark-texten har sin egen regel: "raining" använder `text-primary` (tema-medveten brödtextfärg), "Lab" använder `text-accent` (samma tema-medvetna accent som märket) — `logo.tsx:69`.

**Verifierat: märket i samtliga 6 temans ljusa accentfärg** (hämtat direkt ur `app/globals.css`, inte gissat) — exakt de färger `fill-accent` resolves till beroende på vilket tema användaren har valt i Settings → Appearance:

| Tema | `--accent` (ljust läge) | Hex |
|---|---|---|
| Forest | `app/globals.css:10` | `#059669` (grön) |
| Ocean | `app/globals.css:45` | `#0284C7` (blå) |
| Ember | `app/globals.css:72` | `#EA580C` (orange) |
| Slate | `app/globals.css:100` | `#2563EB` (blå, annan nyans än Ocean) |
| Sky ("Sand" i UI:t, se §4.4) | `app/globals.css:145` | `#7C3AED` (violett) |
| Mono | `app/globals.css:172` | `#18181B` (nästan svart) |

Märket har alltså aldrig EN färg — det har sex, beroende på användarens temaval, plus tolv om man räknar mörkt läge. Visualiserat i [FRONTEND_VISUAL_PROFILE_2026_06_27.html](FRONTEND_VISUAL_PROFILE_2026_06_27.html) §00 (samtliga 6 ljusa varianter sida vid sida, inte bara Forest som tidigare versioner av detta dokument visade).

#### 8.7.3 Lockup — märke + ordmärke

- **Fullständig lockup** (`LogoWordmark`): `[T-märke]rainingLab` — märket fungerar som bokstaven T, texten "rainingLab" följer direkt efter utan mellanrum. Font: Inter, `font-semibold` (600), `tracking-tight`, `leading-none`.
- **Endast märke** (`Logo` ensam, eller `public/icon.svg`): används där utrymmet är kvadratiskt/för litet för text — favicon, PWA-ikon, hopfälld sidopanel.
- Mellanrummet mellan märke och text är en uträknad funktion av storleken, inte ett fast värde: `logoPullIn(size) = -(size × 0.20)`, applicerad som negativ högermarginal på märket (`logo.tsx:52-54`) — kalibrerad för att matcha det visuella mellanrummet mellan "r" och "a" i "rainingLab". Textens `fontSize = size × 0.52`, `paddingBottom = size × 0.03`.
- **Baslinje-justering (fixad 2026-07-01):** T-stammens SVG-path sträcker sig till y=40 (viewBox-kant). Med `align-items:flex-end` på flex-behållaren (`LogoWordmark`, `sidebar.tsx`) alignas SVG-rektangelns underkant med textspannens underkant — och eftersom T:ets visuella underkant *är* SVG-rektangelns underkant (stamen går till y=40) delar T:et och texten exakt samma visuella "golv". Inga extra marginaler behövs. Notera: ett tidigare felaktigt försök (2026-06-30) lade till `marginBottom = size × 0.05` på SVG:n — detta ökade gapet istället för att minska det (texten skjöts nedåt, ej T:et uppåt) och återkallades.

#### 8.7.4 Storlekar i faktisk användning

| Plats | Komponent | Storlek |
|---|---|---|
| Sidopanel (huvudnavigering) | `Logo` + `LogoText` separat, för att kunna fälla in texten | `LOGO_SIZE = 30` (`components/sidebar.tsx:26`) |
| Login / Register / Pending (hero) | `LogoWordmark` | `64` (`app/(auth)/login/page.tsx:40` m.fl.) |
| Favicon / webbläsarflik / PWA-ikon | statisk raster, `public/icon-*.png` | 16, 32, 48, 64, 128, 192, 512px |

#### 8.7.5 Clearspace och minsta storlek — NY regel, fyller en lucka koden inte definierar idag

Ingenstans i koden finns en explicit regel för minsta tillåtna storlek eller fritt utrymme runt märket — varje anropsställe väljer en `size` ad-hoc (om än alla redan rimliga). Föreslagen, minimal, additiv regel — ändrar inget befintligt anropsställe eftersom alla redan ligger inom intervallet:

- **Minsta storlek:** 16px (matchar den minsta redan existerande faviconstorleken `icon-16.png`) — under denna storlek blir vågforms-urklippet i stammen otydligt.
- **Clearspace:** minst 25 % av märkets storlek som fritt utrymme på alla sidor (t.ex. 8px fritt utrymme runt en 32px-logga) — standardmönster i märkesspecifikationer, förhindrar att loggan trycks ihop mot kant/innehåll.

#### 8.7.6 Vad som INTE ska ändras

Per §8.0:s princip rörs loggans FORM inte i något av §8:s förslag. Färgen ändras inte heller utöver det som redan är fallet (tema-medveten `fill-accent`) — om §8.2:s nya `--feature`-token någonsin appliceras på varumärkeselement är det ett separat, ej beslutat förslag, inte en del av denna spec.

#### 8.7.7 Teknisk anmärkning (2026-06-30): SVG-`mask` renderade fel i PDF, inte i appen — gäller ENDAST denna profil-artefakt

Märket använder en SVG-`mask` för att klippa ut vågformen (`logo.tsx:19-31`, se 8.7.1) — det fungerar korrekt i den riktiga appen (React/webbläsare) och har INTE rörts. Men i [FRONTEND_VISUAL_PROFILE_2026_06_27.html](FRONTEND_VISUAL_PROFILE_2026_06_27.html)/`.pdf` återskapades samma mask-teknik för att visa loggan i dokumentet — och Chromiums "print to PDF" (som `page.pdf()` i Playwright använder för att generera PDF:en, se §8.6) renderade masken fel specifikt i PDF-exporten, ett känt svagt område för SVG-`mask` i Chromiums skriv-ut-väg. Fixat **endast i artefakten** genom att byta till en mask-fri teknik som ger identiskt visuellt resultat: rita "T"-formen fylld i målfärgen, rita sedan vågforms-`polyline`n OVANPÅ i vitt (`stroke="#fff"`) istället för att klippa ut den via en mask — fungerar identiskt på en vit/ljus kortbakgrund, utan att bero på mask-stöd i PDF-rendering. Detta är en ren artefakt-detalj, inte en ändring av loggans riktiga konstruktion eller en rekommendation att ändra `logo.tsx` — den riktiga komponenten behöver inte och ska inte ändras.

## 9. Regressionsgranskning — verifierat mot resten av appen innan implementation

På uttrycklig begäran: hela planen (§2–§8) gicks igenom punkt för punkt mot den faktiska kodbasen för att hitta allt som ett förslag skulle kunna förstöra på ett annat ställe. Två research-pass (sport-/palett-spårning, layout-/font-/ikon-/diagramspårning) användes för att verifiera varje förslag med riktiga fil:rad-citat, inte antaganden. Tre förslag visade sig behöva korrigeras innan implementation; resten verifierades säkra som skrivna.

### 9.1 §4.1 var i praktiken ett dött förslag — `--sport-*` används ingenstans

Grep mot hela kodbasen hittade **noll** komponenter som läser `var(--sport-run)` etc. — variablerna i `app/globals.css:17-22` är helt oanvända (orphanade). `WeeklyVolumeChart.tsx` och `volume-client.tsx` har, som §4.5 redan visade, sina egna helt separata hårdkodade kopior — de läser aldrig CSS-variabeln, råkar bara historiskt ha haft samma startvärde i ett av fallen. Att "fixa" §4.1 genom att ändra `globals.css` hade alltså inte synts någonstans i den körande appen. **Konsekvens:** §4.1:s kontrastarbete är inte bortkastat, men målet flyttas — de korrigerade hex-värdena (5.3–7.2:1) ska in som default/fallback-konstant i den nya delade färghjälparen §4.5 beskriver (se 9.2), inte som en CSS-variabeländring. De gamla `--sport-*`-variablerna bör städas bort vid implementation snarare än uppdateras, för att inte lämna kvar ännu en död, vilseledande källa.

### 9.2 RETRAKTERAD av användaren: en tredje sportfärg-källa hittades, men ska FÖRENAS, inte lämnas — se §4.6

**Detta avsnitt påstod ursprungligen** att `lib/planner/colors.ts`s `workoutColor()`/`activityColor()`/`sportOnlyColor()` (driver aktivitetslistan, aktivitetsdetaljsidan och planner-kalenderns pills) var ett avsiktligt separat system som inte skulle förenas med `SportCategory.color`, av rädsla för informationsförlust (tävlingsmarkering) och färgkollision. **Användaren rättade detta direkt:** planner, historik och aktiviteter ska visa exakt samma sport-/typfärg som ställs in i Settings — precis som diagrammen, inte ett fjärde separat visuellt språk. Det var ett antagande jag gjorde själv, inte ett bekräftat produktbeslut — fel av mig att dra slutsatsen utan att fråga.

Spårade om hela kedjan efter rättningen (alla anropsställen till de fyra funktionerna, vad varje plats redan har laddat) innan jag skrev en ny rekommendation — se den fullständiga, utökade lösningen i **§4.6**. Kort sammanfattat: planner-sidans anropsställen har redan den riktiga `sport.color`/`type.color` inladdad (inga nya databasfrågor behövs, bara sluta ignorera vad som redan finns i scope) — och tävlingsgult visade sig **redan** existera som en riktig, delad, redigerbar `WorkoutType` ("Race", `#FBBF24`, `isShared: true`) i databasen, vilket löser precis den oro jag ursprungligen hade: ingen informationsförlust, ingen kollisionsrisk, tävlingar får en egen inställbar färg istället för en hårdkodad konstant. Aktiviteter/Historik kräver en namnslagning mot `SportCategory`/`WorkoutType` (samma mönster som §4.5:s diagramfix) eftersom `Activity` saknar en riktig databasrelation.

### 9.3 §4.2, §5.1, §5.2 — verifierade säkra, inga ändringar i planen

- **§4.2** (Slate-light `--warning`/`--error` mörkare): 15+ Tailwind-klasskonsumenter (`text-warning`, `bg-error/10` m.fl.) hittades över hela appen — ingen hårdkodar hex eller gör en JS-kontrastberäkning mot det exakta värdet. Säker att ändra isolerat i `.scheme-slate`.
- **§5.1** (sidebar tap-targets `p-2`→`p-3`, `p-1.5`→`p-3`): ingen fast-pixel-layout i närheten bryts — hamburgerknappen sitter fritt i hörnet, stäng-knappen ligger i en flex-rad (`items-end`) som redan tål varierande knappstorlek.
- **§5.2** (coach-sidofältets default-state): ingen annan logik (fetch, scroll, analytics) är kopplad till `sidebarOpen`s initiala värde — rent visuell ändring.

### 9.4 §8.3 — strokeWidth-detaljen korrigerad (se rättningen i §8.3 ovan)

Ursprungstexten påstod "en enda propändring i `ICON_SIZE`-konstanterna"; verifierat felaktigt — noll call-sites sätter `strokeWidth` idag, så `ICON_SIZE` styr aldrig linjebredd. Rätt fix är en global CSS-regel mot Lucides `lucide`-klass, inte en kod-konstant. Se §8.3 för den rättade texten.

### 9.5 §8.4 — gradientfyllning avgränsad bort från TSB och den inverterade scatter-axeln (se rättningen i §8.4 ovan)

`TrainingLoadChart.tsx`s TSB-linje korsar legitimt noll och är streckad — en gradient ner mot botten hade sett trasig ut. `WeatherPaceScatterChart.tsx` har en inverterad Y-axel där gradientriktningen hade känts bakvänd. Båda undantagna explicit i §8.4; `SleepTrendChart.tsx` och övriga alltid-positiva trendgrafer är oförändrat säkra.

### 9.6 Inget annat i §2–§7 (UX/mobil-fynden) påverkades

Resten av granskningen (§2, §3, §6, §7) beskriver bara redan uppmätt nuvarande beteende eller en explicit "rör INTE"-lista — inget regressionsarbete krävdes där eftersom de inte föreslår kodändringar i sig, bara dokumenterar fynd som redan validerats mot faktisk kod när de skrevs.

## 10. Slutgiltig, enhetlig färgspecifikation (tillagd 2026-06-29)

### 10.0 Bakgrund och avgränsning

Efter flera punktfixar (§4.5/§4.6) gav användaren en fullständig, definitiv regelbok för hur sport-/typ-/tävlings-/workout-färger ska fungera i hela appen. Detta avsnitt:

1. Stämmer av varje regel mot faktisk kod (2026-06-29) — flera delar visar sig **redan** vara klara, vilket korrigerar §4.5/§4.6:s status (se §10.1 och de inline-korrigeringarna ovan).
2. Specificerar de delar som fortfarande saknas, med konkreta fil:rad-ändringar.
3. Lägger till TVÅ helt nya krav som inte fanns i §4.5/§4.6: (a) en väljbar, per-sport koppling i Settings för "vilken typ representerar Stravas generiska 'workout'-flagga", och (b) automatisk skapelse av en ny `SportCategory` när Strava rapporterar en sportType användaren inte har konfigurerat än.

Användarens regler, ordagrant omsatta till krav:

- **Settings**: skapa sporter, redigera deras typer och färger. *(redan byggt — se §10.1)*
- **Planner**: sporter visas med sin sportfärg; har passet en typ ska typens färg användas istället.
- **Activities/History**: aktiviteter visas med sportens färg; flaggan `race` → tävlingsfärgen; flaggan `workout` (Stravas egen) → färgen från EN av sportens konfigurerade typer, valbar och ändringsbar i Settings (per sport).
- **Auto-skapande**: en ny sport från Strava som saknas i Settings skapas automatiskt när den aktiviteten hämtas.
- **Dashboard/Statistics**: alla relevanta grafer ska matcha sportens Settings-färg.

### 10.1 Status per regel — kodverifierat 2026-06-29

| Regel | Status | Bevis |
|---|---|---|
| Settings: skapa sport, redigera typer/färger | ✅ Klart | `sports-manager.tsx` (hela filen) + `app/api/sports/route.ts` — full CRUD, redan i produktion |
| Planner: sportfärg, typfärg om typ finns | ✅ Klart (fixat under denna session, av en parallell sesssion) | Commit `c465fbe` ("fix: planner/stats sport colors ignored Settings...") fixade write-sidan (`WorkoutBuilder.tsx:205`s `autoColor`, `planner-client.tsx`s `handleAddTemplateToDate()`) att spara `type.color ?? sport.color` istället för `workoutColor(...)`, läs-sidan (`TemplateCard.tsx`, 2 av 3 ställen i `week/page.tsx`), plus en ny engångsbackfill (`/api/planner/backfill-workout-colors`, auto-körd en gång per användare via `planner-client.tsx`) som rättar redan existerande `PlannedWorkout`/`WorkoutTemplate`-rader. `WorkoutPill.tsx:45`/`week/page.tsx`s tredje ställe behöll medvetet `workout.color ?? workoutColor(...)` — korrekt nu eftersom skrivsidan + backfillen garanterar att `.color` faktiskt stämmer, se anmärkning nedan |
| Activities/History: sportfärg + tävlingsfärg | ✅ Klart | `resolveActivityColor()` (`lib/planner/colors.ts:156-182`), använd av `activity-list.tsx`, `history-client.tsx`, och `activities/[id]/page.tsx` — samma commit (`c465fbe`) stängde två kvarvarande luckor (`TypePicker.tsx`, `activities/[id]/page.tsx`) som 2026-06-28d:s fix missat |
| Activities/History: workout-flagga → VÄLJBAR typfärg | ❌ Saknas | Dagens `inferTypeName()` (`colors.ts:79-82`) gissar bucket-namnet `"intervall"` via regex mot typNAMN (`TYPE_BUCKET_PATTERNS`, `colors.ts:112-117`), och bara för Run (`workoutType === 3`) — ingen explicit, valbar koppling finns, och Ride-workout (Stravas `12`) hanteras inte alls. Opåverkad av `c465fbe` — ingen av de två nya kraven i detta §10 fanns i den sessionens scope |
| Auto-skapande av ny sport från Strava | ❌ Saknas | `mapActivity()` (`lib/strava/sync.ts:8-42`) sparar bara `raw.sport_type` som fritext (rad 15) — ingen kod söker eller skapar en `SportCategory`-rad. Opåverkad av `c465fbe`, samma skäl som ovan |
| Dashboard: grafer matchar Settings-färg | ➖ Inget att fixa idag | `app/(dashboard)/dashboard/page.tsx` har idag ingen sport-färgkodad graf alls (verifierat — inga träffar på `sportColors`/`SportCategory`/diagram-komponenter i filen) |
| Statistics: grafer matchar Settings-färg | ✅ Klart (fixat under denna session, av en parallell session) | Samma commit `c465fbe`: `app/(dashboard)/stats/page.tsx` och `app/(dashboard)/stats/volume/page.tsx` bygger nu en riktig `sportColors`-karta från `prisma.sportCategory.findMany()` och skickar den till `WeeklyVolumeChart`/`VolumeClient` — som en bieffekt hittades och fixades även en namnmatchnings-bugg ("Skiing" vs det seedade `"Nordic Skiing"`) |

**Viktig rättelse av denna plans egen forskning, upptäckt mitt under skrivandet av detta avsnitt:** en tidigare version av §10.1/§10.5 påstod att diagramfixen redan fanns sedan mega-sessionen `b780714` (2026-06-16) och att §4.5:s "inte implementerad"-slutsats (skriven 2026-06-27) därför var fel redan när den skrevs. Det var en felidentifiering — `git log`/`git status` visade vid närmare kontroll att en **parallell session** (samma dag som detta dokument skrivs, 2026-06-30) just då hade okommitterade ändringar i exakt de filer som undersöktes, vilket fick arbetsträdet att se "redan fixat" ut innan den sessionen committat. Den sessionen committade strax efter som `c465fbe`, vilket bekräftar den verkliga tidslinjen: §4.5/§4.6:s "inte implementerad"-status var KORREKT när den skrevs (2026-06-27 respektive 2026-06-28d) — det är bara nu, 2026-06-30, som båda är faktiskt klara, av en annan session än den som skriver detta §10. `IMPLEMENTATION_PLAN.md`s "Session 2026-06-30"-post (skriven av den parallella sessionen) beskriver fixen i detalj och är den auktoritativa källan för vad som faktiskt ändrades.

### 10.2 NY datamodell: väljbar "workout"-typfärg per sport

Lägg till ett fält på `SportCategory` (`prisma/schema.prisma:216-228`):

```prisma
model SportCategory {
  ...
  workoutFlagTypeId String?
  workoutFlagType   WorkoutType? @relation("WorkoutFlagType", fields: [workoutFlagTypeId], references: [id])
  ...
}

model WorkoutType {
  ...
  flaggedBySport SportCategory[] @relation("WorkoutFlagType")
  ...
}
```

`workoutFlagTypeId` pekar på EN av sportens egna `WorkoutType`-rader (valideras i API:t att `workoutType.sportId === sport.id`, inte som DB-constraint) — "den typ som ska visas när Strava taggar ett pass som ett generiskt 'workout'", t.ex. en löpare kan välja sin "Intervall"-typ, en cyklist sin "Hård"-typ. Nullable: om inte satt, falla tillbaka till dagens regex-gissning (`TYPE_BUCKET_PATTERNS`) så befintliga användare inte tappar färg förrän de medvetet väljer ett alternativ.

**Vad räknas som "workout-flaggan" från Strava** — `workout_type`-fältet är sportspecifikt i Stravas API:

| Sport | Default | Race | Workout (generiskt, icke-tävling) | Annat |
|---|---|---|---|---|
| Run | `0`/`null` | `1` | `3` | `2` = Long Run (ej hanterad idag, ej i scope) |
| Ride | `10` | `11` | `12` | — |
| Övriga sporter | `null` | Strava ger ingen `workout_type` för de flesta andra sporter | — | — |

Dagens kod (`sync.ts:33`: `isRace: raw.workout_type === 1`) känner bara igen Run-tävlingar — missar Ride-tävlingar (`11`). Och `inferTypeName()` (`colors.ts:79-82`) känner bara igen Run-workout (`3`) — missar Ride-workout (`12`). **Föreslagen, minimal utökning** (samma mönster, bara fler värden):

```ts
const RACE_WORKOUT_TYPES = new Set([1, 11]);
const GENERIC_WORKOUT_TYPES = new Set([3, 12]);
```

i `lib/strava/sync.ts` (för `isRace`) och `lib/planner/colors.ts` (för `inferTypeName`/den nya väljbara kopplingen). Detta är en sidoeffekt-fix av samma rotorsak (workout_type-tolkning), inte ett nytt scope-område — flagga för verifiering vid implementation enligt `CLAUDE.md`s Bug Audit Practice eftersom det ändrar `isRace`-beräkning för cykeltävlingar (en befintlig användare med en taggad cykeltävling kan se den ändra färg/status första gången koden körs — önskvärt, men värt att nämna explicit i validering, §10.7).

### 10.3 Settings UI-tillägg: välj workout-flaggans typ per sport

`sports-manager.tsx` — i sportens header-rad (nära `{sport.workoutTypes.length} types`, rad 205) eller i den expanderade vyn (rad 245+), lägg till en liten dropdown: "Workout-flagga visar: [dropdown av sportens egna typer, + 'Standard (gissa)']" bunden till `sport.workoutFlagTypeId`. Anropet återanvänder samma mönster som `updateSport()` (rad 92-99). Utöka `sportUpdateSchema` (`app/api/sports/route.ts:14-19`) med `workoutFlagTypeId: z.string().cuid().optional().nullable()`, och i PATCH-handlern (rad 114-125) validera att om satt, det refererade `WorkoutType.sportId === id` innan update (annars `400`).

### 10.4 Auto-skapande av ny SportCategory från Strava

Ny delad funktion, t.ex. `ensureSportCategoryExists(userId: string, sportType: string, activityName: string, existingSports: SportCategory[])` i `lib/strava/sync.ts`, som:

1. Tar emot användarens redan inläsa `SportCategory[]` (med `workoutTypes`) — hämtad EN gång per synk-anrop (inte per aktivitet) för att undvika en extra databasfråga i varje loop-iteration.
2. Återanvänder EXAKT samma matchningslogik som `resolveActivityColor()` redan har (`matchSportCategory()`, `colors.ts:123-138` — inkl. OL-namnigenkänning och `STRAVA_SPORT_MAP`-alias). **Exportera `matchSportCategory` från `lib/planner/colors.ts`** istället för att duplicera matchningen, så Aktiviteter/Historik och auto-skapandet alltid är överens om vad som räknas som "samma sport".
3. Om ingen träff: skapar en ny `SportCategory` med:
   - `name`: `sportType` rakt av (Stravas sträng, t.ex. `"TrailRun"`, `"Workout"`) — ingen omskrivning; användaren kan döpa om i Settings efteråt.
   - `color`: `workoutColor(sportType, null)` (den statiska, redan sport-medvetna fallback-paletten, `colors.ts:39-65`) — ger en rimlig startfärg istället för en återanvänd preset-färg.
   - `icon`: `"run"` — samma hårdkodade default som manuell sport-skapelse redan använder (`sports-manager.tsx:73`); ingen ny inkonsekvens.
   - `isRunningRelated`: `true` om `/run|trail|virtual/i.test(sportType)`, annars `false` — samma regex som redan avgör "running" på andra ställen (`colors.ts:55`).
   - `order`: `(max befintlig order) + 1`.
   - Skapar också sportens delade "Race"-typ direkt (samma kod som `app/api/sports/route.ts:68-83` kör vid manuell sport-skapelse), så den nya sporten inte saknar en tävlingstyp tills användaren råkar öppna Settings.
4. Anropas, guardat av `!exists`/`!existing` (samma boolean varje sync-väg redan beräknar för att avgöra "är detta en genuint ny aktivitet"), från alla tre create-vägarna i `lib/strava/sync.ts`:
   - `syncActivities()` — innan `prisma.activity.upsert(...)` på rad 102, inuti `if (!exists)`-blocket (rad 85-94).
   - `resyncRecentActivities()` — innan `prisma.activity.create(data)` på rad 180, inuti `if (!existing)`-blocket (rad 178-182).
   - `syncSingleActivity()` — innan `prisma.activity.upsert(...)` på rad 236, guardat av `exists`-checken på rad 234.

   Körs bara en gång per genuint ny aktivitet (inte vid varje resync av en redan synkad aktivitet) — exakt samma `!exists`/`!existing`-mönster som redan finns i alla tre funktioner.

### 10.5 Korrigeringar till §4.5/§4.6 och `IMPLEMENTATION_PLAN.md` (dokument-/kod-avstämning)

Per `CLAUDE.md` ("om kod och dokumentation skiljer sig, är dokumentationen fel och måste rättas omedelbart"):

- §4.5:s slutsats "diagrammen ignorerar `SportCategory.color` helt" och den ursprungliga §6-prioritetstabellens rad 7 ("redan ett verifierat, levande fel") var korrekta när de skrevs (2026-06-27) och förblev korrekta ända till 2026-06-30, då en **parallell session** (samma dag som detta §10 skrivs, oberoende av den session som skriver det) fixade exakt detta — committat som `c465fbe`. Inline-korrigering tillagd direkt i §4.5 och §6 ovan; se §10.1 för den fullständiga, kodverifierade statusen och den självkorrigering som skedde mitt i research-arbetet för detta avsnitt.
- §4.6:s statusrad är korrigerad inline på samma grund — Planner-delen den beskrev som kvarstående är nu också klar, samma commit.
- Planner-tabellen i §4.6 (rad 99-109, ursprungliga radnummer) är nu helt inaktuell som att-göra-lista (alla call sites där korrekta efter `c465fbe`) men kan lämnas som historik för hur call site-kedjan såg ut innan fixen.
- `IMPLEMENTATION_PLAN.md`s "Session 2026-06-30"-post (skriven av den parallella sessionen, direkt ovanför där denna sessions egen post läggs till) är den auktoritativa, detaljerade källan för exakt vad `c465fbe` ändrade — §10.1 sammanfattar bara det som är relevant för färgspecifikationen.

### 10.6 Filer som ändras (kvarstår efter `c465fbe` — bara de TVÅ nya kraven i §10.2-§10.4; allt annat i denna fil är redan klart)

- `prisma/schema.prisma` — `SportCategory.workoutFlagTypeId` + omvänd relation på `WorkoutType`
- `app/api/sports/route.ts` — `sportUpdateSchema` + PATCH-validering för `workoutFlagTypeId`
- `app/(dashboard)/settings/sports/sports-manager.tsx` — dropdown för workout-flaggans typ per sport
- `lib/planner/colors.ts` — exportera `matchSportCategory`; lägg till `GENERIC_WORKOUT_TYPES`; utöka `inferTypeName`/lägg en gren i `resolveActivityColor()` som kollar `sport.workoutFlagTypeId` FÖRE regex-bucket-fallbacken
- `lib/strava/sync.ts` — `RACE_WORKOUT_TYPES`/`GENERIC_WORKOUT_TYPES`-utökning av `isRace`; ny `ensureSportCategoryExists()`, anropad från alla tre sync-vägar
- `docs/schemas/sport-colors.md` (ny fil — saknas idag) — dokumenterar hela kedjan: Settings → `SportCategory`/`WorkoutType.color` → `resolveActivityColor()`/Planner-resolvern → varje sidas render, plus workout-flagg-kopplingen och auto-skapande-regeln

### 10.7 Validering

1. **Settings**: skapa en ny sport manuellt, sätt en färg, lägg till två typer med egna färger, välj en av dem som "workout-flagga visar" — bekräfta att valet sparas och visas efter en sidladdning.
2. **Activities/History — race**: synka/markera en aktivitet som tävling, bekräfta att den visar samma färg som den delade "Race"-typen i Settings, och att ändring av den färgen i Settings omedelbart syns på aktiviteten. (Regressionstest — redan klart per §10.1, inte ny funktionalitet.)
3. **Activities/History — workout-flagga**: hitta eller simulera en aktivitet med Stravas `workout_type=3` (Run) eller `12` (Ride), bekräfta att den FÖRST visar den nya valbara typfärgen om `workoutFlagTypeId` är satt för sporten, annars faller tillbaka till dagens regex-gissning. Byt vilken typ som är vald i Settings, bekräfta att aktivitetens färg ändras direkt.
4. **Auto-skapande**: simulera (eller vänta på) en riktig Strava-synk av en sport-typ som inte finns i användarens Settings — bekräfta att en ny `SportCategory`-rad dyker upp i Settings efter synk, med en rimlig startfärg och en egen "Race"-typ, INTE en duplicerad rad om sporten redan fanns under ett alias (`STRAVA_SPORT_MAP`) eller via OL-namnigenkänning.
5. **Planner/Statistics/Dashboard**: ändra en sports färg i Settings, bekräfta att Planner-kalendern, veckovyn, Volume-fliken och Overview-flikens kvick-graf alla omedelbart visar den nya färgen. (Regressionstest mot `c465fbe` — redan klart per §10.1, inte ny funktionalitet i detta §10.)
6. `pnpm build --no-lint` utan TypeScript-fel.
7. Kör `prisma db push` (additivt fält, ingen migration-fil i detta projekt) och verifiera att befintliga `SportCategory`-rader får `workoutFlagTypeId = null` utan att något annat påverkas.

### 10.8 Slutinstruktion till implementerande agent

Bygg ENDAST §10.2-§10.4 — väljbar workout-flaggfärg per sport och auto-skapande av ny `SportCategory` från Strava. Allt annat i §10.1:s statustabell är redan klart (commit `c465fbe`, 2026-06-30) och ska INTE röras eller "fixas" igen. Verifiera §10.2:s `RACE_WORKOUT_TYPES`/`GENERIC_WORKOUT_TYPES`-utökning explicit med en riktig cykel-tävlingsaktivitet om en sådan finns i datan, eftersom det är den enda ändringen här som rör en befintlig beräkning (`isRace`) snarare än att bara lägga till ny funktionalitet. Läs `IMPLEMENTATION_PLAN.md`s "Session 2026-06-30"-post innan du börjar, så den nya koden bygger vidare på samma mönster (`resolveActivityColor()`, `matchSportCategory()`, det redan etablerade backfill-mönstret) istället för att uppfinna ett parallellt. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` med en ny sessionspost och skapa `docs/schemas/sport-colors.md` enligt §10.6. Arkivera INTE denna fil förrän även §4:s ursprungliga kontrast-/mobilfynd (§5–§7) och §8:s visuella profil är hanterade eller medvetet avskrivna — den här filen täcker flera oberoende delar av samma UX-revision, inte bara färgsystemet.
