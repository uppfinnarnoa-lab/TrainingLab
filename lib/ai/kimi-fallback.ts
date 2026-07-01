// lib/ai/kimi-fallback.ts
// Kimi K2's native tool-call format (Moonshot tool_call_guidance.md):
// <|tool_calls_section_begin|><|tool_call_begin|>functions.NAME:IDX
// <|tool_call_argument_begin|>{...json...}<|tool_call_end|>...<|tool_calls_section_end|>
// NVIDIA NIM is supposed to convert this into structured `tool_calls`, but parsing
// parallel/multiple calls is known to be fragile and can leak the raw tokens into
// `content` instead. This is a last-resort app-level parser for that failure mode.

const SECTION_RE = /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/;
const CALL_RE = /<\|tool_call_begin\|>\s*functions\.([a-zA-Z_][a-zA-Z0-9_]*):\d+\s*<\|tool_call_argument_begin\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/g;

export function parseLeakedKimiToolCalls(text: string): { name: string; args: Record<string, unknown> }[] {
  const section = SECTION_RE.exec(text);
  if (!section) return [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let m: RegExpExecArray | null;
  const body = section[1];
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(body)) !== null) {
    const [, name, argsRaw] = m;
    try {
      calls.push({ name, args: JSON.parse(argsRaw) as Record<string, unknown> });
    } catch {
      // malformed JSON in a leaked call — skip it, don't crash the whole parse
    }
  }
  return calls;
}

export function stripLeakedKimiTokens(text: string): string {
  return text
    .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, "")
    .replace(/<\|tool_call[a-z_]*\|>/g, "")
    .trim();
}

export function hasLeakedKimiTokens(text: string): boolean {
  return text.includes("<|tool_call");
}
