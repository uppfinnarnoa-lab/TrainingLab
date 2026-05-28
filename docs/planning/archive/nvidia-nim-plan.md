# NVIDIA NIM (build.nvidia.com) — Free AI Integration Plan

> **Status:** 2026-05-28 — Research + implementation plan, awaiting approval  
> **Goal:** Add NVIDIA NIM as a third free AI provider option alongside Claude and Gemini

---

## 1. What Is NVIDIA NIM?

NVIDIA NIM (NVIDIA Inference Microservices) at [build.nvidia.com](https://build.nvidia.com) is a hosted
LLM API service. It is **OpenAI API-compatible** — the same SDK, just a different base URL and API key.

### Free Tier
- **1 000 API calls per model per month** — no credit card required
- Generous context windows (most models: 128k tokens)
- No billing setup needed — just sign up at build.nvidia.com and generate an API key

### Paid Tier
- Pay per token (very cheap — roughly Gemini Flash pricing)
- No monthly commitment

---

## 2. Best Available Models (researched 2026-05-28)

| Model | Quality | Speed | Notes |
|---|---|---|---|
| `nvidia/llama-3.1-nemotron-70b-instruct-hq` | ⭐⭐⭐⭐⭐ | Medium | NVIDIA's own fine-tune of Llama 70B — top instruction following, outperforms base Llama on benchmarks |
| `meta/llama-3.1-405b-instruct` | ⭐⭐⭐⭐⭐ | Slow | Most capable open model, close to GPT-4 quality, limited free calls |
| `meta/llama-3.3-70b-instruct` | ⭐⭐⭐⭐ | Fast | Good quality/speed balance, reliable instruction following |
| `mistralai/mistral-large-latest` | ⭐⭐⭐⭐ | Medium | Excellent multilingual, good for Swedish text |
| `microsoft/phi-4` | ⭐⭐⭐ | Fast | Compact but sharp reasoning for its size |

### Recommendation
**`nvidia/llama-3.1-nemotron-70b-instruct-hq`** as default — best instruction-following quality
in the free tier. Allow user to select model from a dropdown in settings (since all share the
same API key and endpoint format).

---

## 3. API Integration

NVIDIA NIM is 100% OpenAI-compatible. No new SDK needed — use the existing `openai` npm package:

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: nvidiaApiKey,
  baseURL: "https://integrate.api.nvidia.com/v1",
});

const res = await client.chat.completions.create({
  model: "nvidia/llama-3.1-nemotron-70b-instruct-hq",
  messages: [{ role: "user", content: prompt }],
  max_tokens: 2048,
  stream: true,
});
```

---

## 4. Implementation Plan

### Step 1: Database schema
Add to `AISettings` model in `prisma/schema.prisma`:
```prisma
nvidiaApiKey  String?   // encrypted, same pattern as claudeApiKey/geminiApiKey
nvidiaModel   String?   // default: "nvidia/llama-3.1-nemotron-70b-instruct-hq"
```

Run `prisma db push`.

### Step 2: NvidiaClient class
Create `lib/ai/nvidia.ts` implementing `AIClient` interface — mirrors `lib/ai/gemini.ts` in structure:
```typescript
import OpenAI from "openai";
import type { AIClient, AIMessage, StreamChunk } from "./client";

export const NVIDIA_MODELS = [
  { id: "nvidia/llama-3.1-nemotron-70b-instruct-hq", label: "Nemotron 70B (recommended)" },
  { id: "meta/llama-3.3-70b-instruct",               label: "Llama 3.3 70B" },
  { id: "meta/llama-3.1-405b-instruct",              label: "Llama 3.1 405B (slow)" },
  { id: "mistralai/mistral-large-latest",            label: "Mistral Large" },
];

export class NvidiaClient implements AIClient {
  readonly provider = "nvidia" as const;
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "nvidia/llama-3.1-nemotron-70b-instruct-hq") {
    this.client = new OpenAI({ apiKey, baseURL: "https://integrate.api.nvidia.com/v1" });
    this.model = model;
  }

  async *stream(systemPrompt: string, messages: AIMessage[], recentContext: string): AsyncIterable<StreamChunk> {
    // same pattern as GeminiClient.stream()
  }
}
```

### Step 3: Update AIClient factory
In `lib/ai/` (wherever clients are instantiated based on `aiSettings.provider`):
- Add `"nvidia"` case → `new NvidiaClient(apiKey, nvidiaModel)`

### Step 4: Settings UI
In `app/(dashboard)/settings/ai-settings.tsx`:
- Add "nvidia" option to provider selector: `{ id: "nvidia", label: "NVIDIA NIM", sub: "Free tier (1 000 calls/mo)" }`
- Add NVIDIA API key input (same pattern as Claude/Gemini keys)
- Add model selector dropdown (shown only when nvidia is active), populated from `NVIDIA_MODELS`
- No budget tracking needed (free tier) — but can show "X/1 000 calls used" if we track it

### Step 5: Calibrate route
In `app/api/coach/calibrate/route.ts` (AI path):
- Add `"nvidia"` branch alongside `"claude"` and `"gemini"` branches
- Use OpenAI SDK with NVIDIA base URL

### Step 6: Update `AIClient` type
Add `"nvidia"` to the provider union type in `lib/ai/client.ts`:
```typescript
export interface AIClient {
  provider: "claude" | "gemini" | "nvidia";
  // ...
}
```

### Step 7: Encryption
`nvidiaApiKey` uses the same `safeEncrypt`/`safeDecrypt` pattern as the other keys.
In `app/api/settings/ai/route.ts`: add `nvidiaApiKey` and `nvidiaModel` to Zod schema.

---

## 5. Files to Touch

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `nvidiaApiKey`, `nvidiaModel` to `AISettings` |
| `lib/ai/nvidia.ts` | NEW — `NvidiaClient` implementing `AIClient` |
| `lib/ai/client.ts` | Add `"nvidia"` to provider type |
| `app/(dashboard)/settings/ai-settings.tsx` | Add NVIDIA option + model selector |
| `app/api/settings/ai/route.ts` | Add `nvidiaApiKey`, `nvidiaModel` to Zod schema + save |
| `app/api/coach/calibrate/route.ts` | Add `"nvidia"` branch in AI call |
| Wherever AIClient is instantiated for chat | Add `"nvidia"` case |

---

## 6. Risks

- **Free tier limit is per-model, not per-account** — 1 000 calls/month is generous for personal use
- **Context window**: Nemotron 70B supports 128k tokens — more than enough
- **Swedish language quality**: Llama and Mistral both handle Swedish well; Nemotron is primarily English-trained but still good
- **Latency**: 70B models on NVIDIA's servers are fast (typically 1–3s first token); 405B is slower (~5–10s)
- **`openai` npm package**: Already used by many Next.js apps; if not already installed, adds ~200 kB to bundle (server-side only, no client impact)

---

## 7. Verdict

Low-risk, low-effort addition. The OpenAI-compatible API means almost no new code — just a new client class and a few schema/UI additions. For personal use the free tier is essentially unlimited (coach chat is maybe 5–20 calls/day).

**Recommended implementation order:** schema → NvidiaClient → settings UI → AI chat integration → calibrate route.
