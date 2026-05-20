"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Bot, User, Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  cost?: number;
  tokens?: number;
  modelUsed?: string;
}

interface ConvSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface Props {
  provider: "claude" | "gemini";
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
  const [streaming, setStreaming] = useState(false);
  const [sessionCost, setSessionCost] = useState(0);
  const [convId, setConvId] = useState<string | undefined>(initialConversationId);
  const [totalSpend, setTotalSpend] = useState(currentSpend);
  const [sidebarOpen, setSidebarOpen] = useState(conversations.length > 0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const spendPct = monthlyBudget > 0 ? Math.min((totalSpend / monthlyBudget) * 100, 100) : 0;

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, message: text }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        let errMsg = err.error ?? "Unknown error";
        if (err.error === "budget_exceeded") {
          errMsg = `Monthly budget reached ($${err.budget?.toFixed(2)} limit). Reset in Settings or increase the budget.`;
        } else if (err.error === "no_api_key") {
          errMsg = "No API key configured. Add one in Settings → AI Coach.";
        }
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: errMsg } : m
        ));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let msgCost = 0;
      let gotDone = false;

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
            // Update URL without full navigation so user can bookmark/share
            window.history.replaceState(null, "", `/coach?conv=${data.convId}`);
          }
          if (data.text) {
            fullContent += data.text as string;
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, content: fullContent } : m
            ));
          }
          if (data.done) {
            gotDone = true;
            msgCost = (data.cost as number) ?? 0;
            setSessionCost(s => s + msgCost);
            setTotalSpend(s => s + msgCost);
            setMessages(prev => prev.map(m =>
              m.id === assistantId
                ? { ...m, cost: msgCost, tokens: ((data.inputTokens as number) ?? 0) + ((data.outputTokens as number) ?? 0), modelUsed: provider }
                : m
            ));
          }
          if (data.error) {
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, content: `Error: ${data.error}` } : m
            ));
          }
        }
      }

      if (!gotDone || !fullContent.trim()) {
        setMessages(prev => prev.map(m =>
          m.id === assistantId && !m.content
            ? { ...m, content: "Inget svar mottaget. Kontrollera att din API-nyckel är korrekt och att budgeten inte är uppnådd." }
            : m
        ));
      }
    } finally {
      setStreaming(false);
      textareaRef.current?.focus();
    }
  }, [input, streaming, convId, provider]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Radera denna chatt?")) return;
    setDeletingId(id);
    await fetch(`/api/coach/conversations/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (id === convId) {
      router.push("/coach");
    } else {
      router.refresh();
    }
  }

  function newConversation() {
    router.push("/coach");
    // Reset state immediately for instant feel
    setMessages([]);
    setConvId(undefined);
    setSessionCost(0);
    window.history.replaceState(null, "", "/coach");
  }

  if (!hasApiKey) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-sm text-center space-y-3">
          <Bot size={40} className="mx-auto text-muted" />
          <p className="text-primary font-semibold">No API key configured</p>
          <p className="text-sm text-muted">
            Add a Claude or Gemini API key in{" "}
            <a href="/settings" className="text-accent hover:underline">Settings</a>{" "}
            to start chatting with your coach.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full overflow-hidden">

      {/* ── Conversation sidebar ── */}
      <div className={cn(
        "shrink-0 border-r border-border bg-surface flex flex-col transition-all duration-200",
        sidebarOpen ? "w-56" : "w-10"
      )}>
        {/* Toggle */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          className="flex items-center justify-center h-10 w-full border-b border-border text-muted hover:text-primary transition shrink-0"
          title={sidebarOpen ? "Hide conversations" : "Show conversations"}
        >
          {sidebarOpen ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
        </button>

        {sidebarOpen && (
          <>
            <button
              onClick={newConversation}
              className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-accent hover:bg-accent/5 transition border-b border-border"
            >
              <Plus size={13} />
              Ny chatt
            </button>

            <div className="flex-1 overflow-y-auto">
              {conversations.map(c => (
                <a
                  key={c.id}
                  href={`/coach?conv=${c.id}`}
                  className={cn(
                    "group flex items-start gap-1 px-2 py-2.5 border-b border-border/50 hover:bg-surface-2 transition",
                    c.id === convId ? "bg-accent/5 border-l-2 border-l-accent" : ""
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-primary truncate leading-snug">{c.title}</p>
                    <p className="text-[10px] text-muted mt-0.5">{c.messageCount} meddelanden</p>
                  </div>
                  <button
                    onClick={e => deleteConversation(c.id, e)}
                    disabled={deletingId === c.id}
                    className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 text-muted hover:text-error transition"
                    title="Radera chatt"
                  >
                    {deletingId === c.id
                      ? <Loader2 size={11} className="animate-spin" />
                      : <Trash2 size={11} />}
                  </button>
                </a>
              ))}
              {conversations.length === 0 && (
                <p className="px-3 py-4 text-[10px] text-muted">Inga tidigare chattar</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Main chat area ── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Cost header */}
        <div className="shrink-0 flex items-center gap-4 px-4 py-2 border-b border-border bg-surface text-xs text-muted">
          <span>
            Provider: <span className="text-primary capitalize font-medium">{provider === "claude" ? "Claude Sonnet" : "Gemini Flash"}</span>
          </span>
          {sessionCost > 0 && (
            <span>Session: <span className="font-mono text-primary">${sessionCost.toFixed(4)}</span></span>
          )}
          {monthlyBudget > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className={cn(
                "font-mono",
                spendPct >= 100 ? "text-error" : spendPct >= 80 ? "text-warning" : "text-muted"
              )}>
                ${totalSpend.toFixed(3)} / ${monthlyBudget} budget
              </span>
              <div className="w-20 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", spendPct >= 100 ? "bg-error" : spendPct >= 80 ? "bg-warning" : "bg-accent")}
                  style={{ width: `${spendPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted">
              <Bot size={36} className="opacity-40" />
              <p className="text-sm">Ask your coach anything about your training.</p>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {["Hur ser min form ut just nu?", "Planera nästa 4 veckor", "Varför är mitt tempo långsamt?", "Vad är mitt VO2max?"].map(q => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); textareaRef.current?.focus(); }}
                    className="px-3 py-1.5 rounded-lg border border-border text-xs hover:border-accent/40 hover:text-primary transition"
                  >
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

              <div className={cn("max-w-[80%] space-y-1", msg.role === "user" ? "items-end" : "items-start")}>
                <div className={cn(
                  "rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-accent/10 text-primary rounded-tr-none"
                    : "bg-surface border border-border rounded-tl-none"
                )}>
                  {msg.content || (streaming && msg.role === "assistant" ? (
                    <Loader2 size={14} className="animate-spin text-muted" />
                  ) : "")}
                </div>
                {msg.cost !== undefined && (
                  <p className="text-[10px] text-muted px-1">
                    ${msg.cost.toFixed(4)} · {msg.tokens?.toLocaleString()} tokens · {msg.modelUsed}
                  </p>
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-4 py-3 border-t border-border bg-surface">
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Fråga din tränare… (Enter skickar, Shift+Enter ny rad)"
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
