"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Bot, User, Plus, Trash2, ChevronLeft, ChevronRight, CheckCircle2, XCircle, CalendarPlus, ClipboardList, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

interface ToolAction {
  name: string;
  message: string;
  success: boolean;
  pending?: boolean;
  pendingInput?: Record<string, unknown>;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  cost?: number;
  tokens?: number;
  modelUsed?: string;
  toolAction?: ToolAction;
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
}

export function ChatInterface({
  provider, hasApiKey, monthlyBudget, currentSpend,
  initialConversationId, initialMessages = [], conversations,
}: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [showToolMenu, setShowToolMenu] = useState(false);
  const [language, setLanguage] = useState<"en" | "sv">("en");
  const [streaming, setStreaming] = useState(false);
  const [sessionCost, setSessionCost] = useState(0);
  const [convId, setConvId] = useState<string | undefined>(initialConversationId);
  const [totalSpend, setTotalSpend] = useState(currentSpend);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    // Only auto-scroll if user is within 120px of the bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 120) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      rafRef.current = null;
    });
  }, [messages]);

  const spendPct = monthlyBudget > 0 ? Math.min((totalSpend / monthlyBudget) * 100, 100) : 0;

  async function approveAction(action: ToolAction) {
    const confirmText = `Yes, perform: ${action.message}`;
    await sendWithPayload(confirmText, { toolName: action.name, toolInput: action.pendingInput ?? {} });
  }

  async function rejectAction() {
    await sendWithPayload("No, cancel that.");
  }

  const sendWithPayload = useCallback(async (text: string, approvedAction?: { toolName: string; toolInput: Record<string, unknown> }) => {
    if (streaming) return;
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    const assistantId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, message: text, language, ...(approvedAction ? { approvedAction } : {}) }),
      });
      await processStream(res, assistantId);
    } finally {
      setStreaming(false);
      textareaRef.current?.focus();
    }
  }, [streaming, convId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function processStream(res: Response, assistantId: string) {
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      let errMsg = err.error ?? "Unknown error";
      if (err.error === "budget_exceeded")
        errMsg = `Monthly budget reached ($${err.budget?.toFixed(2)}). Change it in Settings.`;
      else if (err.error === "no_api_key")
        errMsg = "No API key configured. Add one in Settings → AI Coach.";
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: errMsg } : m));
      return;
    }
    const reader = res.body.getReader();
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
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, toolAction: tc } : m));
        }
          if (data.text) {
            fullContent += data.text as string;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
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
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${data.error}` } : m));
          }
        }
      }

    if (!gotDone || !fullContent.trim()) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId && !m.content
          ? { ...m, content: "Inget svar mottaget. Kontrollera API-nyckeln och budgeten." }
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
    // Open menu whenever "/" is typed (at any position in the input)
    if (val.length > prev.length && val[val.length - 1] === "/") {
      setShowToolMenu(true);
    } else if (!val.includes("/")) {
      setShowToolMenu(false);
    }
  }

  function selectTool(hint: string) {
    // Insert the example query (minus "ex: " prefix) so user can complete it
    const text = hint.replace(/^ex:\s*/i, "");
    setInput(text);
    setShowToolMenu(false);
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
    if (id === convId) {
      setMessages([]);
      setConvId(undefined);
      window.history.replaceState(null, "", "/coach");
    }
    router.refresh();
  }

  function newConversation() {
    setMessages([]);
    setConvId(undefined);
    setSessionCost(0);
    window.history.replaceState(null, "", "/coach");
    textareaRef.current?.focus();
  }

  if (!hasApiKey) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-sm text-center space-y-3">
          <Bot size={40} className="mx-auto text-muted" />
          <p className="text-primary font-semibold">No API key configured</p>
          <p className="text-sm text-muted">
            Add a Claude or Gemini key in{" "}
            <a href="/settings" className="text-accent hover:underline">Settings</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Conversation sidebar ── */}
      <div className={cn(
        "flex flex-col border-r border-border bg-surface overflow-hidden transition-all duration-200 shrink-0",
        sidebarOpen ? "w-52" : "w-10"
      )}>
        {/* Toggle button */}
        <div className="flex items-center border-b border-border shrink-0 h-10">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="flex items-center justify-center w-10 h-10 text-muted hover:text-primary transition shrink-0"
          >
            {sidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
          {sidebarOpen && (
            <button
              onClick={newConversation}
              className="flex-1 flex items-center gap-1.5 px-2 h-full text-xs font-medium text-accent hover:bg-accent/5 transition"
            >
              <Plus size={12} />Ny chatt
            </button>
          )}
        </div>

        {/* Conversation list */}
        {sidebarOpen && (
          <div className="flex-1 overflow-y-auto">
            {conversations.map(c => (
              <div
                key={c.id}
                className={cn(
                  "relative border-b border-border/40",
                  c.id === convId ? "bg-accent/8 border-l-2 border-l-accent" : "hover:bg-surface-2"
                )}
              >
                <a
                  href={`/coach?conv=${c.id}`}
                  className="block px-3 py-2.5 pr-8"
                >
                  <p className="text-xs font-medium text-primary truncate leading-snug">{c.title}</p>
                  <p className="text-[10px] text-muted mt-0.5">
                    {format(parseISO(c.updatedAt), "d MMM")} · {c.messageCount} msg
                  </p>
                </a>
                {confirmDeleteId === c.id ? (
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    <button
                      onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirmDeleteId(null); }}
                      className="px-1.5 py-0.5 rounded text-[10px] text-muted hover:bg-surface-2 transition"
                    >Nej</button>
                    <button
                      onClick={e => deleteConversation(c.id, e)}
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-error bg-error/10 hover:bg-error/20 transition"
                    >Ja</button>
                  </div>
                ) : (
                  <button
                    onClick={e => deleteConversation(c.id, e)}
                    disabled={deletingId === c.id}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted/40 hover:text-error hover:bg-error/10 transition disabled:opacity-50"
                    title="Delete chat"
                  >
                    {deletingId === c.id
                      ? <Loader2 size={11} className="animate-spin" />
                      : <Trash2 size={11} />}
                  </button>
                )}
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="px-3 py-4 text-[10px] text-muted">No chats yet</p>
            )}
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
              <span className={cn("font-mono text-[11px]",
                spendPct >= 100 ? "text-error" : spendPct >= 80 ? "text-warning" : "")}>
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
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted">
              <Bot size={36} className="opacity-40" />
              <p className="text-sm">Fråga din tränare om din träning.</p>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {["How is my fitness?", "Plan next 4 weeks", "What is my VO2max?", "Analyze my last week"].map(q => (
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
                {/* Tool action card — shown above the text response */}
                {msg.toolAction && (
                  <ToolActionCard
                    action={msg.toolAction}
                    onApprove={() => approveAction(msg.toolAction!)}
                    onReject={rejectAction}
                  />
                )}
                <div className={cn(
                  "rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-accent/10 text-primary rounded-tr-none"
                    : "bg-surface border border-border rounded-tl-none"
                )}>
                  {msg.content || (streaming && msg.role === "assistant"
                    ? <Loader2 size={14} className="animate-spin text-muted" />
                    : "")}
                </div>
                {msg.cost !== undefined && (
                  <p className="text-[10px] text-muted px-1">
                    ${msg.cost.toFixed(4)} · {msg.tokens?.toLocaleString()} tokens
                  </p>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-4 py-3 border-t border-border bg-surface">
          {/* Tool picker — shown when user types "/" */}
          {showToolMenu && (
            <div className="mb-2 rounded-xl border border-border bg-surface shadow-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-surface-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-muted">Available tools — click to use</p>
                <button onClick={() => setShowToolMenu(false)} className="text-muted hover:text-primary text-xs">✕</button>
              </div>
              <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
                {[
                  { name: "get_fitness_summary", label: "Fitness summary", desc: "VO2max, CTL, TSB, zones, predictions", hint: "e.g. Show my fitness summary" },
                  { name: "get_race_history", label: "Race history / PBs", desc: "All personal bests by distance", hint: "e.g. Show all my PBs" },
                  { name: "get_readiness", label: "Readiness today", desc: "HRV, sleep, resting HR, TSB", hint: "e.g. How is my recovery today?" },
                  { name: "get_training_blocks", label: "Training blocks", desc: "Current and upcoming training blocks", hint: "e.g. Show my training blocks" },
                  { name: "get_upcoming_plan", label: "Upcoming plan", desc: "Planned sessions next 14 days", hint: "e.g. Show my training plan for the next 2 weeks" },
                  { name: "search_activities", label: "Search activities", desc: "Find sessions by keyword, date, sport", hint: "e.g. Find my runs from May 2025" },
                  { name: "get_activity_detail", label: "Activity detail", desc: "Full splits, HR, description for one session", hint: "e.g. Show details for my last interval session" },
                  { name: "get_activities_in_range", label: "Activities in range ⚠️ cost", desc: "ALL activities with full data — requires confirmation", hint: "e.g. Analyze all my sessions from May 2025" },
                  { name: "analyze_full_history", label: "Full history analysis", desc: "Multi-year aggregated stats", hint: "e.g. Analyze my training history for the last 3 years" },
                  { name: "create_workout", label: "Create workout", desc: "Add a session to the training plan", hint: "e.g. Add an easy 10km run on Friday" },
                  { name: "get_upcoming_plan + delete_workout", label: "Delete workout", desc: "Remove a planned session", hint: "e.g. Remove Friday's session" },
                  { name: "update_profile", label: "Update profile", desc: "Change weight, goal, training years", hint: "ex: Uppdatera min vikt till 72kg" },
                ].map(tool => (
                  <button
                    key={tool.name}
                    onClick={() => selectTool(tool.hint)}
                    className="w-full text-left px-3 py-2.5 hover:bg-surface-2 transition flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-primary">{tool.label}</p>
                      <p className="text-[10px] text-muted truncate">{tool.desc}</p>
                    </div>
                    <p className="text-[10px] text-accent/70 shrink-0 mt-0.5 hidden sm:block">{tool.hint}</p>
                  </button>
                ))}
                {/* Language toggle — special action, not a message */}
                <div className="px-3 py-2.5 flex items-center justify-between border-t border-border/50">
                  <div>
                    <p className="text-xs font-semibold text-primary">Language</p>
                    <p className="text-[10px] text-muted">Response language for this chat</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 text-xs">
                    <button
                      onClick={() => { setLanguage("en"); setShowToolMenu(false); }}
                      className={cn("px-2.5 py-1 rounded-md font-medium transition-colors",
                        language === "en" ? "bg-accent/15 text-accent" : "text-muted hover:text-primary")}
                    >EN</button>
                    <button
                      onClick={() => { setLanguage("sv"); setShowToolMenu(false); }}
                      className={cn("px-2.5 py-1 rounded-md font-medium transition-colors",
                        language === "sv" ? "bg-accent/15 text-accent" : "text-muted hover:text-primary")}
                    >SV</button>
                  </div>
                </div>
              </div>
              <p className="px-3 py-1.5 text-[10px] text-muted border-t border-border">Skriv / för att öppna · Esc stänger · Klicka för att välja — skriv sedan din egna fråga</p>
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKey}
              placeholder="Fråga din tränare… (/ för verktyg · Enter skickar)"
              rows={2}
              disabled={streaming}
              className="flex-1 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none disabled:opacity-50 transition"
            />
            <button
              onClick={send}
              disabled={!input.trim() || streaming}
              className="shrink-0 w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-white dark:text-background hover:opacity-90 disabled:opacity-40 transition"
            >
              {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolActionCard({ action, onApprove, onReject }: {
  action: ToolAction;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const ICONS: Record<string, React.ReactNode> = {
    create_workout:    <CalendarPlus size={14} />,
    get_upcoming_plan: <ClipboardList size={14} />,
    get_fitness_summary: <ClipboardList size={14} />,
    get_race_history:  <ClipboardList size={14} />,
    get_readiness:     <ClipboardList size={14} />,
    get_training_blocks: <ClipboardList size={14} />,
    search_activities: <ClipboardList size={14} />,
    get_activity_detail: <ClipboardList size={14} />,
    delete_workout:    <Trash2 size={14} />,
    update_profile:    <UserCog size={14} />,
  };
  const icon = ICONS[action.name] ?? <Bot size={14} />;

  if (action.pending) {
    return (
      <div className="border border-warning/30 bg-warning/5 rounded-xl px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2 text-xs text-warning">
          <span className="shrink-0">{icon}</span>
          <span className="font-medium">{action.message}</span>
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

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-xl text-xs border",
      action.success
        ? "border-accent/30 bg-accent/5 text-accent"
        : "border-error/30 bg-error/5 text-error"
    )}>
      {action.success
        ? <CheckCircle2 size={13} className="shrink-0" />
        : <XCircle size={13} className="shrink-0" />}
      <span className="shrink-0">{icon}</span>
      <span className="font-medium">{action.message}</span>
    </div>
  );
}
