import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSessionState } from "@/hooks/useSessionState";
import { http, formatApiErrorDetail } from "@/lib/api";
import {
  startPollingJob,
  resumePollingJob,
  readPersistedJobId,
  subscribe as subscribeJob,
  setResult as setJobResult,
  getState as getJobState,
} from "@/lib/jobRegistry";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { ScoreGauge, scoreColor } from "@/components/ScoreGauge";
import { Globe, Loader2, Sparkles, Zap, Users, Link2, Search, ExternalLink, BarChart3, ChevronDown, ChevronUp, Layers, ShieldCheck, CheckCircle2, XCircle, FileSearch, FileDown } from "lucide-react";
import { toast } from "sonner";
import { exportDomainReport } from "@/lib/pdf";

const priColor = { high: "bg-red-100 text-red-700 border-red-200", medium: "bg-amber-100 text-amber-700 border-amber-200", low: "bg-gray-100 text-gray-600 border-gray-200" };
const posColor = { top: "bg-green-100 text-green-700 border-green-200", recommended: "bg-green-100 text-green-700 border-green-200", passing: "bg-amber-100 text-amber-700 border-amber-200" };
const engLabel = { chatgpt: "ChatGPT", perplexity: "Perplexity", google_ai: "Google AI", gemini: "Gemini", claude: "Claude", copilot: "Copilot", grok: "Grok" };
const ENGINE_ORDER = ["chatgpt", "perplexity", "gemini", "claude", "copilot", "grok", "google_ai"];
const engineMeta = {
  chatgpt: { label: "ChatGPT", domain: "openai.com" },
  perplexity: { label: "Perplexity", domain: "perplexity.ai" },
  gemini: { label: "Gemini", domain: "gemini.google.com" },
  claude: { label: "Claude", domain: "claude.ai" },
  copilot: { label: "Copilot", domain: "copilot.microsoft.com" },
  grok: { label: "Grok", domain: "x.ai" },
  google_ai: { label: "Google AI Overviews", domain: "google.com" },
};
const engFav = (d) => `https://www.google.com/s2/favicons?domain=${d}&sz=64`;

function Bar({ score, label, note }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1"><span className="font-medium">{label}</span><span className="font-head font-bold" style={{ color: scoreColor(score) }}>{score}</span></div>
      <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${score}%`, background: scoreColor(score) }} /></div>
      {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
    </div>
  );
}

function Metric({ label, value, colored }) {
  const numeric = typeof value === "number";
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground">{label}</div>
      <div className="font-head text-2xl font-extrabold mt-0.5" style={colored && numeric ? { color: scoreColor(value) } : {}}>
        {value ?? "—"}
      </div>
    </div>
  );
}

const JOB_KEY = "domain-analysis";

export default function DomainAnalysis() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [domain, setDomain] = useSessionState("domain-analysis:input", "");
  const [past, setPast] = useState([]);
  const [showAllCites, setShowAllCites] = useState(false);
  const [showAllPrompts, setShowAllPrompts] = useState(false);

  // Subscribe to the module-level job registry so an in-flight scan survives navigation.
  const initial = getJobState(JOB_KEY);
  const [status, setStatus] = useState(initial.status || "idle");
  const [result, setResult] = useState(initial.result || null);
  const loading = status === "running";

  const load = () => http.get("/domain").then((r) => setPast(r.data)).catch(() => {});

  useEffect(() => {
    load();
    // Subscribe to registry updates for this page's job.
    const unsub = subscribeJob(JOB_KEY, (snap) => {
      setStatus(snap.status || "idle");
      if (snap.status === "done" && snap.result) {
        setResult(snap.result);
        load();
      } else if (snap.status === "error") {
        toast.error(typeof snap.error === "string" ? snap.error : "Analysis failed — please try again");
      }
    });
    // If we come back to the page while a job is still processing (fresh page-reload case),
    // there'll be a jobId in sessionStorage — resume polling for it.
    const savedJobId = readPersistedJobId(JOB_KEY);
    if (savedJobId && getJobState(JOB_KEY).status !== "running") {
      resumePollingJob({ key: JOB_KEY, jobId: savedJobId, statusPathTemplate: "/domain/{id}" });
    }
    // Pre-fill from URL query params (e.g. drill-in from Projects). Auto-run if ?autorun=1.
    const qDomain = searchParams.get("domain");
    const autorun = searchParams.get("autorun");
    if (qDomain) {
      setDomain(qDomain);
      if (autorun === "1" && getJobState(JOB_KEY).status !== "running") {
        // Trigger a fresh scan for that domain
        setTimeout(() => {
          startPollingJob({ key: JOB_KEY, postPath: "/domain/analyze", postBody: { domain: qDomain }, statusPathTemplate: "/domain/{id}" }).catch(() => {});
        }, 100);
      }
      // Strip params so a manual reload doesn't retrigger
      setSearchParams({}, { replace: true });
    }
    return () => { unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!domain.trim()) { toast.error("Enter a domain"); return; }
    setResult(null);
    setShowAllCites(false);
    setShowAllPrompts(false);
    try {
      await startPollingJob({ key: JOB_KEY, postPath: "/domain/analyze", postBody: { domain }, statusPathTemplate: "/domain/{id}" });
      // Success/failure is reported via the subscription above.
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const r = result;
  return (
    <div>
      <PageHeader overline="Overview" title="Domain Analysis" subtitle="Crawl-first AI-search report: we crawl the real site to discover its actual services, then map the topics it ranks for in AI Search, verify the live sources AI cites, and surface the competitors on those same topics." />

      <Card className="p-4 rounded-xl border-border/60 mb-5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="example.com" className="pl-9" data-testid="domain-input" />
          </div>
          <Button onClick={run} disabled={loading} className="btn-brand hover:opacity-90 shrink-0" data-testid="analyze-domain-btn">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Analyze</>}
          </Button>
        </div>
      </Card>

      {loading && !r && (
        <Card className="p-10 rounded-xl border-border/60 mb-10 flex flex-col items-center justify-center text-center grain" data-testid="domain-loading">
          <Loader2 size={28} className="animate-spin text-[#6366F1]" />
          <p className="font-head font-bold mt-4">Crawling the site &amp; building your AI-search report…</p>
          <p className="text-sm text-muted-foreground mt-1">Discovering the real business &amp; services, mapping AI-search rankings by topic, and HTTP-verifying every citation URL is live. This can take up to a minute.</p>
        </Card>
      )}

      {r && (
        <div className="grid lg:grid-cols-12 gap-6 mb-10" data-testid="domain-result">
          <Card className="lg:col-span-4 p-8 rounded-xl border-border/60 flex flex-col items-center justify-center text-center">
            <ScoreGauge score={r.ai_readiness_score || 0} label="AI READINESS" />
            <h2 className="font-head text-xl font-bold mt-5">{r.domain}</h2>
            <p className="text-sm text-muted-foreground mt-2">{r.brand_summary || "No description available."}</p>
            <Badge className={`mt-3 rounded-md border ${r.known_by_ai ? "bg-green-100 text-green-700 border-green-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>
              {r.known_by_ai ? "Recognized by AI engines" : "Low AI recognition"}
            </Badge>
            <Button onClick={() => { try { exportDomainReport(r); toast.success("PDF exported"); } catch { toast.error("Could not export PDF"); } }}
              size="sm" variant="outline" className="mt-4" data-testid="export-domain-pdf-btn">
              <FileDown size={15} className="mr-2" /> Export PDF
            </Button>
          </Card>

          {/* SEO & authority metrics */}
          <Card className="lg:col-span-8 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-4 flex items-center gap-2"><BarChart3 size={18} className="text-[#6366F1]" /> SEO & authority metrics</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4" data-testid="seo-metrics">
              <Metric label="Domain Authority" value={r.metrics?.domain_authority} colored />
              <Metric label="Page Authority" value={r.metrics?.page_authority} colored />
              <Metric label="Trust Score" value={r.metrics?.trust_score} colored />
              <Metric label="Backlinks" value={r.metrics?.estimated_backlinks} />
              <Metric label="Referring Domains" value={r.metrics?.referring_domains} />
              <Metric label="Est. Monthly Traffic" value={r.metrics?.estimated_monthly_traffic} />
            </div>
            <div className="mt-6 space-y-4" data-testid="category-bars">{(r.categories || []).map((c, i) => <Bar key={i} {...c} />)}</div>
            {(r.engines_checked || []).length > 0 && (
              <div className="mt-6">
                <div className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground mb-2">Engines checked</div>
                <div className="flex flex-wrap gap-2" data-testid="engines-checked">
                  {(r.engines_checked || []).map((e) => (
                    <span key={e} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-muted font-medium">{e}</span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Discovered business & services (crawl-first) */}
          <Card className="lg:col-span-7 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-1 flex items-center gap-2"><Layers size={18} className="text-[#6366F1]" /> Discovered business &amp; services</h3>
            <p className="text-xs text-muted-foreground mb-4">Extracted directly from a live crawl of the site{(r.crawled_pages || []).length ? ` (${r.crawled_pages.length} page${r.crawled_pages.length > 1 ? "s" : ""} crawled)` : ""}.</p>
            {!r.crawl_ok && <Badge className="mb-3 rounded-md border bg-amber-100 text-amber-700 border-amber-200">Live crawl returned little content — using brand knowledge</Badge>}
            <div className="space-y-2" data-testid="discovered-services">
              {(r.discovered_services || []).map((s, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/60">
                  <FileSearch size={15} className="text-[#6366F1] mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{s.name}</div>
                    {s.evidence && <p className="text-xs text-muted-foreground mt-0.5 italic">&ldquo;{s.evidence}&rdquo;</p>}
                  </div>
                </div>
              ))}
              {(!r.discovered_services || r.discovered_services.length === 0) && (
                <p className="text-sm text-muted-foreground">No specific services could be extracted from the crawl.</p>
              )}
            </div>
            {(r.crawled_pages || []).length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5" data-testid="crawled-pages">
                {r.crawled_pages.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer" className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground hover:text-[#6366F1] break-all inline-flex items-center gap-1">{u.replace(/^https?:\/\//, "")} <ExternalLink size={9} /></a>
                ))}
              </div>
            )}
          </Card>

          {/* AI Search ranking by topic */}
          <Card className="lg:col-span-5 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-1 flex items-center gap-2"><Search size={18} className="text-[#6366F1]" /> AI Search ranking</h3>
            <p className="text-xs text-muted-foreground mb-4">Does the brand surface in AI answers for each discovered topic?</p>
            <div className="space-y-2" data-testid="ai-search-rankings">
              {(r.ai_search_rankings || []).map((a, i) => (
                <div key={i} className="p-3 rounded-lg border border-border/60">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium capitalize">{a.topic}</span>
                    {a.ranks ? <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" /> : <XCircle size={16} className="text-gray-400 shrink-0 mt-0.5" />}
                  </div>
                  {a.ranks ? (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <Badge className={`rounded-md border capitalize text-[10px] ${posColor[a.position] || priColor.low}`}>{a.position}</Badge>
                      {(a.engines || []).map((e) => <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border/60 text-muted-foreground">{engLabel[e] || e}</span>)}
                    </div>
                  ) : <p className="text-xs text-muted-foreground mt-1">Not currently surfacing in AI Search.</p>}
                  {a.note && <p className="text-xs text-muted-foreground mt-1.5">{a.note}</p>}
                </div>
              ))}
              {(!r.ai_search_rankings || r.ai_search_rankings.length === 0) && (
                <p className="text-sm text-muted-foreground">No AI-search ranking data available.</p>
              )}
            </div>
          </Card>

          {/* AI citation sources */}
          <Card className="lg:col-span-7 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-1 flex items-center gap-2"><Link2 size={18} className="text-[#6366F1]" /> Verified AI citation sources</h3>
            <p className="text-xs text-muted-foreground mb-4 inline-flex items-center gap-1"><ShieldCheck size={13} className="text-green-600" /> Live, HTTP-verified pages where this brand appears &amp; which AI engines pick them up ({(r.citation_sources || []).length} sources).</p>
            <div className="space-y-2" data-testid="citation-sources">
              {(showAllCites ? (r.citation_sources || []) : (r.citation_sources || []).slice(0, 8)).map((c, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/60">
                  <span className="font-head font-bold text-muted-foreground w-5 text-center shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{c.title || c.source}</span>
                      {c.type && <Badge variant="secondary" className="rounded-md capitalize text-[10px]">{c.type}</Badge>}
                      <Badge className="rounded-md text-[10px] bg-green-100 text-green-700 border-green-200 border inline-flex items-center gap-0.5"><ShieldCheck size={10} /> Live</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{c.source}{c.domain ? ` · ${c.domain}` : ""}</div>
                    {c.why && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.why}</p>}
                    {c.url && <a href={c.url.startsWith("http") ? c.url : `https://${c.url}`} target="_blank" rel="noreferrer" className="text-xs text-[#6366F1] inline-flex items-center gap-1 mt-1 hover:underline break-all">{c.url} <ExternalLink size={11} /></a>}
                    {Array.isArray(c.engines) && c.engines.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 mt-1.5">
                        <span className="text-[10px] text-muted-foreground mr-0.5">Picked up by:</span>
                        {c.engines.map((e) => (
                          <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-[#6366F1]/10 text-[#6366F1] inline-flex items-center gap-1">
                            <img src={engFav((engineMeta[e] || {}).domain || "")} alt="" className="w-3 h-3 rounded-sm" onError={(ev) => { ev.target.style.display = "none"; }} />
                            {engLabel[e] || e}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {c.authority != null && <span className="font-head font-bold text-sm shrink-0" style={{ color: scoreColor(c.authority) }}>{c.authority}</span>}
                </div>
              ))}
              {(!r.citation_sources || r.citation_sources.length === 0) && (
                <p className="text-sm text-muted-foreground">No live citation sources verified — none of the candidate URLs resolved, meaning this brand has little third-party coverage AI can draw on.</p>
              )}
            </div>
            {(r.citation_sources || []).length > 8 && (
              <button onClick={() => setShowAllCites((v) => !v)} data-testid="toggle-citations"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#6366F1] hover:underline">
                {showAllCites ? <>Show less <ChevronUp size={15} /></> : <>View {(r.citation_sources.length - 8)} more <ChevronDown size={15} /></>}
              </button>
            )}
          </Card>

          {/* Ranking prompts */}
          <Card className="lg:col-span-5 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-1 flex items-center gap-2"><Search size={18} className="text-[#6366F1]" /> Ranking prompts</h3>
            <p className="text-xs text-muted-foreground mb-4">All queries this domain surfaces for in AI answers ({(r.ranking_prompts || []).length} prompts).</p>
            <div className="space-y-2" data-testid="ranking-prompts">
              {(showAllPrompts ? (r.ranking_prompts || []) : (r.ranking_prompts || []).slice(0, 8)).map((p, i) => (
                <div key={i} className="p-3 rounded-lg bg-muted/40">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{p.prompt}</span>
                    <Badge className={`rounded-md border capitalize shrink-0 text-[10px] ${posColor[p.position] || priColor.low}`}>{p.position}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {p.topic && <Badge variant="outline" className="rounded-md text-[10px] capitalize">{p.topic}</Badge>}
                    {p.intent && <Badge variant="outline" className="rounded-md text-[10px] capitalize">{p.intent}</Badge>}
                    {(p.engines || []).map((e) => <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-border/60 text-muted-foreground">{engLabel[e] || e}</span>)}
                  </div>
                </div>
              ))}
              {(!r.ranking_prompts || r.ranking_prompts.length === 0) && (
                <p className="text-sm text-muted-foreground">No ranking prompts identified for this domain.</p>
              )}
            </div>
            {(r.ranking_prompts || []).length > 8 && (
              <button onClick={() => setShowAllPrompts((v) => !v)} data-testid="toggle-prompts"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#6366F1] hover:underline">
                {showAllPrompts ? <>Show less <ChevronUp size={15} /></> : <>View {(r.ranking_prompts.length - 8)} more <ChevronDown size={15} /></>}
              </button>
            )}
          </Card>

          {/* Distribution by LLM */}
          <Card className="lg:col-span-6 p-6 rounded-xl border-border/60" data-testid="llm-distribution">
            <h3 className="font-head font-bold mb-1 flex items-center gap-2"><Sparkles size={18} className="text-[#6366F1]" /> Distribution by LLM</h3>
            <p className="text-xs text-muted-foreground mb-4">How this brand&apos;s mentions spread across AI answer engines (from prompt-ranking simulations).</p>
            <div className="space-y-3">
              {ENGINE_ORDER.map((k) => {
                const d = (r.llm_distribution || []).find((x) => x.key === k) || { mentions: 0, share_pct: 0 };
                const m = engineMeta[k];
                return (
                  <div key={k} data-testid={`llm-row-${k}`}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="flex items-center gap-2 font-medium">
                        <img src={engFav(m.domain)} alt="" className="w-4 h-4 rounded" onError={(e) => { e.target.style.display = "none"; }} /> {m.label}
                      </span>
                      <span className="tabular-nums text-xs text-muted-foreground">{d.mentions} · {d.share_pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width: `${d.share_pct}%`, background: "#6366F1" }} /></div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* By Country */}
          <Card className="lg:col-span-6 p-6 rounded-xl border-border/60" data-testid="by-country">
            <h3 className="font-head font-bold mb-1 flex items-center gap-2"><Globe size={18} className="text-[#10b981]" /> By Country</h3>
            <p className="text-xs text-muted-foreground mb-4">Countries where this brand is most discussed &amp; surfaced in AI search.</p>
            {(r.mention_countries || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No country data available.</p>
            ) : (
              <div className="space-y-3">
                {(r.mention_countries || []).map((c, i) => (
                  <div key={i} data-testid={`country-row-${i}`}>
                    <div className="flex items-center justify-between text-sm mb-1"><span className="font-medium">{c.country}</span><span className="tabular-nums text-xs text-muted-foreground">{c.share_pct}%</span></div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width: `${c.share_pct}%`, background: "#10b981" }} /></div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Top topics */}
          <Card className="lg:col-span-7 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-4">Top relevant topics</h3>
            <div className="space-y-3" data-testid="top-topics">
              {(r.top_topics || []).map((t, i) => {
                const isObj = typeof t === "object" && t !== null;
                const topic = isObj ? t.topic : t;
                const auth = isObj ? t.authority : 0;
                const rel = isObj ? t.relevance : 0;
                return (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium capitalize">{topic}</span>
                      {isObj && <span className="text-xs text-muted-foreground">auth {auth} · rel {rel}</span>}
                    </div>
                    {isObj && (
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${auth}%`, background: scoreColor(auth) }} /></div>
                    )}
                  </div>
                );
              })}
              {(!r.top_topics || r.top_topics.length === 0) && <p className="text-sm text-muted-foreground">No clear topics identified.</p>}
            </div>
          </Card>

          {/* Quick wins */}
          <Card className="lg:col-span-5 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-4 flex items-center gap-2"><Zap size={18} className="text-[#6366F1]" /> Quick wins</h3>
            <div className="space-y-2">
              {(r.quick_wins || []).map((q, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <Badge className={`${priColor[q.priority] || priColor.low} border rounded-md capitalize shrink-0`}>{q.priority}</Badge>
                  <span className="text-sm">{q.action}</span>
                </div>
              ))}
              {(!r.quick_wins || r.quick_wins.length === 0) && <p className="text-sm text-muted-foreground">No suggestions available.</p>}
            </div>
          </Card>

          {/* Competitors */}
          <Card className="lg:col-span-12 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-1 flex items-center gap-2"><Users size={16} /> Competitors for the same AI answers</h3>
            <p className="text-xs text-muted-foreground mb-4">Companies ranking in AI Search for the same discovered topics.</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2" data-testid="competitors">
              {(r.competitors || []).map((t, i) => {
                const dom = typeof t === "object" && t !== null ? t.domain : t;
                const topic = typeof t === "object" && t !== null ? t.topic : "";
                const note = typeof t === "object" && t !== null ? t.note : "";
                return (
                  <div key={i} className="p-3 rounded-lg border border-border/60">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a href={`https://${(dom || "").replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="font-medium text-sm text-[#6366F1] hover:underline inline-flex items-center gap-1">{dom} <ExternalLink size={11} /></a>
                      {topic && <Badge variant="outline" className="rounded-md text-[10px] capitalize">{topic}</Badge>}
                    </div>
                    {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
                  </div>
                );
              })}
              {(!r.competitors || r.competitors.length === 0) && <p className="text-sm text-muted-foreground">No competitors detected.</p>}
            </div>
          </Card>

          {/* AI Share of Voice */}
          <Card className="lg:col-span-12 p-6 rounded-xl border-border/60" data-testid="ai-share-of-voice">
            <h3 className="font-head font-bold mb-1 flex items-center gap-2"><Users size={16} className="text-[#6366F1]" /> AI Share of Voice</h3>
            <p className="text-xs text-muted-foreground mb-4">Which brands are mentioned or ranked across the major AI search engines (ChatGPT, Perplexity, Gemini, Claude, Copilot, Grok, Google AI).</p>
            {(r.ai_share_of_voice || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No AI share-of-voice data available.</p>
            ) : (
              <div className="space-y-3">
                {(r.ai_share_of_voice || []).map((s, i) => (
                  <div key={i} data-testid={`sov-row-${i}`}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className={`truncate ${s.is_you ? "font-bold text-[#6366F1]" : "font-medium"}`}>{s.name}{s.is_you ? " (you)" : ""}</span>
                      <span className="tabular-nums text-xs text-muted-foreground">{s.mention_count}/7 · {s.share_pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width: `${s.share_pct}%`, background: s.is_you ? "#6366F1" : "#94a3b8" }} /></div>
                    {Array.isArray(s.engines_present) && s.engines_present.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {s.engines_present.map((e, k) => <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">{e}</span>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <h3 className="font-head text-xl font-bold mb-4">Past domain reports</h3>
      {past.length === 0 ? <EmptyState icon={Globe} text="No domain reports yet." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {past.map((p) => (
            <button key={p.id} onClick={() => { setJobResult(JOB_KEY, p); setResult(p); setShowAllCites(false); setShowAllPrompts(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} data-testid={`domain-past-${p.id}`}
              className="text-left bg-white border border-border/60 rounded-xl p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg">
              <div className="flex items-center justify-between">
                <span className="font-head font-bold truncate">{p.domain}</span>
                <span className="font-head text-2xl font-extrabold" style={{ color: scoreColor(p.ai_readiness_score) }}>{p.ai_readiness_score}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{new Date(p.created_at).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
