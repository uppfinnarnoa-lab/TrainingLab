# Frontend UX-revision: kontrast, mobilanvändbarhet, riktade brister

**Status:** Research/audit klar — redo för granskning, **inga kodändringar gjorda än** (ren plan, enligt uttrycklig önskan)
**Skapad:** 2026-06-27

## 1. Mål och avgränsning

Detta är **inte** en redesign. Uttrycklig instruktion från användaren: behåll temat, statistikfokuset, trovärdighetskänslan, precisionen och minimalismen som finns idag — ändra bara det som faktiskt är en brist, framförallt på mobil. `frontend-design`-skillen (`@claude-plugins-official`) är installerad men dess process ("ta en estetisk risk", omarbeta typografi/palett/layout) är **inte** vad detta dokument tillämpar, eftersom den processen är till för att bygga ny visuell identitet, inte för att punktfixa en redan fungerande. Detta dokument är istället en konkret UX/tillgänglighets-revision: varje fynd nedan är mätt eller verifierat i faktisk kod, inte en estetisk åsikt.

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

### 4.1 Systembrist: fyra sportfärger klarar inte 3:1 i NÅGOT ljust tema

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

`app/globals.css:122-139` — kommentarsblocket ovanför temat heter "Theme: Sand" och har forskningsanteckningar som refererar till "Sand"-paletten, men CSS-selektorn är `.scheme-sky` (rad 140) och hela resten av kodbasen (`ColorScheme` typ, `COLOR_SCHEMES`-array, mobildefault-kommentaren i `color-scheme-provider.tsx:23`) kallar det "sky". Temat döptes om vid något tillfälle men kommentaren glömdes. Noll användarpåverkan — ren kodhygien, en enrads-omdöpning av kommentaren om man råkar vara i filen av annan anledning.

## 5. Mobilanvändbarhet

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

## 7. Explicit utanför scope

Per instruktion: ingen ändring av temapalett som helhet, ingen ny typografi, ingen layoutomarbetning av sidor som redan fungerar (dashboard-kort, stats-gridet, aktivitetsfiltren, login-kortet) och inget arbete drivet av `frontend-design`-skillens "ta en estetisk risk"-process. Allt ovan är riktade fixar mot mätta brister, inte en designöversyn.
