import { useEffect, useState } from "react";
import { useSessionState } from "@/hooks/useSessionState";
import { http, formatApiErrorDetail } from "@/lib/api";
import {
  startSingleShotJob,
  subscribe as subscribeJob,
  setResult as setJobResult,
  getState as getJobState,
} from "@/lib/jobRegistry";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { scoreColor } from "@/components/ScoreGauge";
import {
  Smile,
  Meh,
  Frown,
  Loader2,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Lightbulb,
  Heart,
} from "lucide-react";
import { toast } from "sonner";

const JOB_KEY = "sentiment";

const labelStyle = {
  positive: "bg-green-100 text-green-700 border-green-200",
  neutral: "bg-gray-100 text-gray-700 border-gray-200",
  negative: "bg-red-100 text-red-700 border-red-200",
};

const labelIcon = {
  positive: <Smile size={14} />,
  neutral: <Meh size={14} />,
  negative: <Frown size={14} />,
};

// Simple SVG donut chart for pos/neu/neg
function SentimentDonut({ pos = 0, neu = 0, neg = 0, score = 0 }) {
  const total = Math.max(1, pos + neu + neg);
  const segs = [
    { v: pos, color: "#10b981", label: "Positive" },
    { v: neu, color: "#94a3b8", label: "Neutral" },
    { v: neg, color: "#ef4444", label: "Negative" },
  ];
  const r = 62;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const color = scoreColor(score);
  return (
    <div className="flex items-center gap-6">
      <div className="relative w-[170px] h-[170px] shrink-0">
        <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
          <circle cx="80" cy="80" r={r} fill="none" stroke="#eef2f7" strokeWidth="16" />
          {segs.map((s, i) => {
            const len = (s.v / total) * c;
            const el = (
              <circle
                key={i}
                cx="80"
                cy="80"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="16"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="font-head font-extrabold text-3xl" style={{ color }}>{score}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Overall</div>
          </div>
        </div>
      </div>
      <div className="space-y-2 flex-1">
        {segs.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-sm font-medium text-foreground flex-1">{s.label}</span>
            <span className="font-head font-bold text-sm tabular-nums">{s.v}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreBar({ score }) {
  const color = scoreColor(score);
  return (
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
    </div>
  );
}

export default function SentimentAnalysis() {
  const [topic, setTopic] = useSessionState("sentiment:topic", "");
  const initial = getJobState(JOB_KEY);
  const [status, setStatus] = useState(initial.status || "idle");
  const [result, setResult] = useState(initial.result || null);
  const [past, setPast] = useState([]);
  const loading = status === "running";

  const load = () => http.get("/sentiment").then((r) => setPast(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const unsub = subscribeJob(JOB_KEY, (snap) => {
      setStatus(snap.status || "idle");
      if (snap.status === "done" && snap.result) {
        setResult(snap.result);
        load();
      } else if (snap.status === "error") {
        toast.error(formatApiErrorDetail(snap.error?.response?.data?.detail) || "Sentiment analysis failed");
      }
    });
    return () => { unsub(); };
  }, []);

  const run = async () => {
    if (!topic.trim()) { toast.error("Enter a brand or topic"); return; }
    try {
      await startSingleShotJob({
        key: JOB_KEY,
        postPath: "/sentiment/analyze",
        postBody: { topic: topic.trim() },
      });
      toast.success("Sentiment analyzed across 8 AI engines");
    } catch {
      /* handled via subscription */
    }
  };

  const r = result;

  return (
    <div>
      <PageHeader
        overline="Generative Engine (GEO)"
        title="Sentiment Analysis"
        subtitle="See how ChatGPT, Claude, Gemini, Perplexity & other AI engines feel about your brand — with actionable ways to shift the narrative."
      />

      <Card className="p-6 rounded-xl border-border/60 mb-8 grid gap-4">
        <div>
          <label className="text-xs uppercase font-bold text-muted-foreground">Brand or Topic</label>
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder='e.g. "Tesla", "Notion", "openai.com"'
            className="mt-1.5"
            data-testid="sentiment-topic-input"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={run} disabled={loading} className="btn-brand hover:opacity-90" data-testid="run-sentiment-btn">
            {loading ? (
              <><Loader2 size={16} className="mr-2 animate-spin" /> Analyzing across 8 engines…</>
            ) : (
              <><Sparkles size={16} className="mr-2" /> Analyze sentiment</>
            )}
          </Button>
        </div>
      </Card>

      {r && (
        <div className="mb-10 space-y-6" data-testid="sentiment-result">
          {/* Overview: donut + headline */}
          <Card className="p-6 rounded-xl border-border/60">
            <div className="flex flex-col lg:flex-row gap-6 lg:items-center">
              <SentimentDonut
                pos={r.positive_pct || 0}
                neu={r.neutral_pct || 0}
                neg={r.negative_pct || 0}
                score={r.overall_score || 0}
              />
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Headline</div>
                <p className="font-head font-bold text-xl leading-snug">{r.headline || "—"}</p>
                <p className="text-sm text-muted-foreground mt-3">
                  Based on simulated answers from <strong>{(r.mentions || []).length} AI engines</strong> when asked about <strong>{`"${r.topic}"`}</strong>.
                </p>
              </div>
            </div>
          </Card>

          {/* Top positive / negative */}
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-5 rounded-xl border-green-200 bg-green-50/50">
              <div className="flex items-center gap-2 mb-3">
                <ThumbsUp size={18} className="text-green-600" />
                <h4 className="font-head font-bold text-green-800">Top Positive</h4>
              </div>
              <div className="space-y-3">
                {(r.top_positive || []).map((m, i) => (
                  <div key={i} className="bg-white rounded-lg p-3 border border-green-100">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge className="bg-white border border-green-200 text-green-700 rounded-md">{m.engine}</Badge>
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">{`"${m.excerpt}"`}</p>
                    <p className="text-xs text-muted-foreground mt-2 italic">Why: {m.reason}</p>
                  </div>
                ))}
                {(!r.top_positive || r.top_positive.length === 0) && (
                  <p className="text-sm text-muted-foreground">No standout positive mentions.</p>
                )}
              </div>
            </Card>

            <Card className="p-5 rounded-xl border-red-200 bg-red-50/50">
              <div className="flex items-center gap-2 mb-3">
                <ThumbsDown size={18} className="text-red-600" />
                <h4 className="font-head font-bold text-red-800">Top Negative</h4>
              </div>
              <div className="space-y-3">
                {(r.top_negative || []).map((m, i) => (
                  <div key={i} className="bg-white rounded-lg p-3 border border-red-100">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge className="bg-white border border-red-200 text-red-700 rounded-md">{m.engine}</Badge>
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">{`"${m.excerpt}"`}</p>
                    <p className="text-xs text-muted-foreground mt-2 italic">Why: {m.reason}</p>
                  </div>
                ))}
                {(!r.top_negative || r.top_negative.length === 0) && (
                  <p className="text-sm text-muted-foreground">No standout negative mentions.</p>
                )}
              </div>
            </Card>
          </div>

          {/* Actionable insights */}
          {r.insights && r.insights.length > 0 && (
            <Card className="p-6 rounded-xl border-border/60 bg-gradient-to-br from-amber-50 to-white">
              <div className="flex items-center gap-2 mb-4">
                <Lightbulb size={18} className="text-amber-600" />
                <h4 className="font-head font-bold">Actionable Insights</h4>
              </div>
              <ul className="space-y-2.5">
                {r.insights.map((ins, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="grid place-items-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-head font-extrabold text-xs shrink-0">{i + 1}</span>
                    <span className="text-foreground pt-0.5">{ins}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* All mentions */}
          <div>
            <h4 className="font-head font-bold text-lg mb-3">All AI-Engine Mentions</h4>
            <div className="space-y-2">
              {(r.mentions || []).map((m, i) => (
                <Card key={i} className="p-4 rounded-xl border-border/60">
                  <div className="flex items-start gap-4">
                    <span className="font-head font-extrabold text-lg text-muted-foreground w-6 text-center shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="font-head font-bold">{m.engine}</span>
                        <Badge className={`rounded-md border capitalize ${labelStyle[m.label] || labelStyle.neutral} flex items-center gap-1`}>
                          {labelIcon[m.label] || labelIcon.neutral} {m.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">{`"${m.excerpt}"`}</p>
                      {m.reason && <p className="text-xs text-muted-foreground mt-1.5 italic">Why: {m.reason}</p>}
                    </div>
                    <div className="text-right shrink-0 w-24">
                      <div className="font-head font-bold" style={{ color: scoreColor(m.score) }}>{m.score}</div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1.5">score</div>
                      <ScoreBar score={m.score} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

      <h3 className="font-head text-xl font-bold mb-4">Past analyses</h3>
      {past.length === 0 ? (
        <EmptyState icon={Heart} text="No sentiment analyses yet. Try one above." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {past.map((p) => (
            <button
              key={p.id}
              onClick={() => { setJobResult(JOB_KEY, p); setResult(p); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              data-testid={`sent-past-${p.id}`}
              className="text-left bg-white border border-border/60 rounded-xl p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="font-head font-bold truncate flex-1">{p.topic}</p>
                <span className="font-head font-extrabold text-lg ml-2" style={{ color: scoreColor(p.overall_score) }}>{p.overall_score}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate">{p.headline}</p>
              <div className="flex gap-1.5 mt-3">
                <span className="flex-1 h-1.5 rounded-full bg-green-500" style={{ opacity: 0.3 + (p.positive_pct || 0) / 150 }} title={`Positive ${p.positive_pct}%`} />
                <span className="flex-1 h-1.5 rounded-full bg-gray-400" style={{ opacity: 0.3 + (p.neutral_pct || 0) / 150 }} title={`Neutral ${p.neutral_pct}%`} />
                <span className="flex-1 h-1.5 rounded-full bg-red-500" style={{ opacity: 0.3 + (p.negative_pct || 0) / 150 }} title={`Negative ${p.negative_pct}%`} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">{new Date(p.created_at).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
