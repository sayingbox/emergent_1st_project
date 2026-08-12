import { useEffect, useState, useRef } from "react";
import { http, formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { ScoreGauge, scoreColor } from "@/components/ScoreGauge";
import { Globe, Loader2, Sparkles, Zap, Users, Link2, Search, ExternalLink, BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

const priColor = { high: "bg-red-100 text-red-700 border-red-200", medium: "bg-amber-100 text-amber-700 border-amber-200", low: "bg-gray-100 text-gray-600 border-gray-200" };
const posColor = { top: "bg-green-100 text-green-700 border-green-200", recommended: "bg-green-100 text-green-700 border-green-200", passing: "bg-amber-100 text-amber-700 border-amber-200" };
const engLabel = { chatgpt: "ChatGPT", perplexity: "Perplexity", google_ai: "Google AI", gemini: "Gemini" };

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
        {value ?? "—"}{colored && numeric ? "" : ""}
      </div>
    </div>
  );
}

export default function DomainAnalysis() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [past, setPast] = useState([]);
  const [showAllCites, setShowAllCites] = useState(false);
  const [showAllPrompts, setShowAllPrompts] = useState(false);
  const pollRef = useRef(null);

  const load = () => http.get("/domain").then((r) => setPast(r.data)).catch(() => {});
  useEffect(() => {
    load();
    return () => { pollRef.current && clearInterval(pollRef.current); };
  }, []);

  const run = async () => {
    if (!domain.trim()) { toast.error("Enter a domain"); return; }
    setLoading(true);
    setResult(null);
    setShowAllCites(false);
    setShowAllPrompts(false);
    try {
      const { data } = await http.post("/domain/analyze", { domain });
      const jobId = data.id;
      pollRef.current && clearInterval(pollRef.current);
      let elapsed = 0;
      pollRef.current = setInterval(async () => {
        elapsed += 3;
        if (elapsed > 180) {
          clearInterval(pollRef.current);
          setLoading(false);
          toast.error("Analysis is taking too long — please try again");
          return;
        }
        try {
          const { data: job } = await http.get(`/domain/${jobId}`);
          if (job.status === "done") {
            clearInterval(pollRef.current);
            setResult(job);
            setLoading(false);
            load();
            toast.success("Domain analyzed");
          } else if (job.status === "error") {
            clearInterval(pollRef.current);
            setLoading(false);
            toast.error("Analysis failed — please try again");
          }
        } catch {
          clearInterval(pollRef.current);
          setLoading(false);
          toast.error("Lost connection while analyzing");
        }
      }, 3000);
    } catch (e) {
      setLoading(false);
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const r = result;
  return (
    <div>
      <PageHeader overline="Overview" title="Domain Analysis" subtitle="Enter a domain for a full AI-search report — Domain Authority & SEO metrics, the citation sources AI pulls the brand from, the prompts it ranks for, relevant topics, and quick wins." />

      <Card className="p-6 rounded-xl border-border/60 mb-8">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="example.com" className="pl-9" data-testid="domain-input" />
          </div>
          <Button onClick={run} disabled={loading} className="bg-black text-white hover:bg-gray-800 shrink-0" data-testid="analyze-domain-btn">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Analyze</>}
          </Button>
        </div>
      </Card>

      {loading && !r && (
        <Card className="p-10 rounded-xl border-border/60 mb-10 flex flex-col items-center justify-center text-center grain" data-testid="domain-loading">
          <Loader2 size={28} className="animate-spin text-[#002FA7]" />
          <p className="font-head font-bold mt-4">Building your deep AI-search report…</p>
          <p className="text-sm text-muted-foreground mt-1">Scanning 50+ citation sources and ranking prompts. This can take up to a minute.</p>
        </Card>
      )}

      {r && (
        <div className="grid lg:grid-cols-12 gap-6 mb-10" data-testid="domain-result">
          <Card className="lg:col-span-4 p-8 rounded-xl border-border/60 flex flex-col items-center justify-center text-center">
            <ScoreGauge score={r.ai_readiness_score} label="AI READINESS" />
            <h2 className="font-head text-xl font-bold mt-5">{r.domain}</h2>
            <p className="text-sm text-muted-foreground mt-2">{r.brand_summary}</p>
            <Badge className={`mt-3 rounded-md border ${r.known_by_ai ? "bg-green-100 text-green-700 border-green-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>
              {r.known_by_ai ? "Recognized by AI engines" : "Low AI recognition"}
            </Badge>
          </Card>

          {/* Metrics */}
          <Card className="lg:col-span-8 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-4 flex items-center gap-2"><BarChart3 size={18} className="text-[#002FA7]" /> SEO & authority metrics</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Metric label="Domain Authority" value={r.metrics?.domain_authority} colored />
              <Metric label="Page Authority" value={r.metrics?.page_authority} colored />
              <Metric label="Trust Score" value={r.metrics?.trust_score} colored />
              <Metric label="Backlinks" value={r.metrics?.estimated_backlinks} />
              <Metric label="Referring Domains" value={r.metrics?.referring_domains} />
              <Metric label="Est. Monthly Traffic" value={r.metrics?.estimated_monthly_traffic} />
            </div>
            <div className="mt-6 space-y-4">{(r.categories || []).map((c, i) => <Bar key={i} {...c} />)}</div>
          </Card>

          {/* Citation sources */}
          <Card className="lg:col-span-7 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-1 flex items-center gap-2"><Link2 size={18} className="text-[#002FA7]" /> AI citation sources</h3>
            <p className="text-xs text-muted-foreground mb-4">Where generative engines pull their knowledge of this brand.</p>
            <div className="space-y-2" data-testid="citation-sources">
              {(showAllCites ? (r.citation_sources || []) : (r.citation_sources || []).slice(0, 5)).map((c, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/60">
                  <span className="font-head font-bold text-muted-foreground w-5 text-center shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{c.source}</span>
                      <Badge variant="secondary" className="rounded-md capitalize text-[10px]">{c.type}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.why}</p>
                    {c.url && <a href={c.url.startsWith("http") ? c.url : `https://${c.url}`} target="_blank" rel="noreferrer" className="text-xs text-[#002FA7] inline-flex items-center gap-1 mt-1 hover:underline break-all">{c.url} <ExternalLink size={11} /></a>}
                  </div>
                  <span className="font-head font-bold text-sm shrink-0" style={{ color: scoreColor(c.authority) }}>{c.authority}</span>
                </div>
              ))}
              {(!r.citation_sources || r.citation_sources.length === 0) && <p className="text-sm text-muted-foreground">No notable citation sources detected — this brand has little third-party coverage AI can draw on.</p>}
            </div>
            {(r.citation_sources || []).length > 5 && (
              <button onClick={() => setShowAllCites((v) => !v)} data-testid="toggle-citations"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#002FA7] hover:underline">
                {showAllCites ? <>Show less <ChevronUp size={15} /></> : <>View {(r.citation_sources.length - 5)} more <ChevronDown size={15} /></>}
              </button>
            )}
          </Card>

          {/* Ranking prompts */}
          <Card className="lg:col-span-5 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-1 flex items-center gap-2"><Search size={18} className="text-[#002FA7]" /> Ranking prompts</h3>
            <p className="text-xs text-muted-foreground mb-4">Queries this domain surfaces for in AI answers.</p>
            <div className="space-y-2" data-testid="ranking-prompts">
              {(showAllPrompts ? (r.ranking_prompts || []) : (r.ranking_prompts || []).slice(0, 5)).map((p, i) => (
                <div key={i} className="p-3 rounded-lg bg-muted/40">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{p.prompt}</span>
                    <Badge className={`rounded-md border capitalize shrink-0 text-[10px] ${posColor[p.position] || priColor.low}`}>{p.position}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <Badge variant="outline" className="rounded-md text-[10px] capitalize">{p.intent}</Badge>
                    {(p.engines || []).map((e) => <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-border/60 text-muted-foreground">{engLabel[e] || e}</span>)}
                  </div>
                </div>
              ))}
            </div>
            {(r.ranking_prompts || []).length > 5 && (
              <button onClick={() => setShowAllPrompts((v) => !v)} data-testid="toggle-prompts"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#002FA7] hover:underline">
                {showAllPrompts ? <>Show less <ChevronUp size={15} /></> : <>View {(r.ranking_prompts.length - 5)} more <ChevronDown size={15} /></>}
              </button>
            )}
          </Card>

          {/* Top topics */}
          <Card className="lg:col-span-7 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-4">Top relevant topics</h3>
            <div className="space-y-3" data-testid="top-topics">
              {(r.top_topics || []).map((t, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1"><span className="font-medium">{t.topic}</span><span className="text-xs text-muted-foreground">auth {t.authority} · rel {t.relevance}</span></div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${t.authority}%`, background: scoreColor(t.authority) }} /></div>
                </div>
              ))}
            </div>
          </Card>

          {/* Quick wins */}
          <Card className="lg:col-span-5 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-4 flex items-center gap-2"><Zap size={18} className="text-[#002FA7]" /> Quick wins</h3>
            <div className="space-y-2">
              {(r.quick_wins || []).map((q, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <Badge className={`${priColor[q.priority] || priColor.low} border rounded-md capitalize shrink-0`}>{q.priority}</Badge>
                  <span className="text-sm">{q.action}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Competitors */}
          <Card className="lg:col-span-12 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-3 flex items-center gap-2"><Users size={16} /> Competitors for the same AI answers</h3>
            <div className="flex flex-wrap gap-2">{(r.competitors || []).map((t, i) => <Badge key={i} variant="outline" className="rounded-md">{t}</Badge>)}</div>
          </Card>
        </div>
      )}

      <h3 className="font-head text-xl font-bold mb-4">Past domain reports</h3>
      {past.length === 0 ? <EmptyState icon={Globe} text="No domain reports yet." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {past.map((p) => (
            <button key={p.id} onClick={() => { setResult(p); setShowAllCites(false); setShowAllPrompts(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} data-testid={`domain-past-${p.id}`}
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
