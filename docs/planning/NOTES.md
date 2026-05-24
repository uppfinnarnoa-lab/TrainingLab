# TrainingLab — Notes

Living document for bugs, feature requests, and future investigations.
Add new items at the top of each section.
Format: `- [ ] Description — *context / repro steps if bug*`

---

## Features

- [ ] **Mobil-UX — fullständig mobilanpassning**: Undersök och implementera ett mobilanpassat UI/UX för hela appen. Identifiera vilka vyer som saknar responsiv layout (kalender, stats-grafer, planner, aktivitetsdetalj). Prioritera navigation och de vanligaste vyerna. Kan göras i etapper.

- [ ] **Activity History — klickbara aktiviteter**: Gör varje aktivitetsrad/-kort i `history-client.tsx` klickbar så att man navigerar till `/activities/[id]`. Sidan `/activities/[id]` finns redan — det saknas bara en länk från historyvyn. Lägg till `href={/activities/${a.id}}` (eller `<Link>`) på aktivitetskortet/raden. Lägg ev. till extern Strava-länk (`https://www.strava.com/activities/${a.stravaId}`) bredvid.

---

## Bugs

- [ ] **HR-zondiagram tooltip — svart text på mörk bakgrund**: Tooltip-rutan i donut-diagrammet för HR-zoner (Stats → Fitness) har mörk bakgrund med mörk text. Texten syns knappt. Fixa genom att sätta `color: "white"` (eller `var(--text-primary)`) i `contentStyle` på Recharts `<Tooltip>` — leta i `stats-client.tsx` efter `<Tooltip` nära zondiagrammet.

---

*Uppdaterad: 2026-05-24*
