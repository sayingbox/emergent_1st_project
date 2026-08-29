import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessionState } from "@/hooks/useSessionState";
import { http, formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { scoreColor } from "@/components/ScoreGauge";
import { FolderKanban, Loader2, Sparkles, Trash2, RefreshCcw, Globe, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const scoreLabel = (s) => (s >= 75 ? "Strong" : s >= 50 ? "OK" : "Poor");

export default function Projects() {
  const [domain, setDomain] = useSessionState("projects:input", "");
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const pollRef = useRef(null);

  const load = async () => {
    try {
      const { data } = await http.get("/projects");
      setItems(data || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // Poll while any project is still processing so cards update automatically
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await http.get("/projects");
        setItems(data || []);
      } catch { /* ignore */ }
    }, 5000);
    return () => pollRef.current && clearInterval(pollRef.current);
  }, []);

  const create = async () => {
    const d = domain.trim();
    if (!d || !d.includes(".")) { toast.error("Enter a valid domain, e.g. foiwe.com"); return; }
    setCreating(true);
    try {
      const { data } = await http.post("/projects", { domain: d });
      toast.success("Project created — scanning your site now");
      setDomain("");
      // jump straight into the project so the user sees progress
      navigate(`/app/projects/${data.id}`);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not create project");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this project and all its data?")) return;
    try {
      await http.delete(`/projects/${id}`);
      setItems((prev) => prev.filter((p) => p.id !== id));
      toast.success("Project deleted");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const rescan = async (id) => {
    try {
      await http.post(`/projects/${id}/rescan`);
      toast.success("Re-scan started");
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  return (
    <div>
      <PageHeader
        overline="Projects"
        title="One Project per Domain"
        subtitle="Add a domain once — we crawl the whole site, score every page, find where the brand is cited on the web, and check the prompts AI ranks it for."
      />

      <Card className="p-4 rounded-xl border-border/60 mb-5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="foiwe.com"
              className="pl-9"
              data-testid="project-domain-input"
            />
          </div>
          <Button onClick={create} disabled={creating} className="btn-brand hover:opacity-90 shrink-0" data-testid="create-project-btn">
            {creating ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Add Project</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          We&apos;ll crawl up to 25 pages, check per-URL SEO/AEO/performance issues, verify web citations, and simulate 8 AI-search prompts. Usually finishes in ~2 minutes.
        </p>
      </Card>

      {loading ? (
        <Card className="p-10 rounded-xl border-border/60 flex flex-col items-center justify-center text-center">
          <Loader2 size={22} className="animate-spin text-muted-foreground" />
        </Card>
      ) : items.length === 0 ? (
        <EmptyState icon={FolderKanban} text="No projects yet — add your first domain above to run a full crawl + AI-search health check." />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="projects-grid">
          {items.map((p) => (
            <Card key={p.id} className="p-5 rounded-xl border-border/60 hover:shadow-lg transition-shadow" data-testid={`project-card-${p.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-head font-bold text-lg truncate">{p.domain}</div>
                  {p.brand?.brand && p.brand.brand.toLowerCase() !== p.domain ? (
                    <div className="text-xs text-muted-foreground truncate">{p.brand.brand}</div>
                  ) : null}
                </div>
                {p.status === "processing" && (
                  <Badge className="bg-amber-100 text-amber-700 border border-amber-200 shrink-0"><Loader2 size={11} className="animate-spin mr-1" /> Scanning</Badge>
                )}
                {p.status === "done" && <Badge className="bg-green-100 text-green-700 border border-green-200 shrink-0">Ready</Badge>}
                {p.status === "error" && <Badge className="bg-red-100 text-red-700 border border-red-200 shrink-0">Error</Badge>}
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Site Health</div>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: scoreColor(p.site_health_score || 0) }}>{p.site_health_score ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground">{scoreLabel(p.site_health_score || 0)}</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">AI Readiness</div>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: scoreColor(p.ai_readiness_score || 0) }}>{p.ai_readiness_score ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground">{scoreLabel(p.ai_readiness_score || 0)}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div><div className="text-[10px] uppercase text-muted-foreground tracking-widest">Pages</div><div className="font-bold">{p.total_pages || 0}</div></div>
                <div><div className="text-[10px] uppercase text-muted-foreground tracking-widest">Issues</div><div className="font-bold text-red-600">{p.total_issues || 0}</div></div>
                <div><div className="text-[10px] uppercase text-muted-foreground tracking-widest">Cites</div><div className="font-bold text-emerald-600">{p.ai_citations_count || 0}</div></div>
              </div>

              <div className="flex items-center gap-2 mt-4">
                <Link to={`/app/projects/${p.id}`} className="flex-1">
                  <Button variant="outline" className="w-full" data-testid={`open-project-${p.id}`}>Open <ArrowRight size={14} className="ml-1" /></Button>
                </Link>
                <Button variant="ghost" size="icon" title="Re-scan" onClick={() => rescan(p.id)} disabled={p.status === "processing"}>
                  <RefreshCcw size={14} />
                </Button>
                <Button variant="ghost" size="icon" title="Delete" onClick={() => remove(p.id)}>
                  <Trash2 size={14} className="text-red-500" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
