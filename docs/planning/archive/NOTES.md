# TrainingLab — Notes

Living document for bugs, feature requests, and future investigations.
Add new items at the top of each section.
Format: `- [ ] Description — *context / repro steps if bug*`

---

## Features

- [ ] **Mobil-UX — fullständig mobilanpassning**: E1 (kollapsbar sidebar med hamburger) och E2 (responsiva stats-grids) implementerade 2026-05-25. Kvar: E3 (responsiva tabeller), E4 (padding-finjustering), E5 (touch drag-and-drop i planner).

- [x] **Activity History — klickbara aktiviteter**: Implementerat 2026-05-25. Varje aktivitetskort i dag-detaljpanelen är nu en `<Link>` till `/activities/[id]`. Extern Strava-länk tillagd.

- [x] **Planner — kopiera/flytta pass mellan dagar**: Implementerat 2026-05-25. Befintliga pass i kalendern är nu draggable och kan dras till en annan dag. Drop blockeras på historiska dagar.

- [x] **Laps-tabell — lap time och kumulativ elapsed tid**: Implementerat 2026-05-25. Nya kolumner: "Lap time" (moving_time per lap) och "Elapsed" (kumulativ tid fram till och med det lappet).

- [x] **Best efforts i aktivitetsdetalj**: Implementerat 2026-05-25. Visar Stravas best_efforts (5k, 10k etc.) som tabell under splits-tabellen.

- [x] **Performance charts — distans/tid-växling på x-axeln**: Implementerat 2026-05-25. Knapp att växla x-axeln mellan Distance och Time.

- [x] **Activity History — planner-liknande UI**: Implementerat 2026-05-25. Dag-celler visar sport-pills med namn och distans (liknar WorkoutPill). Uppdaterat dag-detaljpanel.

- [ ] **Ny HR-zon estimator (data-driven)**: Undersök KDE på pulsdistribution, K-Means clustering, aerob dekoppling. Implementera som separat estimator-knapp vid sidan av nuvarande. Se Gemini-analysen i git-historiken (commit med NOTES.md). Framtida session.

---

## Bugs

- [x] **HR-zondiagram tooltip — svart text på mörk bakgrund**: Fixat 2026-05-25. Lade till `color: "var(--text-primary)"` i `contentStyle` på Recharts `<Tooltip>` i `HRZonesChart.tsx`, `WeeklyVolumeChart.tsx`, `TrainingLoadChart.tsx`.

- [x] **Splits chart — bars saknas för korta laps**: Fixat 2026-05-25. Sänkte distansgränsen från 200 till 10 meter i `splits-chart.tsx`.

- [x] **Info-tooltips — döljs bakom annat element**: Fixat 2026-05-25. `MetricTooltip` använder nu `fixed` positionering via `getBoundingClientRect()` istället för `absolute`.

- [x] **Planner — drag/drop blockeras ej på historiska dagar**: Fixat 2026-05-25. `onDragOver` och `onDrop` returnerar tidigt om `isPast`.

- [x] **Chat-sidebar scroll-isolering**: Fixat 2026-05-25. Coach-sidan använder nu `h-screen` (was `h-full`) för korrekt höjd-kedja.

---

*Uppdaterad: 2026-05-25*
