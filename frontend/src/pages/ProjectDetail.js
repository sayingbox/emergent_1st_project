import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { http, formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScoreGauge, scoreColor } from "@/components/ScoreGauge";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import {
  Loader2, RefreshCcw, ArrowLeft, ExternalLink, CheckCircle2, XCircle,
  AlertTriangle, Link2, Activity, FileText, Globe, ChevronDown, ChevronRight,
  Zap, ShieldCheck, Newspaper, Users, Gauge, Bot, MapPin, MessageSquare, Star, Wrench,
} from "lucide-react";
import { toast } from "sonner";

const severityColor = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-blue-100 text-blue-700 border-blue-200",
};
const categoryLabel = { seo: "SEO", performance: "Perf", aeo: "AEO" };
const posColor = {
  top: "bg-green-100 text-green-700 border-green-200",
  recommended: "bg-green-100 text-green-700 border-green-200",
  passing: "bg-amber-100 text-amber-700 border-amber-200",
  none: "bg-red-100 text-red-700 border-red-200",
};

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({}); // pageIdx -> bool
  const pollRef = useRef(null);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const { data } = await http.get(`/projects/${id}`);
      setProject(data);
      if (data.status !== "processing" && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not load project");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 5000);
    return () => pollRef.current && clearInterval(pollRef.current);
  }, [id]);

  const rescan = async () => {
    try {
      await http.post(`/projects/${id}/rescan`);
      toast.success("Re-scan started");
      load();
      if (!pollRef.current) pollRef.current = setInterval(load, 5000);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  if (loading || !project) {
    return (
      <Card className="p-10 rounded-xl border-border/60 flex flex-col items-center justify-center">
        <Loader2 size={22} className="animate-spin text-muted-foreground" />
      </Card>
    );
  }

  const processing = project.status === "processing";
  const errored = project.status === "error";
  const pages = project.pages || [];
  const citations = project.citations || [];
  const rankings = project.rankings || [];
  const tech = project.technical_readiness || {};
  const bp = project.brand_presence || {};
  const bpPlatforms = bp.platforms || [];
  const prList = project.pr_list || [];
  const ci = project.competitor_intel || {};
  const ep = ci.engine_presence || ci.share_of_voice || [];
  const gaps = ci.gap_analysis || [];
  const llmDist = project.llm_distribution || [];
  const countries = project.mention_countries || [];
  const reviews = project.reviews || {};
  const opps = project.citation_opportunities || [];
  const brand = project.brand?.brand || project.domain;

  return (
    <div>
      <Link to="/app/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft size={14} /> All projects
      </Link>

      <PageHeader
        overline={`Project · ${project.domain}`}
        title={brand}
        subtitle={project.brand?.summary || "One-project dashboard: deep crawl, per-page issues, AI citations & prompt rankings."}
        action={
          <div className="flex items-center gap-2">
            {processing && <Badge className="bg-amber-100 text-amber-700 border border-amber-200"><Loader2 size={11} className="animate-spin mr-1" /> Scanning site — usually ~2 min</Badge>}
            {errored && <Badge className="bg-red-100 text-red-700 border border-red-200"><AlertTriangle size={11} className="mr-1" /> {project.error || "Error"}</Badge>}
            <Button variant="outline" onClick={rescan} disabled={processing} data-testid="rescan-project-btn"><RefreshCcw size={14} className="mr-1" /> Re-scan</Button>
          </div>
        }
      />

      {/* Health hero */}
      <div className="grid lg:grid-cols-12 gap-6 mb-8">
        <Card className="lg:col-span-4 p-8 rounded-xl border-border/60 flex flex-col items-center justify-center text-center grain">
          <ScoreGauge score={project.site_health_score || 0} label="SITE HEALTH" />
          <p className="text-xs text-muted-foreground mt-4">Weighted avg of SEO, performance & AEO across every crawled page.</p>
        </Card>
        <Card className="lg:col-span-4 p-8 rounded-xl border-border/60 flex flex-col items-center justify-center text-center grain">
          <ScoreGauge score={project.ai_readiness_score || 0} label="AI READINESS" />
          <p className="text-xs text-muted-foreground mt-4">How ready this site is to be surfaced & cited by AI answer engines.</p>
        </Card>
        <div className="lg:col-span-4 grid grid-cols-2 gap-4 content-start">
          <MiniStat label="Pages crawled" value={project.total_pages || 0} />
          <MiniStat label="Total issues" value={project.total_issues || 0} tone={project.total_issues > 20 ? "bad" : project.total_issues > 5 ? "warn" : "ok"} />
          <MiniStat label="AI citations" value={project.ai_citations_count || 0} tone={project.ai_citations_count > 0 ? "ok" : "warn"} />
          <MiniStat label="Prompts ranking" value={`${project.prompt_top_count || 0}/${project.prompt_rankings_count || 0}`} tone={project.prompt_top_count > 0 ? "ok" : "warn"} />
        </div>
      </div>

      {/* Audit insights: Distribution by LLM + By Country */}
      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <Card className="p-5 rounded-xl border-border/60" data-testid="llm-distribution">
          <h4 className="font-head font-bold text-sm mb-1 flex items-center gap-2"><Bot size={15} className="text-[#6366F1]" /> Distribution by LLM</h4>
          <p className="text-xs text-muted-foreground mb-4">How your brand&apos;s mentions spread across AI answer engines (from prompt-ranking simulations).</p>
          {llmDist.length === 0 ? (
            <div className="text-sm text-muted-foreground">{processing ? "Simulating engines…" : "No engine data yet."}</div>
          ) : (
            <div className="space-y-3">
              {llmDist.map((e, i) => (
                <div key={i} data-testid={`llm-row-${i}`}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium">{e.engine}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">{e.mentions} · {e.share_pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${e.share_pct}%`, background: "#6366F1" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-5 rounded-xl border-border/60" data-testid="by-country">
          <h4 className="font-head font-bold text-sm mb-1 flex items-center gap-2"><MapPin size={15} className="text-[#10b981]" /> By Country</h4>
          <p className="text-xs text-muted-foreground mb-4">Countries where your brand is most discussed & surfaced in AI search.</p>
          {countries.length === 0 ? (
            <div className="text-sm text-muted-foreground">{processing ? "Estimating geography…" : "No country data yet."}</div>
          ) : (
            <div className="space-y-3">
              {countries.map((c, i) => (
                <div key={i} data-testid={`country-row-${i}`}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium">{c.country}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">{c.share_pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.share_pct}%`, background: "#10b981" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Drill-in cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <DrillCard
          icon={Globe}
          title="Domain Analysis"
          subtitle="Deep AI-search domain report"
          onClick={() => navigate(`/app/domain?domain=${encodeURIComponent(project.domain)}&autorun=1`)}
          testid="drill-domain"
        />
        <DrillCard
          icon={Activity}
          title="Visibility Tracker"
          subtitle="Test more prompts across engines"
          onClick={() => navigate(`/app/visibility?brand=${encodeURIComponent(brand)}&domain=${encodeURIComponent(project.domain)}`)}
          testid="drill-visibility"
        />
        <DrillCard
          icon={Link2}
          title="Citation Sources"
          subtitle="Predict who cites you for a query"
          onClick={() => navigate(`/app/citations?domain=${encodeURIComponent(project.domain)}`)}
          testid="drill-citations"
        />
        <DrillCard
          icon={FileText}
          title="Content Optimizer"
          subtitle="Fix content on any page"
          onClick={() => navigate(`/app/optimizer?url=${encodeURIComponent("https://" + project.domain)}`)}
          testid="drill-optimizer"
        />
      </div>

      {/* Detail tabs */}
      <Tabs defaultValue="pages">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="pages" data-testid="tab-pages">Pages ({pages.length})</TabsTrigger>
          <TabsTrigger value="technical" data-testid="tab-technical">Technical</TabsTrigger>
          <TabsTrigger value="brand" data-testid="tab-brand">Brand ({bp.found_count || 0})</TabsTrigger>
          <TabsTrigger value="pr" data-testid="tab-pr">PR ({prList.length})</TabsTrigger>
          <TabsTrigger value="competitors" data-testid="tab-competitors">Competitors</TabsTrigger>
          <TabsTrigger value="opportunities" data-testid="tab-opportunities">Citation Opportunities ({opps.length})</TabsTrigger>
          <TabsTrigger value="reviews" data-testid="tab-reviews">Reviews</TabsTrigger>
          <TabsTrigger value="citations" data-testid="tab-citations">Web Citations ({citations.length})</TabsTrigger>
          <TabsTrigger value="rankings" data-testid="tab-rankings">Prompt Rankings ({rankings.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pages" className="mt-4">
          {pages.length === 0 ? (
            <EmptyState icon={FileText} text={processing ? "Crawling site — pages will appear as they're analyzed." : "No pages crawled."} />
          ) : (
            <Card className="rounded-xl border-border/60 overflow-hidden" data-testid="pages-table">
              <div className="hidden md:grid grid-cols-12 items-center gap-3 px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground bg-muted/40 border-b">
                <div className="col-span-5">URL</div>
                <div className="col-span-1 text-center">Perf</div>
                <div className="col-span-1 text-center">SEO</div>
                <div className="col-span-1 text-center">AEO</div>
                <div className="col-span-1 text-center">Words</div>
                <div className="col-span-1 text-center">Load</div>
                <div className="col-span-2 text-right">Issues</div>
              </div>
              {pages.map((p, i) => (
                <div key={p.id || i} className="border-b last:border-0" data-testid={`page-row-${i}`}>
                  <button onClick={() => setExpanded((x) => ({ ...x, [i]: !x[i] }))} className="w-full grid grid-cols-1 md:grid-cols-12 gap-3 items-center px-4 py-3 text-left hover:bg-muted/30">
                    <div className="col-span-5 min-w-0 flex items-center gap-2">
                      {expanded[i] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="truncate text-sm">{p.url.replace(/^https?:\/\//, "")}</span>
                    </div>
                    <div className="col-span-1 text-center"><ScoreChip s={p.perf_score} /></div>
                    <div className="col-span-1 text-center"><ScoreChip s={p.seo_score} /></div>
                    <div className="col-span-1 text-center"><ScoreChip s={p.aeo_score} /></div>
                    <div className="col-span-1 text-center text-xs text-muted-foreground tabular-nums">{p.word_count}</div>
                    <div className="col-span-1 text-center text-xs text-muted-foreground tabular-nums">{p.load_time_ms}ms</div>
                    <div className="col-span-2 text-right">
                      {p.issue_count === 0 ? (
                        <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Clean</span>
                      ) : (
                        <span className="text-xs text-red-600 inline-flex items-center gap-1"><AlertTriangle size={12} /> {p.issue_count} issues</span>
                      )}
                    </div>
                  </button>
                  {expanded[i] && (
                    <div className="px-4 pb-4 pt-1 bg-muted/20">
                      <div className="grid md:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">Title</div>
                          <div className="text-sm">{p.title || <em className="text-red-500">missing</em>}</div>
                          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mt-3 mb-1">Meta description</div>
                          <div className="text-sm">{p.meta_description || <em className="text-red-500">missing</em>}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">Signals</div>
                          <div className="text-xs space-y-1">
                            <Signal ok={p.has_schema} label={`Schema${p.schema_types?.length ? " (" + p.schema_types.join(", ") + ")" : ""}`} />
                            <Signal ok={p.has_faq_schema} label="FAQ schema" />
                            <Signal ok={p.has_canonical} label="Canonical link" />
                            <Signal ok={p.has_open_graph} label="OpenGraph tags" />
                            <Signal ok={p.has_author} label="Author info" />
                            <Signal ok={p.imgs_missing_alt === 0} label={`All images have alt (${p.imgs_missing_alt} missing)`} />
                          </div>
                        </div>
                      </div>
                      {p.issues && p.issues.length > 0 && (
                        <div className="mt-4">
                          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">Issues ({p.issues.length})</div>
                          <div className="space-y-2">
                            {p.issues.map((iss, k) => (
                              <div key={k} className={`text-xs px-3 py-2 rounded-md border ${severityColor[iss.severity]}`} data-testid={`issue-${iss.code}`}>
                                <div className="font-medium">
                                  <span className="font-bold mr-1">[{categoryLabel[iss.category] || iss.category}]</span>
                                  {iss.message}
                                </div>
                                {iss.fix ? (
                                  <div className="mt-1 flex items-start gap-1 text-[11px] text-foreground/80">
                                    <Wrench size={11} className="mt-0.5 shrink-0" /> <span><b>Fix:</b> {iss.fix}</span>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="mt-4">
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#6366F1] inline-flex items-center gap-1 hover:underline">
                          Open page <ExternalLink size={11} />
                        </a>
                        <button onClick={() => navigate(`/app/optimizer?url=${encodeURIComponent(p.url)}`)}
                          className="ml-4 text-xs text-blue-600 inline-flex items-center gap-1 hover:underline">
                          Optimize this page →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="technical" className="mt-4" data-testid="technical-panel">
          {processing && !tech.speed_score ? (
            <EmptyState icon={Gauge} text="Measuring site speed & crawlability…" />
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-5 mb-5">
                <Card className="p-5 rounded-xl border-border/60">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-head font-bold text-sm flex items-center gap-2"><Zap size={15} className="text-[#6366F1]" /> Site Speed</h4>
                    <span className="text-2xl font-bold tabular-nums" style={{ color: scoreColor(tech.speed_score || 0) }}>{tech.speed_score ?? "—"}</span>
                  </div>
                  <StatRow label="Avg load time" value={`${tech.avg_load_time_ms ?? "—"} ms`} />
                  <StatRow label="Median load time" value={`${tech.median_load_time_ms ?? "—"} ms`} />
                  <StatRow label="Avg page size" value={`${tech.avg_page_size_kb ?? "—"} KB`} />
                  <StatRow label="Slow pages (>3s)" value={tech.slow_pages_count ?? 0} bad={tech.slow_pages_count > 0} />
                </Card>
                <Card className="p-5 rounded-xl border-border/60">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-head font-bold text-sm flex items-center gap-2"><Globe size={15} className="text-[#6366F1]" /> Crawlability</h4>
                    <span className="text-2xl font-bold tabular-nums" style={{ color: scoreColor(tech.crawl_score || 0) }}>{tech.crawl_score ?? "—"}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <FlagBadge ok={tech.https} label="HTTPS" />
                    <FlagBadge ok={tech.robots_txt_found} label="robots.txt" />
                    <FlagBadge ok={tech.sitemap_found} label="Sitemap" />
                  </div>
                  <StatRow label="Pages reachable" value={`${tech.pages_ok ?? 0}/${tech.pages_total ?? 0}`} />
                  <StatRow label="Schema coverage" value={`${tech.schema_coverage_pct ?? 0}%`} />
                  <StatRow label="Canonical coverage" value={`${tech.canonical_coverage_pct ?? 0}%`} />
                </Card>
              </div>
              {Array.isArray(tech.tech_issues) && tech.tech_issues.length > 0 && (
                <Card className="p-5 rounded-xl border-border/60 mb-5" data-testid="tech-issues">
                  <h4 className="font-head font-bold text-sm mb-3 flex items-center gap-2"><AlertTriangle size={15} className="text-amber-500" /> Technical issues &amp; how to fix ({tech.tech_issues.length})</h4>
                  <div className="space-y-2">
                    {tech.tech_issues.map((it, i) => (
                      <div key={i} className={`px-3 py-2 rounded-md border ${severityColor[it.severity] || severityColor.low}`} data-testid={`tech-issue-${i}`}>
                        <div className="text-sm font-semibold">{it.title}</div>
                        <div className="mt-1 flex items-start gap-1 text-[12px] text-foreground/80">
                          <Wrench size={12} className="mt-0.5 shrink-0" /> <span><b>Fix:</b> {it.fix}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {Array.isArray(tech.slowest_pages) && tech.slowest_pages.length > 0 && (
                <Card className="p-5 rounded-xl border-border/60">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">Slowest pages</div>
                  {tech.slowest_pages.map((p, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
                      <span className="truncate mr-3">{p.url.replace(/^https?:\/\//, "")}</span>
                      <span className="text-red-600 tabular-nums shrink-0">{p.load_time_ms} ms</span>
                    </div>
                  ))}
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="brand" className="mt-4" data-testid="brand-panel">
          {bpPlatforms.length === 0 ? (
            <EmptyState icon={ShieldCheck} text={processing ? "Checking brand presence across platforms…" : "No brand-presence data."} />
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">Found on <b className="text-foreground">{bp.found_count}</b> of {bpPlatforms.length} key platforms. Consistent listings help AI engines describe you correctly.</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {bpPlatforms.map((p, i) => (
                  <div key={i} className={`p-4 rounded-xl border ${p.present ? "border-border/60 bg-card" : "border-dashed border-border/60 bg-muted/30"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <img src={favicon(p.url, p.platform)} alt="" className="w-5 h-5 rounded" onError={(e) => { e.target.style.display = "none"; }} />
                        <span className="font-semibold text-sm truncate">{p.platform}</span>
                      </div>
                      {p.present
                        ? <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                        : <XCircle size={16} className="text-muted-foreground shrink-0" />}
                    </div>
                    {p.present && p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-[11px] text-[#6366F1] font-medium inline-flex items-center gap-1 mt-2 hover:underline truncate">
                        <ExternalLink size={10} className="shrink-0" /> <span className="truncate">{p.url.replace(/^https?:\/\//, "")}</span>
                      </a>
                    ) : <div className="text-[11px] text-muted-foreground mt-2">No listing found — opportunity to claim</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="pr" className="mt-4" data-testid="pr-panel">
          {prList.length === 0 ? (
            <EmptyState icon={Newspaper} text={processing ? "Finding press coverage…" : "No press coverage found for this brand yet."} />
          ) : (
            <div className="space-y-3">
              {prList.map((a, i) => (
                <Card key={i} className="p-4 rounded-xl border-border/60 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-muted grid place-items-center shrink-0 overflow-hidden">
                    <img src={favicon(a.url, a.publication_domain)} alt="" className="w-6 h-6" onError={(e) => { e.target.style.display = "none"; }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{a.publication}</span>
                      <Badge className={`rounded-md border capitalize text-[11px] ${a.pr_type === "paid" ? "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}`}>{a.pr_type} PR</Badge>
                      {a.date ? <span className="text-[11px] text-muted-foreground">{a.date}</span> : null}
                    </div>
                    <p className="font-head font-bold text-[14px] mt-0.5">{a.headline}</p>
                    {a.description ? <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.description}</p> : null}
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-xs text-[#6366F1] font-medium inline-flex items-center gap-1 mt-1.5 hover:underline">Read article <ExternalLink size={11} /></a>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="competitors" className="mt-4" data-testid="competitors-panel">
          {ep.length === 0 ? (
            <EmptyState icon={Users} text={processing ? "Analysing competitors…" : "No competitor data."} />
          ) : (
            <div className="grid lg:grid-cols-2 gap-5">
              <Card className="p-5 rounded-xl border-border/60">
                <h4 className="font-head font-bold text-sm mb-1 flex items-center gap-2"><Users size={15} className="text-[#6366F1]" /> AI Search Visibility</h4>
                <p className="text-xs text-muted-foreground mb-4">How often each brand is mentioned or ranked across AI search engines (ChatGPT, Perplexity, Gemini, Claude, Grok, Copilot).</p>
                <div className="space-y-3">
                  {ep.map((s, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className={`truncate ${s.is_you ? "font-bold text-[#6366F1]" : "font-medium"}`}>{s.name}{s.is_you ? " (you)" : ""}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">{s.mention_count ?? 0}/6 · {s.share_pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${s.share_pct}%`, background: s.is_you ? "#6366F1" : "#94a3b8" }} />
                      </div>
                      {Array.isArray(s.engines_present) && s.engines_present.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {s.engines_present.map((eng, k) => (
                            <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">{eng}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
              <Card className="p-5 rounded-xl border-border/60">
                <h4 className="font-head font-bold text-sm mb-1 flex items-center gap-2"><AlertTriangle size={15} className="text-amber-500" /> Gap Analysis</h4>
                <p className="text-xs text-muted-foreground mb-4">AI engines where competitors are getting mentioned but <b className="text-foreground">you are not</b> — where to focus to earn AI visibility.</p>
                {gaps.length === 0 ? (
                  <div className="text-sm text-emerald-600 flex items-center gap-2"><CheckCircle2 size={15} /> No gaps — you appear on every engine your competitors do.</div>
                ) : (
                  <div className="space-y-3">
                    {gaps.map((g, i) => (
                      <div key={i} className="p-3 rounded-lg border border-amber-200 bg-amber-50/60">
                        <div className="font-semibold text-sm flex items-center gap-1.5"><Bot size={13} className="text-amber-600" /> {g.engine}</div>
                        <div className="text-xs text-muted-foreground mt-1">Mentioned here: {g.competitors_present.map((c, k) => (
                          <span key={k} className="text-foreground font-medium">{c.name}{k < g.competitors_present.length - 1 ? ", " : ""}</span>
                        ))}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              {Array.isArray(ci.competitors) && ci.competitors.length > 0 && (
                <Card className="p-5 rounded-xl border-border/60 lg:col-span-2">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">Direct competitors ({ci.competitors.length})</div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {ci.competitors.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <img src={favicon(c.domain ? "https://" + c.domain : "", c.name)} alt="" className="w-5 h-5 rounded mt-0.5" onError={(e) => { e.target.style.display = "none"; }} />
                        <div><span className="font-semibold">{c.name}</span>{c.why ? <span className="text-muted-foreground"> — {c.why}</span> : null}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="citations" className="mt-4">
          {citations.length === 0 ? (
            <EmptyState icon={Link2} text={processing ? "Discovering citation sources…" : "No citations detected yet."} />
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-3">{citations.length} sources where <b className="text-foreground">{brand}</b> is mentioned — the article/page and which AI engines pick up the reference.</p>
              <Card className="rounded-xl border-border/60 overflow-hidden" data-testid="citations-table">
                <div className="hidden md:grid grid-cols-12 items-center gap-3 px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground bg-muted/40 border-b">
                  <div className="col-span-5">Source page</div>
                  <div className="col-span-4">Picked up by</div>
                  <div className="col-span-1 text-center">Type</div>
                  <div className="col-span-1 text-center">Live</div>
                  <div className="col-span-1 text-right">Verified</div>
                </div>
                {citations.map((c, i) => (
                  <div key={c.id || i} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start px-4 py-3 border-b last:border-0 hover:bg-muted/30" data-testid={`citation-row-${i}`}>
                    <div className="col-span-5 min-w-0">
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline inline-flex items-center gap-1">
                        <img src={favicon(c.url, c.source_domain)} alt="" className="w-4 h-4 rounded shrink-0" onError={(e) => { e.target.style.display = "none"; }} />
                        <span className="truncate">{c.title || c.source_domain}</span> <ExternalLink size={11} className="shrink-0" />
                      </a>
                      <div className="text-[11px] text-muted-foreground truncate">{c.source_domain}</div>
                      {c.snippet ? <div className="text-[11px] text-muted-foreground italic mt-1 line-clamp-2">&quot;{c.snippet}&quot;</div> : (c.why ? <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{c.why}</div> : null)}
                    </div>
                    <div className="col-span-4 flex flex-wrap gap-1 content-start">
                      {(c.engines || []).map((eng, k) => (
                        <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-[#6366F1]/10 text-[#6366F1] capitalize">{String(eng).replace("_", " ")}</span>
                      ))}
                    </div>
                    <div className="col-span-1 text-center">
                      <Badge className="bg-muted text-foreground border">{c.type}</Badge>
                    </div>
                    <div className="col-span-1 text-center text-xs tabular-nums">{c.http_status || "—"}</div>
                    <div className="col-span-1 text-right">
                      {c.verified ? <CheckCircle2 size={16} className="text-emerald-600 inline" /> : <XCircle size={16} className="text-muted-foreground inline" />}
                    </div>
                  </div>
                ))}
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="rankings" className="mt-4">
          {rankings.length === 0 ? (
            <EmptyState icon={Activity} text={processing ? "Simulating AI prompts…" : "No prompt rankings yet."} />
          ) : (
            <Card className="rounded-xl border-border/60 overflow-hidden" data-testid="rankings-table">
              <div className="hidden md:grid grid-cols-12 items-center gap-3 px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground bg-muted/40 border-b">
                <div className="col-span-6">Prompt</div>
                <div className="col-span-2 text-center">Position</div>
                <div className="col-span-3">Engines</div>
                <div className="col-span-1 text-right">Note</div>
              </div>
              {rankings.map((r, i) => (
                <div key={r.id || i} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center px-4 py-3 border-b last:border-0 hover:bg-muted/30" data-testid={`ranking-row-${i}`}>
                  <div className="col-span-6 text-sm font-medium">{r.prompt}</div>
                  <div className="col-span-2 text-center">
                    <Badge className={`border ${posColor[r.position] || posColor.none}`}>{r.position}</Badge>
                  </div>
                  <div className="col-span-3 flex flex-wrap gap-1">
                    {Object.entries(r.engines || {}).map(([eng, ok]) => (
                      <span key={eng} className={`text-[10px] px-1.5 py-0.5 rounded ${ok ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{eng}</span>
                    ))}
                  </div>
                  <div className="col-span-1 text-right text-xs text-muted-foreground truncate" title={r.note}>{r.note}</div>
                </div>
              ))}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="opportunities" className="mt-4" data-testid="opportunities-panel">
          {opps.length === 0 ? (
            <EmptyState icon={MessageSquare} text={processing ? "Finding communities & discussions…" : "No citation opportunities found yet."} />
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">Real communities, forums & Q&amp;A threads discussing your topics — engage here to earn AI citations.</p>
              <div className="grid md:grid-cols-2 gap-3">
                {opps.map((o, i) => (
                  <Card key={i} className="p-4 rounded-xl border-border/60 flex items-start gap-3" data-testid={`opportunity-${i}`}>
                    <div className="w-9 h-9 rounded-lg bg-muted grid place-items-center shrink-0 overflow-hidden">
                      <img src={favicon(o.url, o.platform)} alt="" className="w-6 h-6" onError={(e) => { e.target.style.display = "none"; }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{o.platform}</span>
                        <Badge className="rounded-md border bg-muted text-foreground text-[11px]">{o.type}</Badge>
                        {o.topic ? <span className="text-[11px] text-muted-foreground truncate">on &ldquo;{o.topic}&rdquo;</span> : null}
                      </div>
                      <p className="font-head font-bold text-[14px] mt-0.5 line-clamp-2">{o.title || o.url}</p>
                      {o.snippet ? <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{o.snippet}</p> : null}
                      <a href={o.url} target="_blank" rel="noreferrer" className="text-xs text-[#6366F1] font-medium inline-flex items-center gap-1 mt-1.5 hover:underline">Open discussion <ExternalLink size={11} /></a>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="reviews" className="mt-4" data-testid="reviews-panel">
          {(!reviews.platforms || reviews.platforms.length === 0) ? (
            <EmptyState icon={Star} text={processing ? "Fetching reviews across platforms…" : "No review data found yet."} />
          ) : (
            <>
              <div className="grid sm:grid-cols-3 gap-4 mb-5">
                <Card className="p-6 rounded-xl border-border/60 flex flex-col items-center justify-center text-center" data-testid="reviews-overall">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">Overall score</div>
                  <div className="text-4xl font-bold text-amber-500 flex items-center gap-1">
                    {reviews.overall_score ?? "—"}<Star size={22} className="fill-amber-400 text-amber-400" />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">avg of {reviews.rated_platform_count || 0} rated platforms</div>
                </Card>
                <MiniStat label="Platforms checked" value={reviews.platform_count || 0} />
                <MiniStat label="Total reviews" value={(reviews.total_reviews || 0).toLocaleString()} tone={reviews.total_reviews > 0 ? "ok" : "warn"} />
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {reviews.platforms.map((p, i) => (
                  <div key={i} className={`p-4 rounded-xl border ${p.found ? "border-border/60 bg-card" : "border-dashed border-border/60 bg-muted/30"}`} data-testid={`review-platform-${i}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <img src={favicon(p.url, p.host)} alt="" className="w-5 h-5 rounded" onError={(e) => { e.target.style.display = "none"; }} />
                        <span className="font-semibold text-sm truncate">{p.platform}</span>
                      </div>
                      {p.rating ? (
                        <span className="text-sm font-bold text-amber-500 flex items-center gap-0.5">{p.rating}<Star size={13} className="fill-amber-400 text-amber-400" /></span>
                      ) : <span className="text-xs text-muted-foreground">{p.found ? "N/A" : "—"}</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-2">
                      {p.review_count ? `${p.review_count.toLocaleString()} reviews` : (p.found ? "Profile found" : "No profile found")}
                    </div>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-[11px] text-[#6366F1] font-medium inline-flex items-center gap-1 mt-1 hover:underline truncate">
                        <ExternalLink size={10} className="shrink-0" /> <span className="truncate">View profile</span>
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-4">Employee-review sites (Glassdoor, Indeed, AmbitionBox) are excluded. Ratings fetched via TinyFish web search.</p>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MiniStat({ label, value, tone = "ok" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-emerald-600";
  return (
    <Card className="p-4 rounded-xl border-border/60">
      <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </Card>
  );
}

function DrillCard({ icon: Icon, title, subtitle, onClick, testid }) {
  return (
    <button onClick={onClick} data-testid={testid}
      className="text-left p-4 rounded-xl border border-border/60 bg-card hover:shadow-md hover:border-[#6366F1] transition-all">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#6366F1]/10 grid place-items-center text-[#6366F1]"><Icon size={18} /></div>
        <div className="min-w-0 flex-1">
          <div className="font-head font-bold text-sm truncate">{title}</div>
          <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
        </div>
        <ExternalLink size={14} className="text-muted-foreground" />
      </div>
    </button>
  );
}

function ScoreChip({ s }) {
  return <span className="font-bold text-sm tabular-nums" style={{ color: scoreColor(s || 0) }}>{s ?? "—"}</span>;
}

function Signal({ ok, label }) {
  return (
    <div className={`inline-flex items-center gap-1.5 mr-3 ${ok ? "text-emerald-600" : "text-red-500"}`}>
      {ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {label}
    </div>
  );
}

function StatRow({ label, value, bad }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${bad ? "text-red-600" : ""}`}>{value}</span>
    </div>
  );
}

function FlagBadge({ ok, label }) {
  return (
    <Badge className={`rounded-md border ${ok ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-red-100 text-red-700 border-red-200"}`}>
      {ok ? <CheckCircle2 size={11} className="mr-1" /> : <XCircle size={11} className="mr-1" />}{label}
    </Badge>
  );
}

function favicon(url, fallbackName) {
  let dom = "";
  try {
    if (url) dom = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
  } catch (e) { dom = ""; }
  if (!dom && fallbackName && fallbackName.includes(".")) dom = fallbackName;
  return dom ? `https://www.google.com/s2/favicons?domain=${dom}&sz=64` : "";
}
