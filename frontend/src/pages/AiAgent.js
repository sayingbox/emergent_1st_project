import { useEffect, useRef, useState } from "react";
import { http, formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui-bits";
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
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

const SUGGESTED_PROMPTS = [
  "Give me a one-paragraph summary of my current GEO health.",
  "Rewrite the opening paragraph of my worst-performing page for AI citations.",
  "What meta description should I use for my highest-priority page?",
  "Which of my prompts have the biggest ranking improvement opportunity?",
];

const severityStyle = {
  info: "border-blue-200 bg-blue-50 text-blue-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  error: "border-red-200 bg-red-50 text-red-700",
};
const severityIcon = {
  info: <Info size={16} />,
  warning: <AlertTriangle size={16} />,
  error: <AlertCircle size={16} />,
};

/** Renders assistant markdown-ish content: paragraphs + fenced code blocks with Copy button. */
function AssistantMessage({ content }) {
  // Split on triple backticks
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
  // Simple: split into paragraphs & preserve bullet lines
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
            <ul key={i} className="list-disc list-inside space-y-1 text-sm leading-relaxed">
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
  // Escape HTML then apply **bold** and `inline code`
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-muted text-[12px] font-mono">$1</code>');
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
  }[lang] || lang.toUpperCase();

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
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between border-b border-emerald-200 bg-emerald-100/60">
        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
          <Sparkles size={12} /> Suggested Fix — {label}
        </span>
        <button
          onClick={doCopy}
          className="text-xs font-medium text-emerald-800 hover:text-emerald-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-emerald-200/60"
        >
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      <pre className="p-3 text-[13px] font-mono text-emerald-900 whitespace-pre-wrap break-words">{value}</pre>
    </div>
  );
}

export default function AiAgent() {
  const [sessions, setSessions] = useState([]);
  const [currentSid, setCurrentSid] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [unread, setUnread] = useState(0);
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
    } catch (e) {
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
    if (!text) return;
    if (sending) return;
    setSending(true);
    // Optimistic user message
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
      // Remove optimistic
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
      <PageHeader
        overline="Answer Engine (AEO)"
        title="AI Agent"
        subtitle="Chat with Claude Sonnet 4.6 grounded in your projects, scores, citations & rankings. Ask for content rewrites and it will hand them back ready to paste."
      />

      <div className="grid lg:grid-cols-[280px_1fr_320px] gap-5">
        {/* LEFT — Chats list */}
        <Card className="p-3 rounded-xl border-border/60 h-[70vh] flex flex-col">
          <Button onClick={newChat} className="btn-brand hover:opacity-90 w-full mb-3" data-testid="new-chat-btn">
            <Plus size={16} className="mr-1.5" /> New chat
          </Button>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-4 text-center">No chats yet. Send your first message →</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openSession(s.id)}
                  data-testid={`chat-${s.id}`}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors group flex items-start gap-2 ${
                    currentSid === s.id ? "bg-emerald-50 border border-emerald-200" : "hover:bg-muted"
                  }`}
                >
                  <MessageSquare size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0 truncate">{s.title || "New chat"}</span>
                  <button
                    onClick={(e) => deleteSession(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* CENTER — Chat */}
        <Card className="rounded-xl border-border/60 h-[70vh] flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.length === 0 && (
              <div className="h-full grid place-items-center text-center py-10">
                <div className="max-w-md">
                  <div className="mx-auto w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 grid place-items-center mb-4 shadow-lg">
                    <Bot size={28} className="text-white" />
                  </div>
                  <h3 className="font-head font-bold text-xl mb-2">Ask me anything about your GEO/AEO strategy</h3>
                  <p className="text-sm text-muted-foreground mb-5">
                    I have your projects, scores, citations, sentiment and rankings loaded. Try one of these:
                  </p>
                  <div className="grid gap-2">
                    {SUGGESTED_PROMPTS.map((p) => (
                      <button
                        key={p}
                        onClick={() => send(p)}
                        disabled={sending}
                        className="text-left text-sm px-3 py-2 rounded-lg border border-border/60 hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 grid place-items-center shrink-0 shadow">
                    <Bot size={16} className="text-white" />
                  </div>
                )}
                <div className={`max-w-[85%] ${m.role === "user" ? "bg-emerald-500 text-white" : "bg-muted"} rounded-xl px-4 py-3`}>
                  {m.role === "user" ? (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
                  ) : (
                    <AssistantMessage content={m.content} />
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 grid place-items-center shrink-0 shadow">
                  <Bot size={16} className="text-white" />
                </div>
                <div className="bg-muted rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Thinking…
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border/60 p-3 bg-white">
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                placeholder="Ask about your scores, get content rewrites, plan next steps…"
                rows={2}
                className="flex-1 resize-none rounded-lg border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                data-testid="agent-input"
                disabled={sending}
              />
              <Button
                onClick={() => send()}
                disabled={sending || !input.trim()}
                className="btn-brand hover:opacity-90 shrink-0"
                data-testid="agent-send"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
              Powered by <strong>Claude Sonnet 4.6</strong> · Enter to send · Shift+Enter for new line
            </p>
          </div>
        </Card>

        {/* RIGHT — Alerts */}
        <Card className="p-4 rounded-xl border-border/60 h-[70vh] flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-emerald-600" />
              <h4 className="font-head font-bold text-sm">Alerts</h4>
              {unread > 0 && (
                <Badge className="bg-red-500 text-white rounded-full h-5 min-w-[20px] px-1.5 text-[10px] font-bold border-0">{unread}</Badge>
              )}
            </div>
            {alerts.length > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-emerald-700 hover:underline font-medium">
                Mark all read
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {alerts.length === 0 ? (
              <EmptyState icon={Bell} text="No alerts yet. Run a project scan to see proactive notifications here." />
            ) : (
              alerts.map((a) => (
                <div
                  key={a.id}
                  className={`rounded-lg border p-3 ${a.read ? "border-border/60 bg-white opacity-70" : severityStyle[a.severity] || severityStyle.info}`}
                  data-testid={`alert-${a.id}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">{severityIcon[a.severity] || severityIcon.info}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold leading-snug">{a.title}</p>
                      <p className="text-[11px] leading-relaxed mt-1 opacity-90">{a.message}</p>
                      <div className="flex items-center gap-2 mt-2">
                        {a.link && (
                          <Link to={a.link} className="text-[11px] font-medium hover:underline flex items-center gap-1">
                            <Link2 size={11} /> Open
                          </Link>
                        )}
                        {!a.read && (
                          <button onClick={() => markAlertRead(a.id)} className="text-[11px] font-medium hover:underline">
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
        </Card>
      </div>
    </div>
  );
}
