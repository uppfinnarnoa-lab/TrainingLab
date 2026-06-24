# Undersökning: Finns det bättre gratis AI-modeller än de vi redan har?

**Status:** Research-only — inget nytt implementerat baserat på denna fil. Två konkreta buggar som upptäcktes under research (döda Groq-modell-ID:n, Kimi K2.6:s strikta gräns) åtgärdades separat, se sessionsposten i `IMPLEMENTATION_PLAN.md`.
**Skapad:** 2026-06-24

---

## 1. TL;DR

Inget av det jag hittade slår tydligt det vi redan har **för en interaktiv coach-chatt** (där request-frekvens, inte daglig tokenvolym, är den begränsande faktorn). Den mest lovande nya kandidaten — **Cerebras** — har en överraskande sträng 5 req/min-gräns på gratistiern (verifierat direkt från deras egen dokumentation, inte gissat), vilket gör den sämre än NVIDIA NIM för chatt trots en imponerande 1M tokens/dag-volym. Två verkliga buggar hittades dock i det vi redan har, och är åtgärdade:

1. **Groq:** `llama3-groq-70b-8192-tool-use-preview` och `mixtral-8x7b-32768` i `GROQ_MODELS` (`lib/ai/groq.ts`) finns inte längre på Groqs nuvarande modell-lista — samma buggklass som gårdagens Kimi K2.5-404. Åtgärdat: döda modeller borttagna, `openai/gpt-oss-120b` tillagd, `resolveGroqModel()` tillagd som samma typ av självläkande fallback som `resolveNvidiaModel()`.
2. **NVIDIA Kimi K2.6:** bekräftat ~30 requests/**timme** specifikt för Kimi (inte den generella 40 RPM/ingen-daglig-gräns som resten av NVIDIA NIM har) — redan känt sedan föregående session, men nu med en konkret källa. Detta är huvudskälet till att den nya seamless-fallback-funktionen (se sessionsposten) pekar mot NVIDIA Nemotron 70B istället för någon annan provider.

## 2. Vad vi redan har — verifierade gränser (inte gissade)

| Provider/modell | Verifierad gräns | Källa |
|---|---|---|
| NVIDIA NIM, generellt (Nemotron 70B, Llama 3.3 70B, Llama 3.1 405B, Mistral Large) | 40 RPM, **ingen publicerad daglig gräns** (löpande gratis-tier sedan kredit-systemet fasades ut 2025) | NVIDIA Developer Forums, decodethefuture.org |
| NVIDIA NIM, Kimi K2.6 specifikt | ~30 requests/**timme** | [forums.developer.nvidia.com/t/kimi-k2-6-is-rate-limited-to-30-requests-per-hour](https://forums.developer.nvidia.com/t/kimi-k2-6-is-rate-limited-to-30-requests-per-hour/369211) |
| Groq `llama-3.3-70b-versatile` (vår default) | 30 RPM, **1 000 RPD**, 12K TPM, 100K TPD | console.groq.com/docs/rate-limits (officiell) |
| Groq `llama-3.1-8b-instant` | 30 RPM, **14 400 RPD** (mest generösa på Groq, men 8B-modell, lägre kvalitet) | console.groq.com/docs/rate-limits |
| Groq `openai/gpt-oss-120b` (ny, tillagd nu) | 30 RPM, 1 000 RPD, 200K TPD | console.groq.com/docs/rate-limits |
| Gemini 2.5 Flash, gratis | **Oklart** — Googles egna sidor (`ai.google.dev/gemini-api/docs/rate-limits` och `/pricing`) listar inte ett globalt fast RPD-tal för chatt-text, bara "beror på din tier, kolla AI Studio". Flera tredjepartsbloggar (ej officiella) hävdar 1 500 RPD för 2026, men det stämmer inte med appens nuvarande "25 req/dag"-text. **Kunde inte bekräftas från primärkälla — se §5.** | ai.google.dev (officiell, men utan siffra) |

## 3. Ny kandidat undersökt: Cerebras Cloud

**Vad som lät lovande:** Cerebras' egen blogg/tredjepartsbloggar marknadsför "1 000 000 tokens/dag, inget kort" och extremt snabb inferens (2 600+ tokens/sek). Modellutbudet är starkt: Llama 4 Scout, Qwen3 32B/235B, DeepSeek R1 Distill, och **GPT-OSS 120B** (OpenAIs öppna modell). OpenAI-kompatibelt API (`https://api.cerebras.ai/v1/chat/completions`) — skulle, om det blev relevant, integreras precis som NVIDIA/Groq redan är (samma `openai`-SDK-mönster, ingen ny SDK-typ behövs).

**Den viktiga brasklappen — verifierad direkt från Cerebras egen dokumentation** (`inference-docs.cerebras.ai/support/rate-limits`), inte tredjepartsbloggarna som påstod 30 RPM:

> Free-tier: **5 RPM** | 30K TPM | 1M TPH | 1M TPD

5 requests/**minut** är strängare än både NVIDIA NIM:s generella 40 RPM och även Kimi K2.6:s ~30/timme om man räknar i minuter (30/60 ≈ 0,5 RPM jämfört med Cerebras 5 RPM — Cerebras är där faktiskt 10x bättre). Men för en **interaktiv chatt-session** där coachen ibland gör 2 snabba anrop i rad (verktygskontroll + svar, se `app/api/coach/chat/route.ts` rad 270-298) är 5 RPM en reell risk att träffa direkt i en enskild konversation, på ett sätt 40 RPM aldrig är. Den enorma dagsvolymen (1M tokens) gör Cerebras attraktiv för **bakgrundsjobb** (t.ex. den planerade post-workout-AI-sammanfattningen, `POST_WORKOUT_AI_SUMMARY_PLAN_2026_06_23.md`) snarare än för live-chatten.

**Slutsats:** inte värt att lägga till som en 6:e provider just nu — komplexiteten (ny klient, schema-fält, UI-sektion, samma ternary-kedjor som Kimi-planen ursprungligen ville undvika) väger inte upp mot en RPM-gräns som är sämre än det vi redan har för det primära användningsfallet. **Om** bakgrunds-AI-funktioner (post-workout-sammanfattning) byggs senare och behöver hög tokenvolym snarare än hög frekvens, är Cerebras värd att återbesöka då — arkiveras här som referens, inte en uppgift.

## 4. Gemini-siffran behöver verifieras av användaren själv

Appens nuvarande UI-text ("25 req/dag") kunde inte bekräftas eller motbevisas från Googles egna sidor — de hänvisar uttryckligen till att kolla `aistudio.google.com/rate-limit` för kontospecifika siffror, exakt samma mönster som NVIDIA (ingen global publicerad gräns, bara per-konto). Jag har **inte** ändrat denna siffra i UI:t eftersom jag inte kunde verifiera ett nytt tal från en primärkälla — bara från SEO-bloggar som historiskt visat sig opålitliga (se Kimi K2.5-incidenten). Om du vill ha en uppdaterad siffra: logga in på `aistudio.google.com/rate-limit` med det Google-konto vars API-nyckel är sparat i Inställningar och kolla där.

## 5. Vad implementerades baserat på detta

Se sessionsposten i `docs/planning/IMPLEMENTATION_PLAN.md` (samma datum) för detaljer:
- Döda Groq-modeller borttagna + `openai/gpt-oss-120b` tillagd + `resolveGroqModel()`.
- Seamless rate-limit-fallback i coach-chatten: om aktiv provider/modell träffar en 429, byter appen tillfälligt (bara för det svaret, ingen ändring av sparad inställning) till NVIDIA Nemotron 70B — vald just därför att den har den luftigaste verifierade gränsen av allt vi faktiskt har integrerat (40 RPM, ingen daglig gräns), inte Cerebras (för sträng RPM för chatt) eller Groq 8B (sämre svarskvalitet). En liten notis visas i chatten när det händer.
- Jämförelsetabellen i Inställningar uppdaterad med korrekta siffror + en rad om fallback-beteendet.
