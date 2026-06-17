"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Bot, User, Plus, Trash2, ChevronLeft, ChevronRight, CheckCircle2, XCircle, CalendarPlus, ClipboardList, UserCog, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

interface ToolAction {
  name: string;
  message: string;
  success: boolean;
  pending?: boolean;
  pendingInput?: Record<string, unknown>;
  pendingTool?: string;
  editId?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  cost?: number;
  tokens?: number;
  modelUsed?: string;
  toolActions?: ToolAction[];
  statusLabel?: string;
}

interface ConvSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface Props {
  provider: "claude" | "gemini" | "nvidia" | "groq";
  hasApiKey: boolean;
  monthlyBudget: number;
  currentSpend: number;
  initialConversationId?: string;
  initialMessages?: Message[];
  conversations: ConvSummary[];
  initialLanguage?: "en" | "sv";
}

const TOOL_LABELS: Record<string, string> = {
  get_fitness_summary:      "Träningsstatus",
  get_race_history:         "Tävlingshistorik & PB",
  get_readiness:            "Återhämtning idag",
  get_training_blocks:      "Träningsblock",
  get_upcoming_plan:        "Kommande plan",
  search_activities:        "Sök träningspass",
  get_activity_detail:      "Sessionsdetaljer",
  get_activity_stream:      "Strömanalys (sekund/sekund)",
  get_activities_in_range:  "Pass i datumintervall",
  analyze_full_history:     "Helhistoria (flera år)",
  get_segment_history:      "Segmenthistorik (Strava)",
  get_volume_stats:         "Volymstatistik",
  get_zone_distribution:    "Zonfördelning",
  get_wellness_history:     "Hälsohistorik (Garmin)",
  get_workout_templates:    "Passmallar",
  get_workout_types:        "Sporttyper & passtyper",
  get_training_goals:       "Träningsmål",
  get_athlete_profile:      "Atletprofil",
  web_search:               "Webbsökning",
  weather_forecast:         "Väderprogons",
  search_training_research: "Sök träningsforskning",
  create_workout:           "Skapa träningspass",
  update_workout:           "Uppdatera träningspass",
  delete_workout:           "Ta bort träningspass",
  create_training_block:    "Skapa träningsblock",
  update_training_block:    "Uppdatera träningsblock",
  log_race_result:          "Logga tävlingsresultat",
  delete_race_result:       "Ta bort tävlingsresultat",
  update_activity_notes:    "Uppdatera aktivitetsnotering",
  update_profile:           "Uppdatera profil",
};

export function ChatInterface({
  provider, hasApiKey, monthlyBudget, currentSpend,
  initialConversationId, initialMessages = [], conversations,
  initialLanguage = "sv",
}: Props) {
  const router = useRouter();
  const [messages, setMessages]         = useState<Message[]>(initialMessages);
  const [input, setInput]               = useState("");
  const [showToolMenu, setShowToolMenu] = useState(false);
  const [language, setLanguage]         = useState<"en" | "sv">(initialLanguage);
  const [streaming, setStreaming]       = useState(false);
  const [sessionCost, setSessionCost]   = useState(0);
  const [convId, setConvId]             = useState<string | undefined>(initialConversationId);
  const [totalSpend, setTotalSpend]     = useState(currentSpend);
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [lockedEditIds, setLockedEditIds]     = useState<Set<string>>(new Set());
  const [undoneEditIds, setUndoneEditIds]     = useState<Set<string>>(new Set());
  const bottomRef          = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef        = useRef<HTMLTextAreaElement>(null);
  const rafRef             = useRef<number | null>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 120) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      rafRef.current = null;
    });
  }, [messages]);

  const spendPct = monthlyBudget > 0 ? Math.min((totalSpend / monthlyBudget) * 100, 100) : 0;

  // Persist language preference to DB
  async function persistLanguage(lang: "en" | "sv") {
    setLanguage(lang);
    setShowToolMenu(false);
    await fetch("/api/settings/ai", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coachLanguage: lang }),
    });
  }

  // Lock all current write-tool edits when user sends next message
  function lockCurrentEdits() {
    const editIds = messages.flatMap(m => m.toolActions ?? []).map(ta => ta.editId).filter((id): id is string => !!id);
    if (editIds.length > 0) setLockedEditIds(prev => { const n = new Set(prev); editIds.forEach(id => n.add(id)); return n; });
  }

  async function undoEdit(editId: string) {
    setUndoneEditIds(prev => new Set([...prev, editId]));
    const res = await fetch(`/api/coach/undo/${editId}`, { method: "POST" });
    if (!res.ok) setUndoneEditIds(prev => { const n = new Set(prev); n.delete(editId); return n; });
  }

  async function approveAction(action: ToolAction) {
    if (!action.pendingTool || !action.pendingInput) return;
    lockCurrentEdits();
    await sendWithPayload(
      `Ja, genomför: ${action.message}`,
      { approvedTool: action.pendingTool, approvedInput: action.pendingInput },
    );
  }

  async function rejectAction() {
    await sendWithPayload("Nej, avbryt det.");
  }

  const sendWithPayload = useCallback(async (
    text: string,
    opts?: { approvedTool?: string; approvedInput?: Record<string, unknown> },
  ) => {
    if (streaming) return;
    lockCurrentEdits();
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    const assistantId = crypto.randomUUID();
    const initialStatus = language === "sv" ? "Tänker…" : "Thinking…";
    setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "", statusLabel: initialStatus }]);
    try {
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          message: text,
          language,
          ...(opts?.approvedTool ? { approvedTool: opts.approvedTool, approvedInput: opts.approvedInput } : {}),
        }),
      });
      await processStream(res, assistantId);
    } finally {
      setStreaming(false);
      textareaRef.current?.focus();
    }
  }, [streaming, convId, language]); // eslint-disable-line react-hooks/exhaustive-deps

  async function processStream(res: Response, assistantId: string) {
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      let errMsg = err.error ?? "Unknown error";
      if (err.error === "budget_exceeded") errMsg = `Månadsbudgeten nådd ($${err.budget?.toFixed(2)}). Ändra i Inställningar.`;
      else if (err.error === "no_api_key")  errMsg = "Ingen API-nyckel konfigurerad. Lägg till en i Inställningar → AI-coach.";
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: errMsg } : m));
      return;
    }
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", fullContent = "", msgCost = 0, gotDone = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let data: Record<string, unknown>;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.convId && !convId) {
          setConvId(data.convId as string);
          window.history.replaceState(null, "", `/coach?conv=${data.convId}`);
        }
        if (data.toolCall) {
          const tc = data.toolCall as ToolAction;
          setMessages(prev => prev.map(m => m.id === assistantId
            ? { ...m, toolActions: [...(m.toolActions ?? []), tc], statusLabel: undefined }
            : m
          ));
        }
        if (data.status === "thinking") {
          const label = language === "sv" ? "Tänker…" : "Thinking…";
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, statusLabel: label } : m));
        }
        if (data.status === "tool" && data.tool) {
          const toolLabel = TOOL_LABELS[data.tool as string] ?? (data.tool as string);
          const label = language === "sv" ? `Använder ${toolLabel}…` : `Using ${toolLabel}…`;
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, statusLabel: label } : m));
        }
        if (data.text) {
          fullContent += data.text as string;
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent, statusLabel: undefined } : m));
        }
        if (data.done) {
          gotDone = true;
          msgCost = (data.cost as number) ?? 0;
          setSessionCost(s => s + msgCost);
          setTotalSpend(s => s + msgCost);
          setMessages(prev => prev.map(m => m.id === assistantId
            ? { ...m, cost: msgCost, tokens: ((data.inputTokens as number) ?? 0) + ((data.outputTokens as number) ?? 0), modelUsed: provider }
            : m
          ));
        }
        if (data.error) {
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `Fel: ${data.error}` } : m));
        }
      }
    }
    if (!gotDone || !fullContent.trim()) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId && !m.content
          ? { ...m, content: "Inget svar mottogs. Kontrollera din API-nyckel och budget." }
          : m
      ));
    }
  }

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    await sendWithPayload(text);
  }, [input, streaming, sendWithPayload]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setShowToolMenu(false); return; }
    if (showToolMenu && e.key === "Enter") { e.preventDefault(); setShowToolMenu(false); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    const prev = input;
    setInput(val);
    if (val.length > prev.length && val[val.length - 1] === "/") setShowToolMenu(true);
    else if (!val.includes("/")) setShowToolMenu(false);
  }

  function selectTool(name: string) {
    const primaryTool = name.split(/\s*\+\s*/)[0].trim();
    setInput(`/${primaryTool} `);
    setShowToolMenu(false);
    textareaRef.current?.focus();
  }

  function handleSummarize() {
    if (streaming || !convId) return;
    setInput(language === "sv"
      ? "Sammanfatta de viktigaste insikterna och besluten från den här konversationen i 5–8 punkter. Fokusera på: träningsrekommendationer, identifierade mönster och beslut som fattats."
      : "Summarize the most important insights and decisions from this conversation in 5–8 bullet points."
    );
    textareaRef.current?.focus();
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    setConfirmDeleteId(null);
    setDeletingId(id);
    await fetch(`/api/coach/conversations/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (id === convId) { setMessages([]); setConvId(undefined); window.history.replaceState(null, "", "/coach"); }
    router.refresh();
  }

  function newConversation() {
    setMessages([]); setConvId(undefined); setSessionCost(0);
    window.history.replaceState(null, "", "/coach");
    textareaRef.current?.focus();
  }

  if (!hasApiKey) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-sm text-center space-y-3">
          <Bot size={40} className="mx-auto text-muted" />
          <p className="text-primary font-semibold">Ingen API-nyckel konfigurerad</p>
          <p className="text-sm text-muted">Lägg till en Claude- eller Gemini-nyckel i <a href="/settings" className="text-accent hover:underline">Inställningar</a>.</p>
        </div>
      </div>
    );
  }

  const quickPrompts = language === "sv"
    ? ["Hur mår min form?", "Planera nästa 4 veckor", "Vad är mitt VO2max?", "Analysera förra veckan", "Jämför nu mot ett år sedan"]
    : ["How is my fitness?", "Plan next 4 weeks", "What is my VO2max?", "Analyze last week", "Compare now vs a year ago"];

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Conversation sidebar ── */}
      <div className={cn(
        "flex flex-col border-r border-border bg-surface overflow-hidden transition-all duration-200 shrink-0",
        sidebarOpen ? "w-52" : "w-10"
      )}>
        <div className="flex items-center border-b border-border shrink-0 h-10">
          <button onClick={() => setSidebarOpen(v => !v)}
            className="flex items-center justify-center w-10 h-10 text-muted hover:text-primary transition shrink-0">
            {sidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
          {sidebarOpen && (
            <button onClick={newConversation}
              className="flex-1 flex items-center gap-1.5 px-2 h-full text-xs font-medium text-accent hover:bg-accent/5 transition">
              <Plus size={12} />Ny chatt
            </button>
          )}
        </div>
        {sidebarOpen && (
          <div className="flex-1 overflow-y-auto">
            {conversations.map(c => (
              <div key={c.id} className={cn(
                "relative border-b border-border/40",
                c.id === convId ? "bg-accent/8 border-l-2 border-l-accent" : "hover:bg-surface-2"
              )}>
                <a href={`/coach?conv=${c.id}`} className="block px-3 py-2.5 pr-8">
                  <p className="text-xs font-medium text-primary truncate leading-snug">{c.title}</p>
                  <p className="text-[10px] text-muted mt-0.5">{format(parseISO(c.updatedAt), "d MMM")} · {c.messageCount} msg</p>
                </a>
                {confirmDeleteId === c.id ? (
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    <button onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirmDeleteId(null); }}
                      className="px-1.5 py-0.5 rounded text-[10px] text-muted hover:bg-surface-2 transition">Nej</button>
                    <button onClick={e => deleteConversation(c.id, e)}
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-error bg-error/10 hover:bg-error/20 transition">Ja</button>
                  </div>
                ) : (
                  <button onClick={e => deleteConversation(c.id, e)} disabled={deletingId === c.id}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted/40 hover:text-error hover:bg-error/10 transition disabled:opacity-50"
                    title="Ta bort chatt">
                    {deletingId === c.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  </button>
                )}
              </div>
            ))}
            {conversations.length === 0 && <p className="px-3 py-4 text-[10px] text-muted">Inga chattar än</p>}
          </div>
        )}
      </div>

      {/* ── Main chat area ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Header strip */}
        <div className="shrink-0 flex items-center gap-3 px-4 h-10 border-b border-border text-xs text-muted bg-surface">
          <span className="font-medium text-primary">{provider === "claude" ? "Claude Sonnet" : provider === "nvidia" ? "NVIDIA NIM" : provider === "groq" ? "Groq" : "Gemini Flash"}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-border">{language === "sv" ? "SV" : "EN"}</span>
          {sessionCost > 0 && <span>Session: <span className="font-mono">${sessionCost.toFixed(4)}</span></span>}
          {monthlyBudget > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className={cn("font-mono text-[11px]", spendPct >= 100 ? "text-error" : spendPct >= 80 ? "text-warning" : "")}>
                ${totalSpend.toFixed(3)} / ${monthlyBudget}
              </span>
              <div className="w-16 h-1 rounded-full bg-surface-2 overflow-hidden">
                <div className={cn("h-full rounded-full", spendPct >= 100 ? "bg-error" : spendPct >= 80 ? "bg-warning" : "bg-accent")}
                  style={{ width: `${spendPct}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted">
              <Bot size={36} className="opacity-40" />
              <p className="text-sm">{language === "sv" ? "Fråga din tränare om din träning." : "Ask your coach about your training."}</p>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {quickPrompts.map(q => (
                  <button key={q}
                    onClick={() => { setInput(q); textareaRef.current?.focus(); }}
                    className="px-3 py-1.5 rounded-lg border border-border text-xs hover:border-accent/40 hover:text-primary transition">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={cn("flex gap-3", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
              <div className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                msg.role === "user" ? "bg-accent/20" : "bg-surface-2 border border-border"
              )}>
                {msg.role === "user" ? <User size={14} className="text-accent" /> : <Bot size={14} className="text-muted" />}
              </div>
              <div className={cn("max-w-[80%] space-y-1.5", msg.role === "user" ? "items-end" : "items-start")}>
                {/* Tool action cards */}
                {(msg.toolActions ?? []).map((ta, i) => (
                  <ToolActionCard
                    key={i}
                    action={ta}
                    isUndone={!!ta.editId && undoneEditIds.has(ta.editId)}
                    isLocked={!!ta.editId && lockedEditIds.has(ta.editId)}
                    onApprove={ta.pending ? () => approveAction(ta) : undefined}
                    onReject={ta.pending ? rejectAction : undefined}
                    onUndo={ta.editId && !ta.pending ? () => undoEdit(ta.editId!) : undefined}
                  />
                ))}
                <div className={cn(
                  "rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-accent/10 text-primary rounded-tr-none"
                    : "bg-surface border border-border rounded-tl-none"
                )}>
                  {msg.content || (streaming && msg.role === "assistant"
                    ? (
                      <span className="flex items-center gap-2 text-muted">
                        <Loader2 size={14} className="animate-spin shrink-0" />
                        {msg.statusLabel && <span className="text-xs">{msg.statusLabel}</span>}
                      </span>
                    )
                    : "")}
                </div>
                {msg.cost !== undefined && (
                  <p className="text-[10px] text-muted px-1">${msg.cost.toFixed(4)} · {msg.tokens?.toLocaleString()} tokens</p>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        </div>

        {/* Input */}
        <div className="shrink-0 px-4 py-3 border-t border-border bg-surface">
        <div className="max-w-3xl mx-auto">
          {/* Tool picker */}
          {showToolMenu && (
            <div className="mb-2 rounded-xl border border-border bg-surface shadow-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-surface-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-muted">Tillgängliga verktyg — klicka för att använda</p>
                <button onClick={() => setShowToolMenu(false)} className="text-muted hover:text-primary text-xs">✕</button>
              </div>
              <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
                {[
                  { name: "get_fitness_summary",     desc: "VO2max, CTL, TSB, zoner, löpprognoser" },
                  { name: "get_race_history",        desc: "Alla personbästa per distans" },
                  { name: "get_readiness",           desc: "HRV, sömn, viloHR, TSB" },
                  { name: "get_wellness_history",    desc: "Hälsodata dag för dag (upp till 90 dagar)" },
                  { name: "get_training_blocks",     desc: "Aktuella och kommande träningsblock" },
                  { name: "get_upcoming_plan",       desc: "Planerade pass närmaste 14 dagarna" },
                  { name: "get_volume_stats",        desc: "Veckovolym per sport (upp till 52 veckor)" },
                  { name: "get_zone_distribution",   desc: "Tid i zon Z1–Z5 + Seiler-index" },
                  { name: "search_activities",       desc: "Hitta pass efter nyckelord, datum, sport" },
                  { name: "get_activity_detail",     desc: "Splits, HR, notering för ett specifikt pass" },
                  { name: "get_activity_stream",     desc: "Sekund-för-sekund analys av ett pass" },
                  { name: "get_activities_in_range", desc: "ALLA pass med fulldata för ett datumintervall (⚠️ kostnad)" },
                  { name: "analyze_full_history",    desc: "Flerårig aggregerad statistik och trender" },
                  { name: "get_segment_history",     desc: "Personliga insatser på ett Strava-segment" },
                  { name: "web_search",              desc: "Sök aktuell information och forskning på webben" },
                  { name: "weather_forecast",        desc: "Väderprogons 1–7 dagar framåt" },
                  { name: "search_training_research",desc: "Sök PubMed för vetenskapliga träningsstudier" },
                  { name: "create_workout",          desc: "Lägg till ett pass i träningsplanen" },
                  { name: "update_workout",          desc: "Ändra ett planerat pass" },
                  { name: "delete_workout",          desc: "Ta bort ett planerat pass" },
                  { name: "log_race_result",         desc: "Registrera ett tävlingsresultat eller PB" },
                  { name: "update_profile",          desc: "Uppdatera vikt, mål, träningserfarenhet" },
                ].map(tool => (
                  <button key={tool.name} onClick={() => selectTool(tool.name)}
                    className="w-full text-left px-3 py-2.5 hover:bg-surface-2 transition flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-primary">{TOOL_LABELS[tool.name] ?? tool.name}</p>
                      <p className="text-[10px] text-muted truncate">{tool.desc}</p>
                    </div>
                    <p className="text-[10px] text-accent/70 shrink-0 mt-0.5 hidden sm:block">/{tool.name}</p>
                  </button>
                ))}
                {/* Quick commands */}
                <div className="px-3 py-1.5 bg-surface-2 border-t border-b border-border/50">
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wide">Snabbkommandon</p>
                </div>
                {[
                  { name: "plan",    label: "/plan — Träningsplan",    desc: "Planera veckorna fram till nästa tävling" },
                  { name: "taper",   label: "/taper — Nedtrappning",   desc: "Optimal avtrappning inför en tävling" },
                  { name: "analyze", label: "/analyze — Analysera",    desc: "Djupanalys av ett specifikt träningspass" },
                  { name: "week",    label: "/week — Veckosummering",  desc: "AI-summering av förra veckan + råd inför nästa" },
                  { name: "compare", label: "/compare — Jämför perioder", desc: "Jämför din träning mellan två tidsperioder" },
                ].map(tool => (
                  <button key={tool.name} onClick={() => selectTool(tool.name)}
                    className="w-full text-left px-3 py-2.5 hover:bg-surface-2 transition flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-primary">{tool.label}</p>
                      <p className="text-[10px] text-muted truncate">{tool.desc}</p>
                    </div>
                  </button>
                ))}
                {/* Language toggle */}
                <div className="px-3 py-2.5 flex items-center justify-between border-t border-border/50">
                  <div>
                    <p className="text-xs font-semibold text-primary">Svarsspråk</p>
                    <p className="text-[10px] text-muted">Sparas i dina inställningar</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 text-xs">
                    <button onClick={() => persistLanguage("en")}
                      className={cn("px-2.5 py-1 rounded-md font-medium transition-colors",
                        language === "en" ? "bg-accent/15 text-accent" : "text-muted hover:text-primary")}>EN</button>
                    <button onClick={() => persistLanguage("sv")}
                      className={cn("px-2.5 py-1 rounded-md font-medium transition-colors",
                        language === "sv" ? "bg-accent/15 text-accent" : "text-muted hover:text-primary")}>SV</button>
                  </div>
                </div>
              </div>
              <p className="px-3 py-1.5 text-[10px] text-muted border-t border-border">Skriv / för att öppna · Esc stänger · Klicka för att välja — skriv sedan din fråga</p>
            </div>
          )}
          {messages.length >= 20 && !messages.some(m => m.content.includes("Sammanfatt")) && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-surface-2 text-xs text-muted">
              <span>Lång konversation —</span>
              <button onClick={handleSummarize} className="text-accent hover:underline">sammanfatta den</button>
              <span>för att minska tokenanvändning.</span>
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKey}
              placeholder={language === "sv" ? "Fråga din tränare… (/ för verktyg · Enter skickar)" : "Ask your coach… (/ for tools · Enter sends)"}
              rows={2}
              disabled={streaming}
              className="flex-1 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none disabled:opacity-50 transition"
            />
            <button
              onClick={send}
              disabled={!input.trim() || streaming}
              className="shrink-0 w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-white dark:text-background hover:opacity-90 disabled:opacity-40 transition">
              {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

function ToolActionCard({
  action, isUndone, isLocked, onApprove, onReject, onUndo,
}: {
  action: ToolAction;
  isUndone?: boolean;
  isLocked?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onUndo?: () => void;
}) {
  const ICONS: Record<string, React.ReactNode> = {
    create_workout:           <CalendarPlus size={14} />,
    update_workout:           <CalendarPlus size={14} />,
    delete_workout:           <Trash2 size={14} />,
    create_training_block:    <ClipboardList size={14} />,
    update_training_block:    <ClipboardList size={14} />,
    log_race_result:          <ClipboardList size={14} />,
    delete_race_result:       <Trash2 size={14} />,
    update_activity_notes:    <ClipboardList size={14} />,
    update_profile:           <UserCog size={14} />,
    get_upcoming_plan:        <ClipboardList size={14} />,
    get_fitness_summary:      <ClipboardList size={14} />,
    get_race_history:         <ClipboardList size={14} />,
    get_readiness:            <ClipboardList size={14} />,
    get_training_blocks:      <ClipboardList size={14} />,
    search_activities:        <ClipboardList size={14} />,
    get_activity_detail:      <ClipboardList size={14} />,
  };
  const label = TOOL_LABELS[action.name] ?? action.name;
  const icon  = ICONS[action.name] ?? <Bot size={14} />;

  if (action.pending) {
    return (
      <div className="border border-warning/30 bg-warning/5 rounded-xl px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2 text-xs text-warning">
          <span className="shrink-0">{icon}</span>
          <div>
            <span className="font-semibold">{label}</span>
            <p className="text-[11px] text-warning/80 mt-0.5">{action.message}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onApprove}
            className="flex-1 py-1 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90 transition">
            Godkänn
          </button>
          <button onClick={onReject}
            className="flex-1 py-1 rounded-lg border border-border text-xs text-muted hover:text-primary transition">
            Avbryt
          </button>
        </div>
      </div>
    );
  }

  if (isUndone) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs border border-border/50 bg-surface-2 text-muted">
        <Undo2 size={12} className="shrink-0" />
        <span className="font-medium line-through opacity-60">{label}</span>
        <span className="text-[10px] ml-auto opacity-60">ångrad</span>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-xl text-xs border",
      action.success
        ? "border-accent/30 bg-accent/5 text-accent"
        : "border-error/30 bg-error/5 text-error"
    )}>
      {action.success ? <CheckCircle2 size={13} className="shrink-0" /> : <XCircle size={13} className="shrink-0" />}
      <span className="shrink-0">{icon}</span>
      <span className="font-medium flex-1 truncate">{label}: {action.message}</span>
      {onUndo && action.editId && !isLocked && (
        <button
          onClick={onUndo}
          title="Ångra"
          className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded border border-current/30 hover:bg-current/10 transition text-[10px] font-semibold">
          <Undo2 size={10} />Ångra
        </button>
      )}
      {isLocked && action.editId && (
        <span className="shrink-0 text-[10px] opacity-40">låst</span>
      )}
    </div>
  );
}
