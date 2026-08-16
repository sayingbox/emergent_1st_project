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
import { MessageSquare, Loader2, Sparkles, Users, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const engColor = { high: "bg-green-100 text-green-700 border-green-200", medium: "bg-amber-100 text-amber-700 border-amber-200", low: "bg-gray-100 text-gray-600 border-gray-200" };
const JOB_KEY = "reddit";

export default function Reddit() {
  const [topic, setTopic] = useSessionState("reddit:topic", "");
  const initial = getJobState(JOB_KEY);
  const [status, setStatus] = useState(initial.status || "idle");
  const [result, setResult] = useState(initial.result || null);
  const [past, setPast] = useState([]);
  const loading = status === "running";

  const load = () => http.get("/reddit").then((r) => setPast(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const unsub = subscribeJob(JOB_KEY, (snap) => {
      setStatus(snap.status || "idle");
      if (snap.status === "done" && snap.result) { setResult(snap.result); load(); }
      else if (snap.status === "error") {
        toast.error(formatApiErrorDetail(snap.error?.response?.data?.detail) || "Reddit search failed");
      }
    });
    return () => { unsub(); };
  }, []);

  const run = async () => {
    if (!topic.trim()) { toast.error("Enter a topic"); return; }
    try {
      await startSingleShotJob({ key: JOB_KEY, postPath: "/reddit", postBody: { topic } });
      toast.success("Reddit opportunities found");
    } catch {
      /* error surfaced via subscription */
    }
  };

  const r = result;
  return (
    <div>
      <PageHeader overline="Generative Engine (GEO)" title="Reddit Finder" subtitle="Reddit is one of the most-cited sources by AI engines. Find the communities and threads where your brand should show up." />

      <Card className="p-6 rounded-xl border-border/60 mb-8">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MessageSquare size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="e.g. project management software" className="pl-9" data-testid="reddit-topic-input" />
          </div>
          <Button onClick={run} disabled={loading} className="bg-black text-white hover:bg-gray-800 shrink-0" data-testid="run-reddit-btn">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Find</>}
          </Button>
        </div>
      </Card>

      {r && (
        <div className="mb-10 grid lg:grid-cols-12 gap-6" data-testid="reddit-result">
          <Card className="lg:col-span-4 p-6 rounded-xl border-border/60 h-fit">
            <h3 className="font-head font-bold mb-4 flex items-center gap-2"><Users size={18} className="text-[#FF4500]" /> Subreddits</h3>
            <div className="space-y-3">
              {(r.subreddits || []).map((s, i) => (
                <div key={i} className="flex items-start justify-between gap-2">
                  <div><div className="font-medium text-sm">{s.name}</div><div className="text-xs text-muted-foreground">{s.members} · {s.why}</div></div>
                  <Badge variant="secondary" className="rounded-md shrink-0">{s.relevance}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <div className="lg:col-span-8 space-y-3">
            <h3 className="font-head font-bold flex items-center gap-2"><TrendingUp size={18} className="text-[#FF4500]" /> Discussion opportunities</h3>
            {(r.threads || []).map((t, i) => (
              <Card key={i} className="p-5 rounded-xl border-border/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{t.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.subreddit} · {t.angle}</p>
                  </div>
                  <Badge className={`rounded-md border capitalize shrink-0 ${engColor[t.engagement] || engColor.low}`}>{t.engagement}</Badge>
                </div>
                <p className="text-xs mt-2"><span className="font-semibold">Opportunity:</span> {t.opportunity}</p>
              </Card>
            ))}
            {r.content_ideas?.length > 0 && (
              <Card className="p-6 rounded-xl border-border/60">
                <h3 className="font-head font-bold mb-3">Content ideas</h3>
                <ul className="space-y-2">{r.content_ideas.map((x, i) => <li key={i} className="text-sm flex gap-2"><Sparkles size={15} className="text-[#FF4500] mt-0.5 shrink-0" />{x}</li>)}</ul>
              </Card>
            )}
          </div>
        </div>
      )}

      <h3 className="font-head text-xl font-bold mb-4">Past searches</h3>
      {past.length === 0 ? <EmptyState icon={MessageSquare} text="No Reddit searches yet." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {past.map((p) => (
            <button key={p.id} onClick={() => { setJobResult(JOB_KEY, p); setResult(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} data-testid={`reddit-past-${p.id}`}
              className="text-left bg-white border border-border/60 rounded-xl p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg">
              <p className="font-head font-bold truncate">{p.topic}</p>
              <p className="text-xs text-muted-foreground mt-2">{p.subreddits?.length || 0} subreddits · {new Date(p.created_at).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
