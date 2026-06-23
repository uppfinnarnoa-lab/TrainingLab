# Implementera gratis Kimi-modell som AI-coach-provider

**Status:** Research klar, redo för implementation
**Skapad:** 2026-06-23

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

| Fil | Ändring |
|---|---|
| `prisma/schema.prisma` (`AISettings`, rad 373-394) | `provider String @default("gemini")` — uppdatera kommentar; lägg till `kimiApiKey String?`, `kimiModel String?` |
| `lib/ai/client.ts` | `AIClient.provider` union: lägg till `"kimi"`; `estimateCost()`: kimi → 0 (gratis, ingen ändring av prislogiken behövs eftersom funktionen redan defaultar till 0 för okända providers — **verifiera detta explicit, lita inte på det**) |
| `app/api/settings/ai/route.ts` | zod-schema rad 8: lägg till `"kimi"` i `z.enum([...])`; lägg till `kimiApiKey`/`kimiModel` i body-schema + destructuring + `data.*`-tilldelning (rad 37-46) |
| `app/api/coach/chat/route.ts` | Minst 6 ställen där `provider === "nvidia" \|\| provider === "groq"` särbehandlas (apiKey-val rad 61-65, budget-bypass rad 82-83, klient-instansiering rad 270-274 + 339-342, `modelUsed`-loggning rad 385, spend-tracking-bypass rad 392) — lägg till `"kimi"` i varje OR-kedja |
| `app/api/coach/calibrate/route.ts` | Samma mönster, rad ~114-211 |
| `app/(dashboard)/settings/ai-settings.tsx` | Lägg till "Kimi"-knapp i providerlistan (rad 121-126, sub-text t.ex. `"Free · Kimi K2"`), ny sektion för API-nyckel + modellväljare (mirror NVIDIA/Groq-sektionerna rad 296-374), uppdatera jämförelsetabellen (rad 162-200) |
| `docs/integrations/ai-setup.md` | Lägg till ett Kimi/OpenRouter-avsnitt: hur man skapar OpenRouter-konto + API-nyckel (ingen betalning krävs), samma stil som befintliga Gemini-instruktioner |

## 4. UX-text att vara tydlig om

I providerjämförelsetabellen (`ai-settings.tsx`) och i `docs/integrations/ai-setup.md`, var explicit att detta är **"Kimi K2 via OpenRouter"** — användaren skapar ett konto på openrouter.ai (inte moonshot.ai) och hämtar sin API-nyckel där. Annars är risken stor att användaren går till fel ställe (Moonshots egen plattform) och fastnar på "recharge $1 to activate"-kravet som inte gäller den gratisvägen som faktiskt implementeras.

## 5. Validering

1. Skapa ett gratis OpenRouter-konto, hämta API-nyckel, spara i Settings → AI Coach → Kimi.
2. Kör ett coach-meddelande, bekräfta streaming fungerar och svar kommer tillbaka.
3. Bekräfta `modelUsed` loggas korrekt i `Message`-tabellen och att spend-tracking INTE räknar kostnad för Kimi (ska förbli $0, ingen `currentMonthSpendUsd`-ökning).
4. Testa gränsen: skicka >20 meddelanden inom en minut, bekräfta att ett rate-limit-fel från OpenRouter hanteras med ett begripligt felmeddelande i UI, inte en oförklarad krasch.
5. `pnpm build --no-lint` utan TypeScript-fel.

---

## Slutinstruktion till implementerande agent

Implementera genomtänkt — detta är i grunden en mekanisk utbyggnad av ett redan etablerat mönster (Groq/NVIDIA), så håll dig strikt till den existerande strukturen istället för att uppfinna en ny abstraktion för "OpenRouter-baserade providers". Verifiera de exakta OpenRouter-modell-ID:na på nytt vid implementationstillfället (§2, modeller ändras snabbt) och iterera tills en riktig chatt-konversation fungerar end-to-end mot ett riktigt OpenRouter-konto.

1. **Dubbelkolla att implementationen fungerar korrekt** genom att faktiskt skicka och få svar på ett coach-meddelande med Kimi vald som provider (inte bara att build/lint går igenom).
2. Uppdatera `docs/planning/IMPLEMENTATION_PLAN.md` med en sessionspost och `docs/integrations/ai-setup.md` med Kimi/OpenRouter-instruktionerna.
3. Flytta denna fil till `docs/planning/archive/` när allt ovan är bekräftat klart.
