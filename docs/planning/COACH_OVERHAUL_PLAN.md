# AI Coach — Fullständig arkitekturöversyn

**Status:** Inväntar godkännande  
**Scope:** Agentic loop, full databasåtkomst (alla tabeller), externa tools (websök/väder), reversibla skrivningar, språkpersistens  
**Berörda filer:** Se avsnitt 11

---

## 1. Identifierade buggar

### Bugg A — Tool aktiveras på fel frågor
Tool-beskrivningen `get_fitness_summary` innehåller *"Use this at the start of a coaching conversation"* — triggas på varje nytt meddelande.  
**Fix:** Ta bort frasen. Beskriv vad verktyget returnerar, inte när det ska anropas.

### Bugg B — Språk återställs vid varje sidladdning
`useState<"en" | "sv">("en")` — aldrig sparat i databasen.  
**Fix:** `coachLanguage` i `AISettings`.

### Bugg C — Tool-resultat blandar sv/en
**Fix:** Alla tool-resultatsträngar standardiseras till engelska.

### Bugg D — Systemprompt ger motstridiga instruktioner
"Use tools proactively" + snapshot med samma data = onödiga tool-anrop.  
**Fix:** Beskrivande systemprompt (vad finns var) istället för föreskrivande (när du får/inte får anropa).

### Bugg E — UI-text på engelska i en svensk app
Quick-start-prompter och tool-labels.

---

## 2. Kärnförändring: Agentic loop

### 2.1 Problemet med nuvarande arkitektur

```
Nuvarande:
  User → [EN tool-call] → stream svar

Nödvändig för "nu vs för ett år sedan":
  User → [search_activities nuläge] → [search_activities år sedan]  ← parallellt
        → [get_wellness_history nuläge] → [get_wellness_history år sedan]  ← parallellt
        → [get_volume_stats] → [get_zone_distribution]
        → stream djupanalys med all data
```

Utan agentic loop är en djup komparativ analys omöjlig. AI:n kan bara se data från EN tool-call åt gången.

### 2.2 Ny arkitektur: Multi-step parallel agentic loop

```
User message
     ↓
[Agentic loop — max 6 iterationer]
     ↓
  Iteration 1:
    Claude beslutar → [tool_A, tool_B, tool_C] (parallellt)
    Promise.all([exec(A), exec(B), exec(C)])
    Skicka alla resultat tillbaka till Claude
     ↓
  Iteration 2:
    Claude beslutar → [tool_D, tool_E] (baserat på vad den fick)
    Promise.all([exec(D), exec(E)])
    Skicka resultat
     ↓
  Iteration 3:
    Claude bestämmer: "Jag har tillräckligt"
    stop_reason = "end_turn"
     ↓
[Stream final response med all context]
     ↓
UI visar alla tool-cards (A, B, C, D, E) + det streamade svaret
```

### 2.3 Implementationsdetaljer

**`app/api/coach/chat/route.ts`** — ersätt nuvarande tool-check-block:

```typescript
// ── Agentic loop ─────────────────────────────────────────────────────────────
// Replaces the single tool-check. Claude may call multiple tools per iteration,
// and multiple iterations before it has enough data to answer.

const agentMessages: AnthropicMessage[] = messages.map(m => ({
  role: m.role as "user" | "assistant",
  content: m.content,
}));

const allToolEvents: ToolEvent[] = [];
const MAX_ITERATIONS = 6;  // Prevents runaway loops

for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,   // Tool planning: small, fast
    tools: COACH_TOOLS as any,
    tool_choice: { type: "auto" },
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: agentMessages,
  });

  if (response.stop_reason !== "tool_use") break; // AI is satisfied with data

  const toolUses = response.content.filter(b => b.type === "tool_use") as ToolUseBlock[];

  // Write tools require approval — pause loop, return to UI
  const writeTool = toolUses.find(tu => WRITE_TOOLS.has(tu.name));
  if (writeTool) {
    allToolEvents.push({
      name: writeTool.name,
      message: describeAction(writeTool.name, writeTool.input as Record<string, unknown>),
      success: true,
      pending: true,
      pendingInput: writeTool.input as Record<string, unknown>,
    });
    break;
  }

  // CRITICAL: append full response.content (not just text) before tool results
  agentMessages.push({ role: "assistant", content: response.content });

  // Execute ALL read tools in parallel
  const toolResults = await Promise.all(
    toolUses.map(async (tu) => {
      const result = await executeCoachTool(
        tu.name,
        tu.input as Record<string, unknown>,
        userId,
        convId!,
      );
      allToolEvents.push({ name: tu.name, message: result.message, success: result.success, editId: result.editId, undoable: !!result.editId });
      return { id: tu.id, result };
    })
  );

  // Feed ALL results back in one user turn
  agentMessages.push({
    role: "user",
    content: toolResults.map(tr => ({
      type: "tool_result" as const,
      tool_use_id: tr.id,
      content: String(tr.result.data ?? tr.result.message),
    })),
  });
}
```

**Sedan:** Stream svar med `agentMessages` (som nu innehåller alla tool-anrop och resultat).

### 2.4 Gemini — parallella function calls

Gemini Flash stöder function calling men inte native parallel tool_use. Lösning:

```typescript
// Gemini agentic loop (samma struktur, anpassad syntax)
for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
  const result = await chat.sendMessage(currentUserContent);
  const fcParts = result.response.candidates?.[0]?.content.parts.filter(p => "functionCall" in p);
  
  if (!fcParts?.length) break; // done
  
  // Execute in parallel
  const results = await Promise.all(fcParts.map(async (p) => {
    const fc = p.functionCall!;
    const res = await executeCoachTool(fc.name, fc.args as Record<string, unknown>, userId, convId!);
    allToolEvents.push({ name: fc.name, message: res.message, success: res.success });
    return { name: fc.name, result: res };
  }));
  
  // Feed all function responses back
  currentUserContent = results.map(r => ({
    functionResponse: { name: r.name, response: { result: String(r.result.data) } }
  }));
}
```

### 2.5 Vad förändras i UI för agentic loop

Ett meddelande kan nu ha **flera tool-cards** — en per anrop i loopen.

```typescript
// ChatInterface: message har toolActions[], inte en enda toolAction
interface Message {
  ...
  toolActions?: ToolAction[];  // ← ändras från toolAction? till toolActions?
}

// Varje ToolAction renderas som ett kort ovanför svaret
{msg.toolActions?.map((ta, i) => (
  <ToolActionCard key={i} action={ta} language={language} ... />
))}
```

Tool-cards emitteras fortlöpande via SSE under loop-exekveringen (inte bara i slutet):
```typescript
// I stream-SSE: emit varje toolEvent direkt när det exekveras
for (const toolEvent of allToolEvents) {
  controller.enqueue(encoder.encode(
    `data: ${JSON.stringify({ toolCall: toolEvent })}\n\n`
  ));
}
```

---

## 3. Externa tools

### 3.1 Web search — `web_search`

**Tjänst:** Tavily API (tavily.com)  
**Pris:** Gratis upp till 1 000 sökningar/månad. $25/mån för 10 000.  
**Varför Tavily:** Byggt specifikt för AI-agenter, returnerar rena textexcerpt optimerade för LLM-konsumtion. Inga HTML/JS att parsa.

```typescript
{
  name: "web_search",
  description: "Search the web for current information relevant to training: recent research on training methodology, injury information, race event schedules, course records, nutrition science, or anything not available in the training database. Use when the athlete asks about external information or when training advice benefits from up-to-date science.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      focus: { type: "string", description: "Optional context: 'science' | 'race_events' | 'injury' | 'nutrition' | 'general'" },
    },
    required: ["query"],
  },
}
```

**Executor:**
```typescript
case "web_search": {
  const TAVILY_KEY = process.env.TAVILY_API_KEY;
  if (!TAVILY_KEY) return { success: false, message: "Web search not configured", data: "error: no Tavily API key" };
  
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_KEY,
      query: input.query as string,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,    // Tavily synthesizes an answer
    }),
  });
  const data = await res.json() as { answer?: string; results: { title: string; url: string; content: string }[] };
  const summary = [
    data.answer ? `Summary: ${data.answer}` : "",
    ...data.results.map(r => `[${r.title}](${r.url})\n${r.content.slice(0, 300)}`),
  ].filter(Boolean).join("\n\n");
  return { success: true, message: `Web search: ${input.query}`, data: summary };
}
```

**Miljövariabel:** `TAVILY_API_KEY` i `.env.local`

### 3.2 Väderprognos — `weather_forecast`

**Tjänst:** Open-Meteo forecast API (samma som vi redan använder för historik)  
**Pris:** Gratis, ingen API-nyckel  
**Use case:** Coachen kan kolla vädret för ett planerat pass och rekommendera kläder/intensitet

```typescript
{
  name: "weather_forecast",
  description: "Fetch weather forecast for the athlete's location for the next 7 days. Use when discussing upcoming training conditions, whether to run indoors/outdoors, race day weather, or adjusting intensity based on heat/cold/wind.",
  input_schema: {
    type: "object",
    properties: {
      days: { type: "number", description: "How many days ahead (1–7, default 3)" },
      date: { type: "string", description: "Specific date YYYY-MM-DD (optional, overrides days)" },
    },
  },
}
```

**Executor:** Hämtar lat/lng från atletprofil (om satt) eller från det senaste aktivitetets `startLat`/`startLng`. Anropar `https://api.open-meteo.com/v1/forecast` med `daily` parametrar: temperatur, vindstyrka, nederbördsandel, UV-index.

**Obs:** Kräver att atletprofilen har koordinater, eller att vi hämtar dem från senaste aktivitet.

### 3.3 Strava-segment history — `get_segment_history`

Vi har redan Strava OAuth-tokens och kan anropa Strava API:et.

```typescript
{
  name: "get_segment_history",
  description: "Fetch the athlete's personal history on a specific Strava segment — all their efforts with time, date, and rank. Use when athlete mentions a specific segment (e.g. 'Tisdagsbana', 'Sörmlandsleden uppförsbacken') or asks how their performance on a recurring route has changed.",
  input_schema: {
    type: "object",
    properties: {
      segment_id: { type: "string", description: "Strava segment ID" },
      segment_name: { type: "string", description: "Segment name to search for if ID unknown" },
      limit: { type: "number", description: "Max efforts to return (default 10)" },
    },
  },
}
```

**Executor:** Anropar Strava `/v3/segments/{id}/all_efforts` med användarens access token (hämtas från `StravaAccount` i databasen, refreshas om utgånget). Returnerar sorterad lista av insatser med datum och tid.

### 3.4 Vetenskaplig forskning — `search_training_research`

**Tjänst:** PubMed Entrez API (National Library of Medicine)  
**Pris:** Gratis, ingen API-nyckel för grundläggande sökning  
**Use case:** Atleten frågar om forskning: "Vad säger vetenskapen om polariserad träning?", "Hur påverkar sömn HRV?"

```typescript
{
  name: "search_training_research",
  description: "Search PubMed for peer-reviewed research on endurance training, physiology, recovery, and nutrition. Use when the athlete asks about the scientific evidence behind a training approach or when making recommendations that benefit from research support.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Research topic, e.g. 'polarized training VO2max', 'HRV recovery sleep'" },
      max_results: { type: "number", description: "Max papers to return (default 3, max 5)" },
    },
    required: ["query"],
  },
}
```

**Executor:** `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=...&retmax=5` → fetch abstracts via `efetch.fcgi`. Returnerar titel + abstract + DOI-länk.

---

## 4. Fullständig databaskartering och tool-täckning

Alla tabeller mot tools:

| Tabell | Innehåll | Tool |
|---|---|---|
| `Activity` | Strava-pass (splits, HR, tempo, höjd, väder) | `search_activities`, `get_activity_detail`, `get_activities_in_range`, `analyze_full_history` |
| `ActivityStream` | Sekund-för-sekund HR, tempo, kraft, kadens | **NY:** `get_activity_stream` |
| `GarminDailySummary` | HRV, sömn, viloHR, body battery, stress, SpO₂, steg, readiness | `get_readiness` (utökas), **NY:** `get_wellness_history` |
| `PlannedWorkout` | Planerade pass med mål, status, missad-orsak | `get_upcoming_plan`, `create_workout`, `delete_workout`, **NY:** `update_workout` |
| `TrainingBlock` | Träningsblock: typ, volymål, faktisk km/TSS, completion rate | `get_training_blocks`, **NY:** `create_training_block`, `update_training_block` |
| `RaceRecord` | Tävlingsresultat och PBs | `get_race_history`, **NY:** `log_race_result`, `delete_race_result` |
| `AthleteProfile` | Vikt, ålder, maxHR, viloHR, LT1/LT2, mål, paceunit | Read via snapshot, **NY:** `get_athlete_profile`, `update_profile` (befintlig) |
| `FitnessCache` | VO2max, VDOT, CTL/ATL/TSB, ACWR, zoner, veckovolym-JSON, zonJSON, polarisationJSON, VDOT-trend, kritisk hastighet, W' | `get_fitness_summary` (utökas — exponerar ALL data) |
| `WorkoutTemplate` + `WorkoutSection` | Träningsmallar med sektioner (intervaller, uppvärmning, osv.) | **NY:** `get_workout_templates` |
| `WorkoutType` + `SportCategory` | Användarens sporttyper och träningstyper | **NY:** `get_workout_types` |
| `TrainingGoal` | Årliga km/timmål per sport | **NY:** `get_training_goals` |
| `StravaAccount` | Strava OAuth-tokens | Används internt av `get_segment_history` |
| `AppConfig`, `User`, `Session`, `AISettings` | Kontoinformation | **Aldrig exponeras för AI** |

**Komplett tool-lista: 22 tools**

| # | Tool | Typ | Källa |
|---|---|---|---|
| 1 | `search_activities` | Read | DB |
| 2 | `get_activity_detail` | Read | DB |
| 3 | `get_activities_in_range` | Read | DB |
| 4 | `analyze_full_history` | Read | DB |
| 5 | `get_activity_stream` | Read | DB |
| 6 | `get_upcoming_plan` | Read | DB |
| 7 | `get_fitness_summary` | Read | DB (FitnessCache, allt) |
| 8 | `get_race_history` | Read | DB |
| 9 | `get_readiness` | Read | DB (Garmin, 7 dagar) |
| 10 | `get_wellness_history` | Read | DB (Garmin, upp till 90 dagar) |
| 11 | `get_training_blocks` | Read | DB |
| 12 | `get_volume_stats` | Read | DB (FitnessCache.weeklyVolumeJson) |
| 13 | `get_zone_distribution` | Read | DB (FitnessCache.zoneSecondsJson) |
| 14 | `get_workout_templates` | Read | DB |
| 15 | `get_workout_types` | Read | DB |
| 16 | `get_training_goals` | Read | DB |
| 17 | `get_athlete_profile` | Read | DB |
| 18 | `get_segment_history` | Read | Strava API |
| 19 | `web_search` | Read | Tavily API (extern) |
| 20 | `weather_forecast` | Read | Open-Meteo API (extern) |
| 21 | `search_training_research` | Read | PubMed API (extern) |
| 22 | `create_workout` | Write | DB |
| 23 | `update_workout` | Write | DB |
| 24 | `delete_workout` | Write | DB |
| 25 | `update_profile` | Write | DB |
| 26 | `create_training_block` | Write | DB |
| 27 | `update_training_block` | Write | DB |
| 28 | `log_race_result` | Write | DB |
| 29 | `delete_race_result` | Write | DB |
| 30 | `update_activity_notes` | Write | DB |

---

## 5. Reversibla skrivningar — undo-arkitektur

### 5.1 Ny databasmodell: `CoachEdit`

```prisma
model CoachEdit {
  id                String   @id @default(cuid())
  userId            String
  conversationId    String
  toolName          String
  description       String
  previousStateJson Json?
  newStateJson      Json?
  entityId          String?
  entityType        String?
  status            String   @default("applied")  // "applied" | "undone"
  appliedAt         DateTime @default(now())
  undoneAt          DateTime?
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, conversationId])
}
```

### 5.2 Undo-flöde

1. **Write tool exekveras** → sparar `previousStateJson` → skapar `CoachEdit` → returnerar `editId`
2. **`editId` skickas till UI** via SSE i `toolCall`-eventet
3. **Ångra-knapp visas** i tool-card om `undoable: true`
4. **Användaren klickar Ångra** → POST `/api/coach/undo/:editId` → restore från `previousStateJson`
5. **Nästa meddelande skickas** → alla `undoable: true` sätts till `false` i UI-state

### 5.3 Restore-logik per entity

| entityType | toolName | Restore-operation |
|---|---|---|
| `PlannedWorkout` | `create_workout` | Delete |
| `PlannedWorkout` | `update_workout` | Restore alla fält från previous |
| `PlannedWorkout` | `delete_workout` | Återskapa från previous |
| `AthleteProfile` | `update_profile` | Restore fält från previous |
| `TrainingBlock` | `create_training_block` | Delete |
| `TrainingBlock` | `update_training_block` | Restore fält |
| `RaceRecord` | `log_race_result` | Delete |
| `RaceRecord` | `delete_race_result` | Återskapa |
| `Activity` | `update_activity_notes` | Restore `description` fält |

### 5.4 UI-ändringar

`toolActions?: ToolAction[]` på Message-interfacet (plural, för agentic loop).

`ToolAction` interface:
```typescript
interface ToolAction {
  name: string;
  message: string;
  success: boolean;
  pending?: boolean;
  pendingInput?: Record<string, unknown>;
  editId?: string;
  undoable?: boolean;
}
```

Ångra-knapp i `ToolActionCard`:
```tsx
{!action.pending && action.undoable && (
  <button onClick={() => handleUndo(action.editId!)}
    className="text-xs text-warning hover:underline">
    Ångra
  </button>
)}
```

Lås undo när nästa meddelande skickas (i `sendWithPayload`):
```typescript
setMessages(prev => prev.map(m => ({
  ...m,
  toolActions: m.toolActions?.map(ta => ({ ...ta, undoable: false })),
})));
```

---

## 6. Systemprompt — beskrivande, inte föreskrivande

Ny tool-use-sektion (AI väljer autonomt, inga förbud):

```
## Available data & tools

**Already in this snapshot — no tool needed:**
- Current VO2max, VDOT, CTL, ATL, TSB, HR zones, training paces
- Race personal bests (top PBs by distance)  
- Last 7-day health summary: HRV trend, sleep, body battery, readiness
- Last 5 completed sessions with pace and HR
- This week's and last week's training volume (km)
- Upcoming 14-day training plan and upcoming races

**Fetch with tools (not in snapshot):**
Training data: search_activities · get_activity_detail · get_activities_in_range ·
  analyze_full_history · get_activity_stream · get_fitness_summary · get_volume_stats ·
  get_zone_distribution · get_race_history

Health data: get_readiness · get_wellness_history

Planning data: get_upcoming_plan · get_training_blocks · get_workout_templates ·
  get_workout_types · get_training_goals · get_athlete_profile

External: web_search · weather_forecast · get_segment_history · search_training_research

Actions (require user approval): create_workout · update_workout · delete_workout ·
  create_training_block · update_training_block · log_race_result · delete_race_result ·
  update_activity_notes · update_profile

For comparative questions ("now vs a year ago", "summer vs winter training"), call tools
for BOTH periods in the same iteration — fetch in parallel to save time.
```

---

## 7. Kontextberikning i systemprompten

Lägg till i `buildCoachContext`:

**Senaste 5 genomförda pass:**
```
Mon 16 Jun: Easy Run (Run) — 10.2km · 5:42/km · 138bpm
Sat 14 Jun: Long Run (Run) — 18.4km · 5:58/km · 141bpm
```

**Veckostatus:**
```
This week: 34km  |  Last week: 52km
```

Dessa minskar behovet av tool-anrop för enkla frågor.

---

## 8. Språkpersistens

**Schema:** `coachLanguage String @default("sv")` i `AISettings`  
**API:** `PATCH /api/settings/ai` accepterar `coachLanguage`  
**UI:** Toggle i tools-menyn sparar till DB (fire-and-forget PATCH)  
**Initialisering:** Server-side prop → `useState(initialLanguage)`

**Systemprompt-instruktion:**
```
## Language
${language === "sv"
  ? "Always respond in Swedish. Translate all data labels and tool output into Swedish in your response."
  : "Always respond in English."}
```

---

## 9. Tool picker UI

**Labels på svenska** (komplett karta i `ChatInterface.tsx`):

```typescript
const TOOL_LABELS: Record<string, { sv: string; en: string; desc_sv: string }> = {
  get_fitness_summary:       { sv: "Träningsstatus",            desc_sv: "VO2max, CTL, zoner, löpförutsägelser" },
  get_race_history:          { sv: "Tävlingshistorik & PBs",    desc_sv: "Alla personbästa per distans" },
  get_readiness:             { sv: "Dagsform",                   desc_sv: "HRV, sömn, viloHR, TSB" },
  get_training_blocks:       { sv: "Träningsblock",              desc_sv: "Nuvarande och kommande träningsblock" },
  get_upcoming_plan:         { sv: "Kommande plan",              desc_sv: "Planerade pass nästa 14 dagar" },
  search_activities:         { sv: "Sök träningspass",           desc_sv: "Hitta pass via nyckelord, datum, sport" },
  get_activity_detail:       { sv: "Detaljerat pass",            desc_sv: "Splits, HR, bästa insatser" },
  get_activity_stream:       { sv: "Passström (sekund-data)",    desc_sv: "HR/tempo/kraft sekund-för-sekund" },
  get_activities_in_range:   { sv: "Pass i datumintervall ⚠",    desc_sv: "Alla pass med full data — kostnadskontroll" },
  analyze_full_history:      { sv: "Historikanalys (multi-år)",  desc_sv: "Aggregerad statistik upp till 5 år" },
  get_wellness_history:      { sv: "Hälsohistorik (Garmin)",     desc_sv: "HRV, sömn, stress dag för dag" },
  get_volume_stats:          { sv: "Volymstatistik",             desc_sv: "Km/tid/TSS per vecka per sport" },
  get_zone_distribution:     { sv: "Zontidsfördelning",          desc_sv: "Tid i Z1–Z5, polarisationsindex" },
  get_workout_templates:     { sv: "Träningsmallar",             desc_sv: "Sparade pass med sektionsstruktur" },
  get_workout_types:         { sv: "Passtyper & sporttyper",     desc_sv: "Användardefinierade pass- och sporttyper" },
  get_training_goals:        { sv: "Träningsmål",                desc_sv: "Årsvolymmål per sport och progress" },
  get_athlete_profile:       { sv: "Atletprofil (fullständig)",  desc_sv: "Alla profilfält inkl. LT1/LT2" },
  get_segment_history:       { sv: "Strava-segmenthistorik",     desc_sv: "Alla insatser på ett specifikt segment" },
  web_search:                { sv: "Websökning",                  desc_sv: "Söker aktuell information på webben" },
  weather_forecast:          { sv: "Väderprognos",               desc_sv: "Väder nästa 7 dagar för träningsplanering" },
  search_training_research:  { sv: "Träningsforskning (PubMed)", desc_sv: "Vetenskapliga studier om träning" },
  create_workout:            { sv: "Lägg till träningspass",     desc_sv: "Planera ett nytt pass" },
  update_workout:            { sv: "Redigera träningspass",      desc_sv: "Ändra ett befintligt planerat pass" },
  delete_workout:            { sv: "Ta bort träningspass",       desc_sv: "Ta bort ett planerat pass" },
  create_training_block:     { sv: "Skapa träningsblock",        desc_sv: "Nytt Bas/Build/Peak/Taper-block" },
  update_training_block:     { sv: "Redigera träningsblock",     desc_sv: "Ändra datum, mål eller fokus" },
  log_race_result:           { sv: "Logga tävlingsresultat",     desc_sv: "Lägg till ett tävlingsresultat manuellt" },
  delete_race_result:        { sv: "Ta bort tävlingsresultat",   desc_sv: "Radera ett tävlingsresultat" },
  update_activity_notes:     { sv: "Redigera passbeskrivning",   desc_sv: "Uppdatera anteckningar för ett pass" },
  update_profile:            { sv: "Uppdatera profil",           desc_sv: "Vikt, mål, träningsår, maxHR" },
};
```

**Quick-start-prompter** baserade på valt språk.

---

## 10. Buggaudit (utförs efter implementation)

### Audit A — Agentic loop, parallell datahämtning
Fråga: *"Jämför min träning nu med för ett år sedan"*

Förväntat beteende:
1. Iteration 1: Parallella anrop till `search_activities` för nuläge + `search_activities` för samma period för ett år sedan
2. Iteration 2 (baserat på vad den fick): `get_wellness_history` för nuläge + `get_wellness_history` för år sedan
3. Eventuellt iteration 3: `get_volume_stats`
4. Svar: djupgående komparativ analys med all data

Kontrollera:
- Att **minst 2** tool-cards visas för detta meddelande (parallell fetch)
- Att analysen faktiskt refererar till data från BÅDA perioderna
- Att loopen stannar inom 6 iterationer

### Audit B — Externa tools
1. *"Vad säger forskningen om HRV och intensitetsreglering?"* → `search_training_research` → PubMed-resultat → vetenskaplig analys
2. *"Är det värt att springa hårt på torsdag?"* → `weather_forecast` + `get_readiness` parallellt → rekommendation med väder och återhämtningsdata
3. *"Hur har min tid på Tisdagsbana förändrats?"* → `get_segment_history` med segment-ID → trendanalys

### Audit C — Undo-flöde
Testa alla write-tools med ångra och verifiera att databastillståndet återställs korrekt.

### Audit D — Autonom tool-selektion
Fråga: *"Är du kompetent som tränare?"* → Inget tool-anrop, direkt svar.  
Fråga: *"Vad är mitt VO2max?"* → Inget tool (finns i snapshot).  
Fråga: *"Vilka träningsmallar har jag?"* → `get_workout_templates`.

### Audit E — Språkpersistens
Sätt SV → ladda om → fortfarande SV. Alla cards och labels på svenska. AI svarar på svenska oavsett om tool-data är på engelska.

### Audit F — Skrivningssäkerhet
Verifiera att write-tools ALDRIG exekveras utan godkännande, även om AI:n anropar dem i en iteration av agentic loopen. Godkännandeprompten måste alltid visas.

---

## 11. Berörda filer

| Fil | Ändring |
|---|---|
| `prisma/schema.prisma` | `coachLanguage` i `AISettings`; ny `CoachEdit`-modell |
| `app/api/settings/ai/route.ts` | Acceptera `coachLanguage` |
| `app/api/coach/chat/route.ts` | **Ersätt single-tool-check med agentic loop** för alla providers; skicka multiple toolEvents; `toolActions[]` i SSE |
| `app/api/coach/undo/[editId]/route.ts` | **NY** — undo-endpoint |
| `app/(dashboard)/coach/page.tsx` | Läs `coachLanguage`, skicka som prop |
| `components/coach/ChatInterface.tsx` | `toolActions[]` istället för `toolAction`; language init + persist; TOOL_LABELS-karta; ångra-knapp; lås undo vid nytt meddelande; quick-prompts baserade på språk |
| `lib/ai/tools.ts` | Justera befintliga beskrivningar; 12 nya tools (7 read + 5 write); standardisera strängar; WRITE_TOOLS-set; Tavily/PubMed/Strava executors |
| `lib/ai/prompts.ts` | Ny tool-use-sektion; recent-sessions + veckostatus; språkinstruktion |
| `lib/ai/context-builder.ts` | Senaste 5 sessions, veckostatus, utökad Garmin |
| `.env.local` | Lägg till `TAVILY_API_KEY` |

**Schemat kräver `prisma db push` + `prisma generate` på produktion.**

---

## 12. Vad som INTE ändras

- Streamingarkitekturen (SSE) — oförändrad (loopen körs innan stream startar)
- AI-provider-stöd (Claude/Gemini/NVIDIA/Groq) — alla implementerar samma loop-struktur
- Approval-gate för write-tools — oförändrad logik
- Konversationshistorik och kostnadsräkning
- Strava skrivs inte tillbaka (aktivitetsanteckningar är lokala)
- `AppConfig`, `User`, `AISettings`, `Session` exponeras aldrig för AI

---

*Inväntar godkännande. Inga ändringar implementerade.*
