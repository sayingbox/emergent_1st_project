import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { http, formatApiErrorDetail } from "@/lib/api";
import { ScoreGauge, scoreColor } from "@/components/ScoreGauge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { exportContentReport } from "@/lib/pdf";
import {
  ArrowLeft,
  Check,
  X,
  Copy,
  Download,
  Sparkles,
  Loader2,
  Quote,
  HelpCircle,
  FileDown,
  Globe,
  ExternalLink,
  ClipboardCopy,
  AlertTriangle,
  TrendingUp,
  Target,
  Layers,
  FileText,
  ChevronRight,
  Zap,
  ShieldCheck,
} from "lucide-react";

/* ---------------------------------------------------------------- */
/* Small helpers                                                    */
/* ---------------------------------------------------------------- */
const priStyle = {
  high:   { rail: "bg-red-500",    pill: "bg-red-50 text-red-700 border-red-200",       icon: <AlertTriangle size={13} /> },
  medium: { rail: "bg-amber-500",  pill: "bg-amber-50 text-amber-700 border-amber-200", icon: <TrendingUp size={13} /> },
  low:    { rail: "bg-slate-400",  pill: "bg-slate-50 text-slate-600 border-slate-200", icon: <Target size={13} /> },
};

function verdict(score) {
  if (score >= 80) return { label: "Excellent", tone: "text-emerald-700 bg-emerald-50 border-emerald-200" };
  if (score >= 70) return { label: "Good",      tone: "text-green-700 bg-green-50 border-green-200" };
  if (score >= 60) return { label: "Fair",      tone: "text-yellow-800 bg-yellow-50 border-yellow-200" };
  if (score >= 50) return { label: "Needs work",tone: "text-orange-700 bg-orange-50 border-orange-200" };
  return              { label: "Poor",       tone: "text-red-700 bg-red-50 border-red-200" };
}

function ScoreBar({ score, height = 6 }) {
  return (
    <div className="w-full bg-slate-100 rounded-full overflow-hidden" style={{ height }}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.max(2, score)}%`, background: scoreColor(score) }}
      />
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tint = "emerald" }) {
  const tints = {
    emerald: "from-emerald-50 to-white border-emerald-100 text-emerald-700",
    violet:  "from-violet-50 to-white border-violet-100 text-violet-700",
    amber:   "from-amber-50 to-white border-amber-100 text-amber-700",
    sky:     "from-sky-50 to-white border-sky-100 text-sky-700",
    rose:    "from-rose-50 to-white border-rose-100 text-rose-700",
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${tints[tint]} p-4 relative overflow-hidden`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-7 h-7 rounded-lg grid place-items-center bg-white/70 shadow-sm ${tints[tint].split(" ").pop()}`}>
          <Icon size={14} />
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-500">{label}</span>
      </div>
      <div className="font-head font-extrabold text-2xl tabular-nums text-foreground leading-none mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Page                                                             */
/* ---------------------------------------------------------------- */
export default function AnalysisDetail() {
  const { id } = useParams();
  const [a, setA] = useState(null);
  const [simQuery, setSimQuery] = useState("");
  const [simLoading, setSimLoading] = useState(false);
  const [gapLoading, setGapLoading] = useState(false);

  const load = async () => {
    try {
      const { data } = await http.get(`/analyses/${id}`);
      setA(data);
      setSimQuery(data.target_query || "");
    } catch { toast.error("Could not load analysis"); }
  };
  useEffect(() => { load(); }, [id]);

  const copyJson = () => { navigator.clipboard.writeText(JSON.stringify(a.jsonld, null, 2)); toast.success("JSON-LD copied"); };
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(a.jsonld, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "schema.json"; link.click(); URL.revokeObjectURL(url);
    toast.success("Downloaded schema.json");
  };
  const copyAnswer = () => { navigator.clipboard.writeText(a.summary_answer || ""); toast.success("Answer copied"); };

  const runSim = async () => {
    if (!simQuery.trim()) { toast.error("Enter a target query"); return; }
    setSimLoading(true);
    try {
      const { data } = await http.post(`/analyses/${id}/simulate`, { query: simQuery });
      setA((p) => ({ ...p, simulations: [...(p.simulations || []), data] }));
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setSimLoading(false); }
  };

  const runGaps = async () => {
    setGapLoading(true);
    try {
      const { data } = await http.post(`/analyses/${id}/gaps`);
      setA((p) => ({ ...p, question_gaps: data.gaps }));
      toast.success("Question gaps generated");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setGapLoading(false); }
  };

  // Priority counts + averages memoised
  const stats = useMemo(() => {
    if (!a) return null;
    const recs = a.recommendations || [];
    const high = recs.filter((r) => r.priority === "high").length;
    const medium = recs.filter((r) => r.priority === "medium").length;
    const low = recs.filter((r) => r.priority === "low").length;
    const passed = (a.dimensions || []).reduce((n, d) => n + (d.sub_checks || []).filter((s) => s.passed).length, 0);
    const total  = (a.dimensions || []).reduce((n, d) => n + (d.sub_checks || []).length, 0);
    return { high, medium, low, passed, total };
  }, [a]);

  if (!a) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <Loader2 className="animate-spin mx-auto mb-3" />
        <p className="text-sm">Loading analysis…</p>
      </div>
    );
  }

  const v = verdict(a.overall_score || 0);
  const dims = a.dimensions || [];
  const strongest = [...dims].sort((x, y) => (y.score || 0) - (x.score || 0))[0];
  const weakest = [...dims].sort((x, y) => (x.score || 0) - (y.score || 0))[0];

  return (
    <div className="space-y-6">
      {/* ============ TOP BAR ============ */}
      <div className="flex items-center justify-between gap-3">
        <Link to="/app/optimizer" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="back-link">
          <ArrowLeft size={16} /> All reports
        </Link>
        <div className="flex items-center gap-2">
          {a.source_url && (
            <a href={a.source_url} target="_blank" rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border/60 rounded-lg px-3 py-1.5 hover:bg-muted/40 transition-colors">
              <ExternalLink size={12} /> Open URL
            </a>
          )}
          <Button
            onClick={() => { try { exportContentReport(a); toast.success("PDF exported"); } catch { toast.error("Could not export PDF"); } }}
            size="sm"
            variant="outline"
            data-testid="export-pdf-btn"
            className="border-border/60"
          >
            <FileDown size={14} className="mr-1.5" /> Export PDF
          </Button>
        </div>
      </div>

      {/* ============ HERO ============ */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-white shadow-sm">
        {/* accent strip */}
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: `linear-gradient(90deg, ${scoreColor(a.overall_score)}, ${scoreColor(a.overall_score)}80)` }} />

        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-0">
          {/* LEFT — meta + KPIs */}
          <div className="p-6 sm:p-7">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-2">
              <FileText size={12} /> Content Report
            </div>
            <h1 className="font-head text-2xl sm:text-3xl font-extrabold leading-tight line-clamp-2 mb-2">{a.title}</h1>
            {a.source_url ? (
              <a href={a.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 hover:underline max-w-full">
                <Globe size={13} /> <span className="truncate">{a.source_url}</span>
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">Pasted content</span>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
              <Kpi icon={FileText} tint="emerald" label="Word count" value={(a.word_count || 0).toLocaleString()} sub={a.word_count > 800 ? "Comprehensive" : a.word_count > 300 ? "Adequate" : "Too thin"} />
              <Kpi icon={Layers}   tint="sky"     label="Dimensions" value={dims.length} sub={`${stats.passed}/${stats.total} checks passed`} />
              <Kpi icon={Zap}      tint="amber"   label="Fixes queued" value={(a.recommendations || []).length} sub={`${stats.high} high · ${stats.medium} med`} />
              <Kpi icon={ShieldCheck} tint="violet" label="Schema types" value={(a.detected_schema_types || []).length} sub={(a.detected_schema_types || [])[0] || "None detected"} />
            </div>

            {/* Strongest / Weakest */}
            {(strongest || weakest) && (
              <div className="grid sm:grid-cols-2 gap-3 mt-4">
                {strongest && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3.5 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center shrink-0">
                      <TrendingUp size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Strongest</div>
                      <div className="font-semibold text-sm truncate">{strongest.label}</div>
                    </div>
                    <span className="font-head font-extrabold text-lg tabular-nums" style={{ color: scoreColor(strongest.score) }}>{strongest.score}</span>
                  </div>
                )}
                {weakest && (
                  <div className="rounded-xl border border-red-100 bg-red-50/40 p-3.5 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg bg-red-100 text-red-700 grid place-items-center shrink-0">
                      <AlertTriangle size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] uppercase tracking-wider font-bold text-red-700">Needs the most work</div>
                      <div className="font-semibold text-sm truncate">{weakest.label}</div>
                    </div>
                    <span className="font-head font-extrabold text-lg tabular-nums" style={{ color: scoreColor(weakest.score) }}>{weakest.score}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT — Score gauge */}
          <div className="p-6 sm:p-7 bg-gradient-to-br from-slate-50 to-white border-t lg:border-t-0 lg:border-l border-border/60 flex flex-col items-center justify-center text-center">
            <ScoreGauge score={a.overall_score || 0} size={170} stroke={12} label="OVERALL GEO" />
            <div className="mt-4">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${v.tone}`}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: scoreColor(a.overall_score) }} />
                {v.label}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 max-w-[240px] leading-relaxed">
              How well generative engines can extract, understand and cite this content.
            </p>
          </div>
        </div>
      </div>

      {/* ============ SUGGESTED ANSWER ============ */}
      {a.summary_answer && (
        <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/50 p-6 sm:p-7 shadow-sm relative overflow-hidden">
          <div className="absolute top-4 right-4">
            <button
              onClick={copyAnswer}
              className="text-xs font-semibold text-emerald-800 hover:text-emerald-900 bg-white/80 border border-emerald-200 rounded-md px-2.5 py-1.5 flex items-center gap-1.5 shadow-sm hover:bg-white transition-colors"
            >
              <ClipboardCopy size={12} /> Copy
            </button>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-emerald-500 text-white grid place-items-center shadow-sm">
              <Quote size={14} />
            </span>
            <span className="text-[11px] tracking-[0.18em] uppercase font-bold text-emerald-800">Suggested Direct Answer</span>
          </div>
          <p className="font-head text-xl sm:text-2xl font-bold leading-snug text-foreground" data-testid="summary-answer">
            {a.summary_answer}
          </p>
          <p className="text-xs text-muted-foreground mt-4 max-w-2xl">
            💡 Place this 40–60 word direct answer immediately after your H1 so generative engines can quote it verbatim in AI Overviews and answer boxes.
          </p>
        </div>
      )}

      {/* ============ TABS ============ */}
      <Tabs defaultValue="scores">
        <TabsList className="flex-wrap h-auto bg-slate-100/70 border border-border/60 rounded-xl p-1">
          <TabsTrigger value="scores" data-testid="tab-scores" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Scores</TabsTrigger>
          <TabsTrigger value="fixes" data-testid="tab-fixes" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Recommendations
            {(a.recommendations || []).length > 0 && (
              <span className="ml-1.5 text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5">{a.recommendations.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="schema" data-testid="tab-schema" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Schema</TabsTrigger>
          <TabsTrigger value="simulator" data-testid="tab-simulator" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">AI Simulator</TabsTrigger>
          <TabsTrigger value="gaps" data-testid="tab-gaps" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Question Gaps</TabsTrigger>
        </TabsList>

        {/* ---------- SCORES ---------- */}
        <TabsContent value="scores" className="mt-5">
          <div className="grid sm:grid-cols-2 gap-3" data-testid="dimensions-grid">
            {dims.map((d) => {
              const dv = verdict(d.score || 0);
              return (
                <Card key={d.key} className="p-5 rounded-xl border-border/60 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-head font-bold text-sm">{d.label}</p>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold mt-1 ${dv.tone}`}>
                        {dv.label}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-head font-extrabold text-2xl tabular-nums leading-none" style={{ color: scoreColor(d.score) }}>{d.score}</div>
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">/ 100</div>
                    </div>
                  </div>
                  <ScoreBar score={d.score} />
                  <p className="text-[13px] text-muted-foreground mt-3 leading-relaxed">{d.summary}</p>
                  {(d.sub_checks || []).length > 0 && (
                    <Accordion type="single" collapsible className="mt-1">
                      <AccordionItem value="sc" className="border-none">
                        <AccordionTrigger className="py-2 text-[11px] uppercase tracking-wide font-bold text-muted-foreground hover:no-underline hover:text-foreground">
                          {d.sub_checks.filter((s) => s.passed).length}/{d.sub_checks.length} sub-checks passed
                        </AccordionTrigger>
                        <AccordionContent>
                          <ul className="space-y-2 pt-1">
                            {d.sub_checks.map((s, i) => (
                              <li key={i} className="flex items-start gap-2 text-[13px]">
                                <span className={`w-4 h-4 rounded-full grid place-items-center shrink-0 mt-0.5 ${s.passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                                  {s.passed ? <Check size={11} /> : <X size={11} />}
                                </span>
                                <span><span className="font-semibold">{s.label}.</span> <span className="text-muted-foreground">{s.detail}</span></span>
                              </li>
                            ))}
                          </ul>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ---------- RECOMMENDATIONS ---------- */}
        <TabsContent value="fixes" className="mt-5">
          {(a.recommendations || []).length === 0 ? (
            <Card className="p-10 text-center border-border/60">
              <ShieldCheck className="mx-auto text-emerald-500 mb-3" size={36} />
              <p className="font-head font-bold">All clear — no fixes recommended</p>
              <p className="text-sm text-muted-foreground mt-1">This content is already well-optimized for AI engines.</p>
            </Card>
          ) : (
            <>
              {/* summary bar */}
              <div className="flex flex-wrap gap-2 mb-4">
                {["high", "medium", "low"].map((p) => {
                  const ct = (a.recommendations || []).filter((r) => r.priority === p).length;
                  if (!ct) return null;
                  return (
                    <span key={p} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${priStyle[p].pill}`}>
                      {priStyle[p].icon}
                      <span className="capitalize">{p}</span>
                      <span className="tabular-nums font-bold">{ct}</span>
                    </span>
                  );
                })}
              </div>
              <div className="space-y-2.5" data-testid="recommendations-list">
                {(a.recommendations || []).map((r, i) => {
                  const style = priStyle[r.priority] || priStyle.low;
                  return (
                    <Card key={i} className="rounded-xl border-border/60 overflow-hidden hover:shadow-sm transition-all group">
                      <div className="flex items-stretch">
                        <div className={`w-1 shrink-0 ${style.rail}`} />
                        <div className="flex-1 p-4 sm:p-5 flex items-start gap-4">
                          <span className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 grid place-items-center shrink-0 group-hover:bg-emerald-100 group-hover:text-emerald-700 transition-colors">
                            <span className="font-head font-extrabold text-sm tabular-nums">{i + 1}</span>
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.pill}`}>
                                {style.icon} {r.priority}
                              </span>
                              <span className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{r.dimension}</span>
                            </div>
                            <p className="text-sm leading-relaxed text-foreground">{r.fix}</p>
                          </div>
                          <button
                            onClick={() => { navigator.clipboard.writeText(r.fix || ""); toast.success("Fix copied"); }}
                            className="text-xs text-muted-foreground hover:text-emerald-700 border border-border/60 rounded-md px-2 py-1 flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Copy fix"
                          >
                            <Copy size={12} /> Copy
                          </button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>

        {/* ---------- SCHEMA ---------- */}
        <TabsContent value="schema" className="mt-5">
          <Card className="p-5 rounded-xl border-border/60">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mr-1">Detected:</span>
              {(a.detected_schema_types || []).length === 0 ? (
                <Badge className="rounded-md border border-amber-200 bg-amber-50 text-amber-700">None</Badge>
              ) : (
                (a.detected_schema_types || []).map((t) => (
                  <Badge key={t} variant="secondary" className="rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">{t}</Badge>
                ))
              )}
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={copyJson} data-testid="copy-json-btn" className="border-border/60">
                <Copy size={14} className="mr-1.5" /> Copy
              </Button>
              <Button size="sm" className="btn-brand hover:opacity-90" onClick={downloadJson} data-testid="download-json-btn">
                <Download size={14} className="mr-1.5" /> Download
              </Button>
            </div>
            <pre className="bg-[#0b0b0f] text-[#d4d4d8] rounded-lg p-5 overflow-auto text-xs leading-relaxed max-h-[560px] font-mono border border-slate-800" data-testid="jsonld-viewer">
{JSON.stringify(a.jsonld, null, 2)}
            </pre>
          </Card>
        </TabsContent>

        {/* ---------- SIMULATOR ---------- */}
        <TabsContent value="simulator" className="mt-5 space-y-4">
          <Card className="p-5 rounded-xl border-border/60 bg-gradient-to-br from-white to-slate-50/40">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center"><Sparkles size={14} /></span>
              <div>
                <p className="font-head font-bold text-sm">AI Answer Simulator</p>
                <p className="text-[11px] text-muted-foreground">See how a generative engine would answer a query using this page.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Input value={simQuery} onChange={(e) => setSimQuery(e.target.value)} placeholder="Enter a target query…" data-testid="sim-query-input" />
              <Button onClick={runSim} disabled={simLoading} className="btn-brand hover:opacity-90 shrink-0" data-testid="simulate-btn">
                {simLoading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Simulate</>}
              </Button>
            </div>
          </Card>
          {(a.simulations || []).slice().reverse().map((s, i) => (
            <Card key={i} className="p-5 rounded-xl border-border/60" data-testid="sim-result">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <span className="font-head font-bold text-sm">&quot;{s.query}&quot;</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${s.would_cite ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                  {s.would_cite ? <><Check size={12} /> Would cite · {s.confidence}%</> : <><X size={12} /> Unlikely · {s.confidence}%</>}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-foreground">{s.simulated_answer}</p>
              {s.cited_snippets?.length > 0 && (
                <div className="mt-4 border-l-2 border-emerald-500 pl-3 space-y-1 bg-emerald-50/30 py-2 rounded-r-lg">
                  {s.cited_snippets.map((c, j) => <p key={j} className="text-xs text-muted-foreground italic">&quot;{c}&quot;</p>)}
                </div>
              )}
              {s.missing_for_citation && (
                <div className="mt-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span><strong>To improve citation:</strong> {s.missing_for_citation}</span>
                </div>
              )}
            </Card>
          ))}
        </TabsContent>

        {/* ---------- GAPS ---------- */}
        <TabsContent value="gaps" className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-head font-bold text-sm">Question Gap Analysis</p>
              <p className="text-[11px] text-muted-foreground">Common questions your audience asks — see which ones your content answers.</p>
            </div>
            <Button onClick={runGaps} disabled={gapLoading} className="btn-brand hover:opacity-90" data-testid="find-gaps-btn">
              {gapLoading ? <><Loader2 size={16} className="mr-2 animate-spin" /> Finding gaps…</> : <><HelpCircle size={16} className="mr-2" /> Find question gaps</>}
            </Button>
          </div>
          <div className="space-y-2" data-testid="gaps-list">
            {(a.question_gaps || []).length === 0 ? (
              <Card className="p-8 text-center border-border/60 border-dashed">
                <HelpCircle className="mx-auto text-muted-foreground/60 mb-2" size={28} />
                <p className="text-sm text-muted-foreground">Click <strong>Find question gaps</strong> above to identify what your audience is searching for.</p>
              </Card>
            ) : (
              (a.question_gaps || []).map((g, i) => (
                <Card key={i} className="p-4 rounded-xl border-border/60 flex items-start gap-3 hover:shadow-sm transition-shadow">
                  <span className={`w-7 h-7 rounded-lg shrink-0 grid place-items-center ${g.covered ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {g.covered ? <Check size={14} /> : <X size={14} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{g.question}</p>
                    <p className="text-xs text-muted-foreground mt-1">{g.why}</p>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <Badge variant="secondary" className="rounded-md capitalize bg-slate-100 text-slate-700 border-0">{g.volume} vol</Badge>
                    <div className="text-[10px] text-muted-foreground">rel {g.relevance}</div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
