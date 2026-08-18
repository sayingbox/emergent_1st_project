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
        <TabsList>
          <TabsTrigger value="pages" data-testid="tab-pages">Pages ({pages.length})</TabsTrigger>
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
                          <div className="flex flex-wrap gap-2">
                            {p.issues.map((iss, k) => (
                              <div key={k} className={`text-xs px-2.5 py-1 rounded-md border ${severityColor[iss.severity]}`} data-testid={`issue-${iss.code}`}>
                                <span className="font-bold mr-1">[{categoryLabel[iss.category] || iss.category}]</span>
                                {iss.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="mt-4">
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#18C090] inline-flex items-center gap-1 hover:underline">
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

        <TabsContent value="citations" className="mt-4">
          {citations.length === 0 ? (
            <EmptyState icon={Link2} text={processing ? "Discovering citation sources…" : "No citations detected yet."} />
          ) : (
            <Card className="rounded-xl border-border/60 overflow-hidden" data-testid="citations-table">
              <div className="hidden md:grid grid-cols-12 items-center gap-3 px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground bg-muted/40 border-b">
                <div className="col-span-3">Source</div>
                <div className="col-span-6">Snippet / reason</div>
                <div className="col-span-1 text-center">Type</div>
                <div className="col-span-1 text-center">Live</div>
                <div className="col-span-1 text-right">Verified</div>
              </div>
              {citations.map((c, i) => (
                <div key={c.id || i} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center px-4 py-3 border-b last:border-0 hover:bg-muted/30" data-testid={`citation-row-${i}`}>
                  <div className="col-span-3 min-w-0">
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline inline-flex items-center gap-1 truncate">
                      {c.source_domain} <ExternalLink size={11} />
                    </a>
                  </div>
                  <div className="col-span-6 text-xs text-muted-foreground">
                    {c.snippet ? <span className="italic">&quot;{c.snippet}&quot;</span> : c.why}
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
      className="text-left p-4 rounded-xl border border-border/60 bg-card hover:shadow-md hover:border-[#18C090] transition-all">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#18C090]/10 grid place-items-center text-[#18C090]"><Icon size={18} /></div>
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
