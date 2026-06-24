# Implementera gratis Kimi-modell som AI-coach-provider

**Status:** SUPERSEDED 2026-06-24 — implementerad på ett enklare sätt än denna plan beskriver. Arkiverad oimplementerad som skriven; se notis nedan.
**Skapad:** 2026-06-23

---

## ⚠️ Superseded 2026-06-24 — implementerad utan ny provider

Denna plans research (§2) missade en väg: **Kimi K2.5 (nyare än K2/K2.6, 1T-param multimodal, 256K context) finns hostad direkt på NVIDIA NIM** — samma `https://integrate.api.nvidia.com/v1`-endpoint och samma `NVIDIA_API_KEY` som appens BEFINTLIGA NVIDIA-provider (`lib/ai/nvidia.ts`) redan använder för Llama/Mistral. NVIDIAs gratis-tier är numera (sedan kreditsystemet fasades ut tidigt 2025) en löpande hastighetsbegränsad gratis-nivå (40 RPM, inget kort, ingen daglig hård gräns) — inte en engångskredit-trial. Det betyder Kimi-tillgång kunde läggas till som **en enda ny rad i den redan existerande `NVIDIA_MODELS`-arrayen**, istället för att bygga en helt ny 5:e provider via OpenRouter (ny klient, nytt schema-fält, ny UI-sektion, ternary-kedjor i chat/calibrate-routes) som denna plan beskriver i §3.

**Verifierat (webbsökning, inte gissat) 2026-06-24:**
- Bas-URL: `https://integrate.api.nvidia.com/v1` (identisk med befintlig integration)
- Modell-id: `moonshotai/kimi-k2.5`
- Samma API-nyckel som övriga NVIDIA-modeller redan i appen
- NVIDIAs gratis-tier: löpande 40 RPM, inget kort — **ingen daglig hård gräns**, till skillnad från OpenRouters Kimi `:free`-varianter (denna plans §5b flaggar själv 50 req/dag som ett verkligt problem för en aktiv coach-chatt)

**Vad som faktiskt implementerades** (`lib/ai/nvidia.ts`, `app/(dashboard)/settings/ai-settings.tsx`, `docs/integrations/strava.md`, `prisma/schema.prisma`-kommentar): `moonshotai/kimi-k2.5` tillagd i `NVIDIA_MODELS` och satt som ny `NVIDIA_DEFAULT_MODEL`; jämförelsetabellens NVIDIA-rad uppdaterad. Se `docs/planning/IMPLEMENTATION_PLAN.md` för sessionsposten.

**Kvar att göra om OpenRouter-vägen ändå blir relevant:** om Kimi K2.5 någon gång tas bort från NVIDIA NIM, eller om en användare specifikt vill ha K2.6:free (262K context) eller en modell NVIDIA inte hostar, är denna plans §3-§5b fortfarande en giltig, mer komplex väg dit — arkiveras här som referens, inte borttagen.

**Uppdatering 2026-06-24f:** Exakt detta hände — NVIDIA pensionerade `kimi-k2.5` helt (404, ingen redirect) ungefär en dag efter att den lades till. Löst utan OpenRouter-vägen: NVIDIA hostar redan efterträdaren **Kimi K2.6** (`moonshotai/kimi-k2.6`) på samma endpoint/nyckel, så `NVIDIA_MODELS`/`NVIDIA_DEFAULT_MODEL` uppdaterades i stället. Se sessionsposten i `IMPLEMENTATION_PLAN.md` för detaljer, inklusive en ny `resolveNvidiaModel()`-fallback i `lib/ai/nvidia.ts` som självläker om NVIDIA pensionerar ännu en modell-id utan förvarning.

---

## 1. Mål

Lägg till **Kimi K2** (Moonshot AI) som ett femte, gratis val i AI Coach-providerlistan (idag: Claude, Gemini, NVIDIA NIM, Groq — `app/(dashboard)/settings/ai-settings.tsx:121-126`).

## 2. Research: var är Kimi K2 faktiskt gratis? (verifierat juni 2026, inte gissat)

Tre kandidatvägar undersöktes:

| Väg | Verkligt gratis? | Slutsats |
|---|---|---|
| **Moonshots eget API** (`platform.moonshot.ai`) | ❌ Nej | Kräver minst $1 laddning för att aktivera kontot ("recharge $1 to activate") innan API:et fungerar alls — inte en gratis-nyckel-och-kör-modell trots vissa SEO-sidors påstående om "1000 req/dag gratis". |
| **Groq** (redan integrerad i appen för Llama, `lib/ai/groq.ts`) | ❌ Nej för Kimi specifikt | Groqs no-card free-tier (30 RPM/6K TPM/1K RPD) listar uttryckligen Llama/Qwen/DeepSeek-R1/Whisper — **inte** Kimi K2. Kimi K2 på Groq har explicit per-token-prissättning ($1/$3 per M tokens), dvs. den ligger bakom Groqs betalda Dev-tier, inte gratistiern. |
| **OpenRouter** (`openrouter.ai`) | ✅ **Ja** | `moonshotai/kimi-k2:free` (ursprungliga K2, 0711) och `moonshotai/kimi-k2.6:free` (april 2026, 262K context, multimodal) är bekräftat $0/token. Inget kreditkort krävs för att skapa API-nyckel. Rate limit: **20 req/min, 50 req/dag** utan någon laddning någonsin (ökar till 1000/dag om man någon gång laddat ≥$10 totalt — ovidkommande för en gratis-väg men bra att veta). 50/dag räcker gott för en enskild användares coach-chatt + framtida pass-sammanfattning (jfr. plan för pass-sammanfattning, max några ggr/dag). |

**Slutsats:** Den enda äkta gratis vägen är **OpenRouter**, inte Moonshot direkt och inte Groq. Implementera Kimi-providern med OpenRouter som bakomliggande transport.

⚠️ Modelldetaljer i detta fält ändras snabbt (nya K2.x-versioner släpps löpande). Verifiera exakta modell-ID:n på `openrouter.ai/models?q=kimi` **vid implementationstillfället**, inte bara genom att lita på denna plan — lista nedan är vad som var bekräftat tillgängligt 2026-06-23.

## 3. Hur det passar in i befintlig arkitektur

Appen har redan EXAKT detta mönster två gånger (`lib/ai/groq.ts`, `lib/ai/nvidia.ts`): OpenAI SDK (`openai`-paketet, redan en dependency) pekat mot en custom `baseURL`, eftersom både Groq och NVIDIA NIM exponerar OpenAI-kompatibla chat-completions-endpoints. OpenRouter gör likaså (`baseURL: "https://openrouter.ai/api/v1"`). Detta blir alltså en **fjärde kopia av samma 70-radersmönster**, inte ett nytt arkitektoniskt koncept.

### Ny fil: `lib/ai/kimi.ts`
Kopiera `lib/ai/groq.ts` rakt av, ändra:
```ts
export const KIMI_MODELS = [
  { id: "moonshotai/kimi-k2:free",   label: "Kimi K2 (0711, stabil, agentic)" },
  { id: "moonshotai/kimi-k2.6:free", label: "Kimi K2.6 (262K context, multimodal)" },
] as const;
export const KIMI_DEFAULT_MODEL = "moonshotai/kimi-k2:free";

export class KimiClient implements AIClient {
  readonly provider = "kimi" as const;
  constructor(apiKey: string, model = KIMI_DEFAULT_MODEL) {
    this.client = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
    ...
  }
  // stream(): identisk med GroqClient, men UTAN stream_options:{include_usage:true}
  // (Groq-specifikt för att få usage-data i streamen — verifiera om OpenRouter
  // har en motsvarighet eller om input/output-tokens måste räknas separat/uppskattas).
}
```

### Filer som måste röras (exakt samma platser som när Groq lades till — verifierat genom grep, inte gissat):

- **`prisma/schema.prisma`** (`AISettings`, rad 373-394) — `provider String @default("gemini")`: uppdatera kommentar; lägg till `kimiApiKey String?`, `kimiModel String?`.
- **`lib/ai/client.ts`** — `AIClient.provider`-union: lägg till `"kimi"`. `estimateCost()`: kimi ska ge 0 (gratis) — funktionen defaultar redan till 0 för okända providers, men **verifiera detta explicit i koden, lita inte på antagandet**.
- **`app/api/settings/ai/route.ts`** — zod-schema rad 8: lägg till `"kimi"` i `z.enum([...])`; lägg till `kimiApiKey`/`kimiModel` i body-schema + destructuring + `data.*`-tilldelning (rad 37-46).
- **`app/api/coach/chat/route.ts`** — verifierat rad-för-rad (inte bara grep-träffar):
  - rad 61-67: `apiKey`-val, en 4-stegs ternary-kedja claude/nvidia/groq/gemini.
  - rad 82-83: budget/spend-bypass, en ternary som testar `provider === "nvidia" OR provider === "groq"` och annars `0` — förekommer två gånger (budget + current spend).
  - rad 270: ett `if`-villkor (`provider === "nvidia" OR provider === "groq"`) som styr ett separat, enstaka tool-call-anrop innan streamingen — se §6 för en viktig risk specifikt här.
  - rad 273-274: `baseURL`/`model`-val — **binära ternaries**, inte en enkel OR-kedja att bara lägga till i. Se §6 för rekommenderad refaktor till en uppslagstabell istället för att nästla en tredje gren.
  - rad 339-343: `AIClient`-instansiering, samma binära ternary-mönster som ovan.
  - längre ner: `modelUsed`-loggningen och `updateSpend`-bypass-villkoret (sök på `"groq"` för att hitta exakta rader — radnummer kan ha driftat sedan denna plan skrevs).
- **`app/api/coach/calibrate/route.ts`** — samma typ av ternaries för apiKey/baseURL/klient på motsvarande rader — sök på `"nvidia"`/`"groq"` istället för att lita på radnummer.
- **`app/(dashboard)/settings/ai-settings.tsx`** — lägg till "Kimi"-knapp i providerlistan (rad 121-126, sub-text t.ex. "Free · Kimi K2, 50/dag"), ny sektion för API-nyckel + modellväljare (mirror NVIDIA/Groq-sektionerna rad 296-374), uppdatera jämförelsetabellen (rad 162-200).
- **`docs/integrations/ai-setup.md`** — lägg till ett Kimi/OpenRouter-avsnitt: hur man skapar OpenRouter-konto + API-nyckel (ingen betalning krävs), samma stil som befintliga Gemini-instruktioner.

## 4. UX-text att vara tydlig om

I providerjämförelsetabellen (`ai-settings.tsx`) och i `docs/integrations/ai-setup.md`, var explicit att detta är **"Kimi K2 via OpenRouter"** — användaren skapar ett konto på openrouter.ai (inte moonshot.ai) och hämtar sin API-nyckel där. Annars är risken stor att användaren går till fel ställe (Moonshots egen plattform) och fastnar på "recharge $1 to activate"-kravet som inte gäller den gratisvägen som faktiskt implementeras.

## 5b. Kritisk granskning (andra researchpasset)

- **Ternary-kedjorna i `chat/route.ts` skalar dåligt till en tredje fri provider — refaktorera istället för att bara lägga till en gren.** Rad 273-274 (`baseURL`/`model`-val) och rad 339-343 (klient-instansiering) är idag BINÄRA ternaries (`provider === "nvidia" ? X : Y`) byggda för exakt två fria providers. Att klistra in en tredje gren (`? X : provider==="groq" ? Y : Z`) gör koden svårläst och felbenägen. Rekommendation: extrahera en liten uppslagstabell:

  ```ts
  const FREE_OPENAI_COMPAT_PROVIDERS = {
    nvidia: { baseURL: "https://integrate.api.nvidia.com/v1", defaultModel: NVIDIA_DEFAULT_MODEL, ClientCtor: NvidiaClient },
    groq:   { baseURL: "https://api.groq.com/openai/v1",      defaultModel: GROQ_DEFAULT_MODEL,   ClientCtor: GroqClient },
    kimi:   { baseURL: "https://openrouter.ai/api/v1",        defaultModel: KIMI_DEFAULT_MODEL,   ClientCtor: KimiClient },
  } as const;
  ```

  och slå upp `FREE_OPENAI_COMPAT_PROVIDERS[provider as keyof typeof FREE_OPENAI_COMPAT_PROVIDERS]` på alla berörda rader (270-343) istället för att utöka ternary-kedjan ytterligare en gång. Gör samma sak i `calibrate/route.ts`. Detta är en kvalitetsförbättring som blir nödvändig nu, inte en valfri "nice to have" — fyra binära ternaries × två filer × tre grenar är redan vid gränsen för läsbart.
- **Tool-calling för Kimi-via-OpenRouter är inte garanterat att fungera — men koden har redan ett säkerhetsnät.** Bekräftad, dokumenterad begränsning: OpenRouters `:free`-modellvarianter har en känd bugg där tool-calling kan misslyckas med felet "No endpoints found that support tool use", trots att samma modell utan `:free`-suffix stödjer det fullt ut. **Det här är dock redan ofarligt i denna kodbas**: tool-call-försöket i `chat/route.ts` rad ~270-298 ligger redan i ett `try/catch` som bara loggar och fortsätter UTAN verktygsdata om anropet kastar — appen kraschar inte, coachen svarar bara utan att ha kunnat slå upp t.ex. träningsdata den gången. Implementerande agent ska **bekräfta detta beteende explicit för Kimi** (skicka en fråga som borde trigga ett verktygsanrop, t.ex. "vad är min VDOT?", med Kimi vald) snarare än att anta att felhanteringen räcker utan att testa den.
- **50 req/dag är en hård gräns som måste kommuniceras tydligt om Kimi väljs som HUVUDprovider** (inte bara för en framtida pass-sammanfattningsfunktion) — en aktiv coach-chatt-session kan lätt nå 50 meddelanden på en dag. UI-texten i `ai-settings.tsx` ska vara minst lika tydlig om detta som NVIDIA-sektionens befintliga "Free, rate-limited (40 req/min)"-text — annars upplever användaren ett förvirrande "varför svarar inte coachen plötsligt" mitt i en konversation.
- **Modelltillgänglighet kan ändras utan förvarning** (gratis OpenRouter-modeller har bytts ut/tagits bort förut när leverantörens sponsring ändras) — lägg till ett tydligt felmeddelande i UI om vald modell ger 404/"model not found" istället för en generisk felruta, så användaren vet att de ska byta modell i listan snarare än att tro hela funktionen är trasig.

## 6. Validering

1. Skapa ett gratis OpenRouter-konto, hämta API-nyckel, spara i Settings → AI Coach → Kimi.
2. Kör ett coach-meddelande, bekräfta streaming fungerar och svar kommer tillbaka.
3. Bekräfta `modelUsed` loggas korrekt i `Message`-tabellen och att spend-tracking INTE räknar kostnad för Kimi (ska förbli $0, ingen `currentMonthSpendUsd`-ökning).
4. Testa gränsen: skicka >20 meddelanden inom en minut, bekräfta att ett rate-limit-fel från OpenRouter hanteras med ett begripligt felmeddelande i UI, inte en oförklarad krasch.
5. `pnpm build --no-lint` utan TypeScript-fel.

---

## Slutinstruktion till implementerande agent

Implementera genomtänkt — detta är i grunden en mekanisk utbyggnad av ett redan etablerat mönster (Groq/NVIDIA), så återanvänd `lib/ai/groq.ts`s struktur för den nya `KimiClient` rakt av. De ENDA ställena värda att medvetet avvika från "kopiera mönstret rakt av" är de binära ternaries i `chat/route.ts`/`calibrate/route.ts` (se §5b) — där är en liten uppslagstabell bättre än en tredje nästlad gren, inte en ny stor abstraktion för "OpenRouter-baserade providers" i största allmänhet. Verifiera de exakta OpenRouter-modell-ID:na på nytt vid implementationstillfället (§2, modeller ändras snabbt), testa tool-calling explicit (§5b), och iterera tills en riktig chatt-konversation fungerar end-to-end mot ett riktigt OpenRouter-konto.

1. **Dubbelkolla att implementationen fungerar korrekt** genom att faktiskt skicka och få svar på ett coach-meddelande med Kimi vald som provider, INKLUSIVE ett meddelande som triggar ett verktygsanrop (inte bara att build/lint går igenom).
2. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` med en sessionspost och `docs/integrations/ai-setup.md` med Kimi/OpenRouter-instruktionerna.
3. Flytta denna fil till `docs/planning/archive/` när allt ovan är bekräftat klart.
