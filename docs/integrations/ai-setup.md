# Gemini API Setup — Paid Tier + Context Caching

## Varför betaltier?

Gemini Flash gratis-tier har dagliga token-gränser som kan nås med en enda stor
förfrågan (träningsdata + systemkontext). Betaltier kostar ~$0.001–0.005 per
meddelande med context caching.

---

## Steg 1 — Uppgradera till betaltier i Google AI Studio

1. Gå till **[aistudio.google.com](https://aistudio.google.com)**
2. Klicka på **"Get API key"** → **"Create API key"** (om du inte redan har en)
3. Klicka på **"Billing"** eller **"Upgrade"** i vänstermenyn
4. Du länkas till **Google Cloud Console** → **Billing** → lägg till ett betalkort
5. Sätt ett **Budget Alert** (se Steg 2) direkt

> **OBS:** Betaltier faktureras per token. En typisk månads-usage på
> 100–300 meddelanden kostar $0.10–1.00 med context caching aktiverat.

---

## Steg 2 — Sätt budgetvarning i Google Cloud

1. Gå till **[console.cloud.google.com](https://console.cloud.google.com)**
2. Välj ditt projekt (det som är kopplat till din Gemini API-nyckel)
3. Sök efter **"Budgets & alerts"** i sökfältet
4. Klicka **"Create budget"**:
   - **Name:** TrainingLab Gemini
   - **Amount:** $5 (eller vad du är bekväm med)
   - **Alert thresholds:** 50%, 80%, 100%
   - **Notifications:** skicka email

> Denna varning är skild från TrainingLab's inbyggda budgetspärr.
> Rekommenderas ändå som extra skyddsnät.

---

## Steg 3 — Sätt budget i TrainingLab

I TrainingLab → **Settings → AI Coach**:
- Välj **Gemini Flash** som provider
- Under **"Monthly budget — paid tier"**: sätt t.ex. $5
- TrainingLab blockerar automatiskt nya meddelanden om månadsbudgeten nås

---

## Steg 4 — Context caching (automatiskt)

Context caching aktiveras automatiskt när du använder betaltjänsten. TrainingLab:
- Cachar systemprompten (träningsdata, fitness-mätvärden, planering) i 50 minuter
- Förnyar cachen automatiskt innan den löper ut
- Betalplanspriser med caching: ~$0.001 per meddelande (75% rabatt på tokens)

**Du behöver inte göra något** — caching aktiveras när API-nyckeln är på betaltier.

---

## Priser (Gemini 2.5 Flash, betaltier — verifiera aktuella priser på ai.google.dev/pricing)

| Operation | Pris per 1M tokens |
|---|---|
| Standard input | $0.075 |
| Output | $0.30 |
| Cache write (första gången) | $0.075 |
| **Cache read (upprepade)** | **$0.01875** (75% rabatt) |
| Cache storage | $1.00/tim/1M tokens |

**Typisk kostnad per meddelande (med caching):**
- Första meddelandet i en session: ~$0.006
- Följande meddelanden (inom 50 min): ~$0.001

**100 meddelanden/månad ≈ $0.10–0.50**

---

## Om du vill skicka 5 års aktiviteter som context

Med context caching är detta fullt möjligt och rimligt prisvärt:

| | Tokens | Kostnad per session |
|---|---|---|
| 5 år (~1400 aktiviteter) | ~70,000 | $0.005 (cache write) |
| Per meddelande | ~1,000 output | $0.001 (cache read) |
| **100 meddelanden/mån** | | **~$0.15/månad** |

Aktivera detta i TrainingLab genom att ta bort dagsbegränsningen i
`lib/ai/context-builder.ts` (ändra `subDays(now, 14)` → `subDays(now, 5 * 365)`).
