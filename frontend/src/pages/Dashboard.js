import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useSessionState } from "@/hooks/useSessionState";
import { http, formatApiErrorDetail } from "@/lib/api";
import {
  startPollingJob,
  resumePollingJob,
  readPersistedJobId,
  subscribe as subscribeJob,
  getState as getJobState,
  reset as resetJob,
} from "@/lib/jobRegistry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { scoreColor } from "@/components/ScoreGauge";
import { Link2, FileText, Sparkles, Trash2, ArrowUpRight, Loader2, History } from "lucide-react";
import { toast } from "sonner";

const scoreLabel = (s) => (s >= 75 ? "Strong" : s >= 50 ? "Needs work" : "Poor");
const JOB_KEY = "optimizer";

export default function Dashboard() {
  const [tab, setTab] = useSessionState("optimizer:tab", "url");
  const [url, setUrl] = useSessionState("optimizer:url", "");
  const [text, setText] = useSessionState("optimizer:text", "");
  const [query, setQuery] = useSessionState("optimizer:query", "");
  const initial = getJobState(JOB_KEY);
  const [status, setStatus] = useState(initial.status || "idle");
  const [items, setItems] = useState([]);
  const navigate = useNavigate();
  const loading = status === "running";

  const load = async () => {
    try { const { data } = await http.get("/analyses"); setItems(data); } catch { /* ignore */ }
  };
  useEffect(() => {
    load();
    const unsub = subscribeJob(JOB_KEY, (snap) => {
      setStatus(snap.status || "idle");
      if (snap.status === "done" && snap.result?.id) {
        toast.success("Analysis complete");
        const id = snap.result.id;
        resetJob(JOB_KEY);
        navigate(`/app/analysis/${id}`);
      } else if (snap.status === "error") {
        const err = snap.error;
        toast.error(typeof err === "string" ? err.slice(0, 160) : "Analysis failed — please try again");
        resetJob(JOB_KEY);
      }
    });
    const savedJobId = readPersistedJobId(JOB_KEY);
    if (savedJobId && getJobState(JOB_KEY).status !== "running") {
      resumePollingJob({ key: JOB_KEY, jobId: savedJobId, statusPathTemplate: "/analyses/{id}" });
    }
    return () => { unsub(); };
  }, []);

  const analyze = async () => {
    const content = tab === "url" ? url.trim() : text.trim();
    if (!content) { toast.error("Please provide content to analyze"); return; }
    try {
      await startPollingJob({
        key: JOB_KEY,
        postPath: "/analyses",
        postBody: { input_type: tab, content, target_query: query || null },
        statusPathTemplate: "/analyses/{id}",
      });
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Analysis failed");
    }
  };

  const del = async (id, e) => {
    e.preventDefault(); e.stopPropagation();
    await http.delete(`/analyses/${id}`);
    toast.success("Deleted");
    load();
  };

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-[#18C090]">Answer Engine (AEO)</p>
          <h1 className="font-head text-4xl sm:text-5xl font-extrabold tracking-tight mt-2">Content Optimizer</h1>
          <p className="text-muted-foreground mt-3 max-w-2xl">Paste a URL or raw content. We audit clarity, structure, E-E-A-T, schema and question coverage — then tell you exactly how to get cited.</p>
        </div>
        <Link to="/app/history" data-testid="view-history-link"
          className="hidden sm:inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors shrink-0">
          <History size={16} /> History
        </Link>
      </div>

      <Card className="p-6 sm:p-8 rounded-lg border-border/60">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-5">
            <TabsTrigger value="url" data-testid="tab-url"><Link2 size={15} className="mr-2" /> From URL</TabsTrigger>
            <TabsTrigger value="text" data-testid="tab-text"><FileText size={15} className="mr-2" /> Paste content</TabsTrigger>
          </TabsList>
          <TabsContent value="url">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/blog/post" data-testid="url-input" className="text-base" />
          </TabsContent>
          <TabsContent value="text">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} data-testid="text-input"
              placeholder="Paste raw text, markdown or HTML here…" className="font-mono text-sm" />
          </TabsContent>
        </Tabs>
        <div className="mt-5">
          <label className="text-xs tracking-[0.15em] uppercase font-bold text-muted-foreground">Target query (optional)</label>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} data-testid="query-input"
            placeholder='e.g. "how to reduce churn for SaaS"' className="mt-1.5" />
        </div>
        <Button onClick={analyze} disabled={loading} data-testid="analyze-btn"
          className="mt-6 bg-black text-white hover:bg-gray-800 h-11 px-6">
          {loading ? <><Loader2 size={16} className="mr-2 animate-spin" /> Analyzing…</> : <><Sparkles size={16} className="mr-2" /> Run GEO audit</>}
        </Button>
      </Card>

      <div>
        <h2 className="font-head text-2xl font-bold tracking-tight mb-4">Recent analyses</h2>
        {items.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-12 text-center text-muted-foreground grain">
            <Sparkles className="mx-auto mb-3 opacity-40" />
            <p>No analyses yet. Run your first GEO audit above.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="analyses-list">
            {items.map((it) => (
              <Link key={it.id} to={`/app/analysis/${it.id}`} data-testid={`analysis-card-${it.id}`}
                className="group block bg-white border border-border/60 rounded-lg p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-head font-bold truncate">{it.title}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{it.source_url || "Pasted content"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-head text-3xl font-extrabold tabular-nums" style={{ color: scoreColor(it.overall_score) }}>{it.overall_score}</div>
                    <div className="text-[10px] uppercase font-bold" style={{ color: scoreColor(it.overall_score) }}>{scoreLabel(it.overall_score)}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/60">
                  <span className="text-xs text-muted-foreground">{new Date(it.created_at).toLocaleDateString()}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={(e) => del(it.id, e)} data-testid={`delete-${it.id}`}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"><Trash2 size={15} /></button>
                    <ArrowUpRight size={16} className="text-muted-foreground group-hover:text-black transition-colors" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
