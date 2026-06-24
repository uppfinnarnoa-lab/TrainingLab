import { NvidiaClient, NVIDIA_MODELS, resolveNvidiaModel } from "./nvidia";
import { GROQ_MODELS } from "./groq";
import type { AIClient } from "./client";

// NVIDIA NIM's general free tier is an ongoing 40 req/min limit with no daily
// cap — the airiest verified limit of anything this app integrates (Groq's
// free tier caps at 500-14,400 req/day depending on model; Kimi K2.6
// specifically is carved out at ~30 req/hour on NVIDIA NIM itself; Cerebras,
// researched as a candidate 2026-06-24, turned out to cap at just 5 RPM).
// Nemotron 70B is NVIDIA's own non-Kimi model, so it's the natural seamless
// fallback when anything else — including Kimi itself — gets rate-limited.
export const FALLBACK_MODEL = "nvidia/llama-3.1-nemotron-70b-instruct-hq";

export function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: number; code?: number } | null)?.status
    ?? (err as { status?: number; code?: number } | null)?.code;
  if (status === 429) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate.?limit|RESOURCE_EXHAUSTED|too many requests/i.test(msg);
}

export function modelDisplayName(provider: string, model?: string | null): string {
  if (provider === "claude") return "Claude";
  if (provider === "gemini") return "Gemini";
  if (provider === "groq")   return GROQ_MODELS.find(m => m.id === model)?.label.split(" (")[0] ?? "Groq";
  if (provider === "nvidia") return NVIDIA_MODELS.find(m => m.id === model)?.label.split(" (")[0] ?? "NVIDIA NIM";
  return provider;
}

// Returns a fallback client, or null if there's nothing useful to fall back to:
// no NVIDIA key on file, or the thing that just failed *was* the fallback itself.
export function getFallbackClient(
  nvidiaApiKey: string | null | undefined,
  failedProvider: string,
  failedModel?: string | null,
): AIClient | null {
  if (!nvidiaApiKey) return null;
  if (failedProvider === "nvidia" && resolveNvidiaModel(failedModel) === FALLBACK_MODEL) return null;
  return new NvidiaClient(nvidiaApiKey, FALLBACK_MODEL);
}
