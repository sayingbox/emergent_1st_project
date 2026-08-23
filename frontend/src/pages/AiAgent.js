import { useEffect, useRef, useState } from "react";
import { http, formatApiErrorDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui-bits";
import {
  Bot,
  Send,
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  Copy,
  Check,
  Bell,
  AlertTriangle,
  AlertCircle,
  Info,
  Link2,
  MessageSquare,
  Wand2,
  BarChart3,
  Target,
  FileText,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

const SUGGESTED_PROMPTS = [
  { icon: BarChart3, text: "Give me a one-paragraph summary of my current GEO health." },
  { icon: FileText, text: "Rewrite the opening paragraph of my worst-performing page for AI citations." },
  { icon: Wand2, text: "What meta description should I use for my highest-priority page?" },
  { icon: Target, text: "Which of my prompts have the biggest ranking improvement opportunity?" },
];

const severityDot = {
  info: "bg-blue-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};
const severityIcon = {
  info: <Info size={14} className="text-blue-600" />,
  warning: <AlertTriangle size={14} className="text-amber-600" />,
  error: <AlertCircle size={14} className="text-red-600" />,
};
const severityRing = {
  info: "ring-blue-100",
  warning: "ring-amber-100",
  error: "ring-red-100",
};

/* ------------------------------------------------------------------ */
/* Markdown-lite renderer for assistant messages                       */
/* ------------------------------------------------------------------ */
function AssistantMessage({ content }) {
  const parts = [];
  const regex = /```(\w+)?\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let m;
  while ((m = regex.exec(content)) !== null) {
    if (m.index > lastIndex) parts.push({ type: "text", value: content.slice(lastIndex, m.index) });
    parts.push({ type: "code", lang: m[1] || "text", value: m[2].trim() });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) parts.push({ type: "text", value: content.slice(lastIndex) });

  return (
    <div className="space-y-3">
      {parts.map((p, i) =>
        p.type === "code" ? (
          <CodeBlock key={i} lang={p.lang} value={p.value} />
        ) : (
          <TextBlock key={i} value={p.value} />
        )
      )}
    </div>
  );
}

function TextBlock({ value }) {
  const lines = value.replace(/\n{3,}/g, "\n\n").trim().split("\n");
  const blocks = [];
  let buf = [];
  const flush = () => { if (buf.length) { blocks.push(buf.join("\n")); buf = []; } };
  lines.forEach((ln) => {
    if (ln.trim() === "") { flush(); } else { buf.push(ln); }
  });
  flush();

  return (
    <>
      {blocks.map((b, i) => {
        const isBullet = /^\s*[-*]\s+/.test(b) || /^\s*\d+\.\s+/.test(b);
        if (isBullet) {
          const items = b.split("\n").map((l) => l.replace(/^\s*[-*]\s+/, "").replace(/^\s*\d+\.\s+/, ""));
          return (
            <ul key={i} className="list-disc list-inside space-y-1.5 text-sm leading-relaxed marker:text-emerald-500">
              {items.map((it, j) => <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(it) }} />)}
            </ul>
          );
        }
        return <p key={i} className="text-sm leading-relaxed whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderInline(b) }} />;
      })}
    </>
  );
}

function renderInline(s) {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-white/60 border border-emerald-200/60 text-[12px] font-mono text-emerald-800">$1</code>');
}

function CodeBlock({ lang, value }) {
  const [copied, setCopied] = useState(false);
  const label = {
    meta: "Meta / Title",
    paragraph: "Rewritten Paragraph",
    heading: "Heading",
    html: "HTML",
    json: "JSON-LD",
    faq: "FAQ",
  }[lang] || (lang || "code").toUpperCase();

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50/60 overflow-hidden shadow-sm">
      <div className="px-3.5 py-2 flex items-center justify-between border-b border-emerald-200/70 bg-white/50">
        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
          <Sparkles size={12} className="text-emerald-600" /> Suggested Fix · {label}
        </span>
        <button
          onClick={doCopy}
          className="text-[11px] font-semibold text-emerald-800 hover:text-emerald-900 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 transition-colors"
        >
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      <pre className="p-3.5 text-[13px] font-mono text-emerald-950 whitespace-pre-wrap break-words leading-relaxed">{value}</pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Typing dots indicator                                               */
/* ------------------------------------------------------------------ */
function TypingDots() {
  return (
    <div className="flex items-center gap-1 h-4">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "120ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "240ms" }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */
export default function AiAgent() {
  const [sessions, setSessions] = useState([]);
  const [currentSid, setCurrentSid] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [unread, setUnread] = useState(0);
  const [leftTab, setLeftTab] = useState("chats"); // "chats" | "alerts"
  const scrollRef = useRef(null);

  const loadSessions = async () => {
    try {
      const r = await http.get("/agent/sessions");
      setSessions(r.data || []);
    } catch { /* ignore */ }
  };

  const loadAlerts = async () => {
    try {
      const r = await http.get("/alerts");
      setAlerts(r.data.alerts || []);
      setUnread(r.data.unread_count || 0);
    } catch { /* ignore */ }
  };

  const openSession = async (sid) => {
    try {
      const r = await http.get(`/agent/sessions/${sid}`);
      setCurrentSid(sid);
      setMessages(r.data.messages || []);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 9e9, behavior: "smooth" }), 100);
    } catch {
      toast.error("Could not open chat");
    }
  };

  const newChat = () => {
    setCurrentSid(null);
    setMessages([]);
    setInput("");
  };

  const deleteSession = async (sid, e) => {
    e.stopPropagation();
    if (!window.confirm("Delete this chat?")) return;
    try {
      await http.delete(`/agent/sessions/${sid}`);
      if (currentSid === sid) newChat();
      loadSessions();
    } catch { toast.error("Delete failed"); }
  };

  const send = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    setSending(true);
    const optimistic = { id: `tmp-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setTimeout(() => scrollRef.current?.scrollTo({ top: 9e9, behavior: "smooth" }), 50);
    try {
      const r = await http.post("/agent/chat", { message: text, session_id: currentSid || undefined });
      const sid = r.data.session_id;
      if (!currentSid) setCurrentSid(sid);
      setMessages((prev) => {
        const withoutTmp = prev.filter((m) => m.id !== optimistic.id);
        return [...withoutTmp, r.data.user_message, r.data.assistant_message];
      });
      setTimeout(() => scrollRef.current?.scrollTo({ top: 9e9, behavior: "smooth" }), 100);
      loadSessions();
      loadAlerts();
    } catch (e) {
      const detail = formatApiErrorDetail(e?.response?.data?.detail) || "Agent failed to respond";
      toast.error(detail);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  };

  const markAlertRead = async (aid) => {
    try {
      await http.post(`/alerts/${aid}/read`);
      loadAlerts();
    } catch { /* ignore */ }
  };
  const markAllRead = async () => {
    try {
      await http.post("/alerts/read-all");
      loadAlerts();
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadSessions();
    loadAlerts();
  }, []);

  return (
    <div>
      {/* ================== HERO ================== */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-white to-teal-50/60 p-6 sm:p-7 mb-6 shadow-sm">
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-emerald-200/25 blur-3xl" />
        <div className="absolute -bottom-20 -left-16 w-64 h-64 rounded-full bg-teal-200/30 blur-3xl" />
        <div className="relative flex flex-col sm:flex-row gap-5 sm:items-center">
          <div className="relative shrink-0">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 grid place-items-center shadow-lg shadow-emerald-500/30">
              <Bot size={28} className="text-white" />
            </div>
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] font-bold text-emerald-700 mb-1">Citetail Assistant</div>
            <h1 className="font-head font-extrabold text-2xl sm:text-3xl leading-tight">
              <span className="gradient-text">AI Agent</span>
              <span className="text-foreground"> — grounded in your data</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
              Chat with Claude Sonnet 4.6 loaded with your projects, scores, citations and rankings. Ask for concrete content rewrites — get them back ready to paste.
            </p>
          </div>
          <Button onClick={newChat} className="btn-brand hover:opacity-90 shrink-0" data-testid="new-chat-btn">
            <Plus size={16} className="mr-1.5" /> New chat
          </Button>
        </div>
      </div>

      {/* ================== BODY: LEFT (tabs) + RIGHT (chat) ================== */}
      <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        {/* LEFT — Tabbed panel */}
        <div className="rounded-2xl border border-border/60 bg-white overflow-hidden flex flex-col h-[72vh]">
          <div className="grid grid-cols-2 border-b border-border/60 bg-muted/30">
            <button
              onClick={() => setLeftTab("chats")}
              data-testid="tab-chats"
              className={`px-4 py-3 text-sm font-semibold transition-colors relative ${
                leftTab === "chats" ? "text-emerald-700 bg-white" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <MessageSquare size={14} /> Chats
                {sessions.length > 0 && (
                  <span className="text-[10px] font-bold text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">{sessions.length}</span>
                )}
              </span>
              {leftTab === "chats" && <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-emerald-500 rounded-full" />}
            </button>
            <button
              onClick={() => setLeftTab("alerts")}
              data-testid="tab-alerts"
              className={`px-4 py-3 text-sm font-semibold transition-colors relative ${
                leftTab === "alerts" ? "text-emerald-700 bg-white" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Bell size={14} /> Alerts
                {unread > 0 && (
                  <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 min-w-[18px] inline-block">{unread > 9 ? "9+" : unread}</span>
                )}
              </span>
              {leftTab === "alerts" && <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-emerald-500 rounded-full" />}
            </button>
          </div>

          {/* CHATS list */}
          {leftTab === "chats" && (
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {sessions.length === 0 ? (
                <div className="p-6 text-center">
                  <MessageSquare size={22} className="mx-auto text-muted-foreground/60 mb-2" />
                  <p className="text-xs text-muted-foreground">No chats yet.<br />Send your first message →</p>
                </div>
              ) : (
                sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => openSession(s.id)}
                    data-testid={`chat-${s.id}`}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all group flex items-start gap-2.5 ${
                      currentSid === s.id
                        ? "bg-gradient-to-r from-emerald-50 to-teal-50/60 border border-emerald-200 shadow-sm"
                        : "hover:bg-muted border border-transparent"
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 ${
                      currentSid === s.id ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                    }`}>
                      <MessageSquare size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`truncate font-medium ${currentSid === s.id ? "text-emerald-900" : "text-foreground"}`}>{s.title || "New chat"}</p>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {new Date(s.updated_at || s.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <button
                      onClick={(e) => deleteSession(s.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-600 shrink-0 mt-0.5"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </button>
                ))
              )}
            </div>
          )}

          {/* ALERTS list */}
          {leftTab === "alerts" && (
            <div className="flex-1 overflow-y-auto flex flex-col">
              {alerts.length > 0 && (
                <div className="px-4 py-2.5 flex items-center justify-between border-b border-border/60 bg-muted/20">
                  <span className="text-[11px] text-muted-foreground font-medium">
                    {unread > 0 ? `${unread} unread of ${alerts.length}` : `All ${alerts.length} read`}
                  </span>
                  {unread > 0 && (
                    <button onClick={markAllRead} className="text-[11px] text-emerald-700 hover:underline font-semibold">
                      Mark all read
                    </button>
                  )}
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {alerts.length === 0 ? (
                  <div className="p-6">
                    <EmptyState icon={Bell} text="No alerts yet. Run a project scan to see proactive notifications here." />
                  </div>
                ) : (
                  alerts.map((a) => (
                    <div
                      key={a.id}
                      data-testid={`alert-${a.id}`}
                      className={`relative rounded-lg border p-3 transition-all bg-white ${
                        a.read ? "border-border/40 opacity-60" : `border-border/60 hover:border-border ring-1 ${severityRing[a.severity] || severityRing.info}`
                      }`}
                    >
                      {!a.read && (
                        <span className={`absolute top-3 right-3 w-2 h-2 rounded-full ${severityDot[a.severity] || severityDot.info}`} />
                      )}
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0">{severityIcon[a.severity] || severityIcon.info}</span>
                        <div className="flex-1 min-w-0 pr-3">
                          <p className="text-[13px] font-semibold leading-snug text-foreground">{a.title}</p>
                          <p className="text-[11.5px] text-muted-foreground leading-relaxed mt-1">{a.message}</p>
                          <div className="flex items-center gap-3 mt-2">
                            {a.link && (
                              <Link to={a.link} className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1">
                                <Link2 size={11} /> Open <ArrowRight size={10} />
                              </Link>
                            )}
                            {!a.read && (
                              <button onClick={() => markAlertRead(a.id)} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
                                Mark read
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Chat area */}
        <div className="rounded-2xl border border-border/60 bg-white h-[72vh] flex flex-col overflow-hidden shadow-sm">
          {/* Chat header */}
          <div className="px-5 py-3 border-b border-border/60 flex items-center gap-3 bg-gradient-to-r from-white to-emerald-50/40">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 grid place-items-center shadow-sm">
              <Bot size={16} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-head font-bold text-sm leading-tight">Citetail Assistant</p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Online · Powered by Claude Sonnet 4.6
              </p>
            </div>
            {currentSid && (
              <Badge className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5">
                {messages.length} messages
              </Badge>
            )}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6 space-y-5 bg-[radial-gradient(circle_at_50%_-20%,rgba(24,192,144,0.04),transparent_60%)]">
            {messages.length === 0 && (
              <div className="h-full grid place-items-center text-center py-6">
                <div className="max-w-md">
                  <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 grid place-items-center mb-4 shadow-xl shadow-emerald-500/30">
                    <Sparkles size={28} className="text-white" />
                  </div>
                  <h3 className="font-head font-bold text-xl mb-2">How can I help improve your visibility?</h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    I have your projects, scores, citations, sentiment and rankings loaded. Ask me anything or try a prompt below.
                  </p>
                  <div className="grid gap-2">
                    {SUGGESTED_PROMPTS.map((p) => (
                      <button
                        key={p.text}
                        onClick={() => send(p.text)}
                        disabled={sending}
                        className="text-left text-sm px-3.5 py-3 rounded-xl border border-border/60 hover:border-emerald-300 hover:bg-emerald-50/50 transition-all group flex items-center gap-3"
                      >
                        <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center shrink-0 group-hover:bg-emerald-200 transition-colors">
                          <p.icon size={15} />
                        </span>
                        <span className="flex-1">{p.text}</span>
                        <ArrowRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role === "assistant" && (
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 grid place-items-center shrink-0 shadow-sm ring-2 ring-emerald-50">
                    <Bot size={16} className="text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    m.role === "user"
                      ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/20 rounded-br-md"
                      : "bg-white border border-border/60 shadow-sm rounded-tl-md"
                  }`}
                >
                  {m.role === "user" ? (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
                  ) : (
                    <AssistantMessage content={m.content} />
                  )}
                </div>
                {m.role === "user" && (
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 grid place-items-center shrink-0 shadow-sm text-white text-xs font-bold">
                    You
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 grid place-items-center shrink-0 shadow-sm ring-2 ring-emerald-50">
                  <Bot size={16} className="text-white" />
                </div>
                <div className="bg-white border border-border/60 rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-2.5 shadow-sm">
                  <TypingDots />
                  <span className="text-[12px] text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border/60 p-3 bg-white">
            <div className="flex gap-2 items-end p-1.5 pr-1.5 rounded-2xl border border-border/70 bg-muted/30 focus-within:border-emerald-300 focus-within:bg-white transition-colors">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                placeholder="Ask about your scores, request content rewrites, plan next steps…"
                rows={1}
                className="flex-1 resize-none bg-transparent px-3 py-2 text-sm focus:outline-none placeholder:text-muted-foreground/70 max-h-32"
                data-testid="agent-input"
                disabled={sending}
                style={{ minHeight: "40px" }}
              />
              <Button
                onClick={() => send()}
                disabled={sending || !input.trim()}
                className="btn-brand hover:opacity-90 shrink-0 h-10 w-10 rounded-xl p-0"
                data-testid="agent-send"
                title="Send (Enter)"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 px-2 flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/60 text-[9px] font-mono">Enter</kbd> to send</span>
              <span className="inline-flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/60 text-[9px] font-mono">Shift + Enter</kbd> new line</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
