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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { Newspaper, Loader2, Sparkles, ExternalLink, Send, Megaphone } from "lucide-react";
import { toast } from "sonner";

const JOB_KEY = "pr";

const typeColor = {
  funding: "bg-green-100 text-green-700 border-green-200",
  feature: "bg-indigo-100 text-indigo-700 border-indigo-200",
  review: "bg-amber-100 text-amber-700 border-amber-200",
  interview: "bg-purple-100 text-purple-700 border-purple-200",
  news: "bg-blue-100 text-blue-700 border-blue-200",
};

function logoFor(domain) {
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
}

export default function PRCoverage() {
  const [query, setQuery] = useSessionState("pr:query", "");
  const initial = getJobState(JOB_KEY);
  const [status, setStatus] = useState(initial.status || "idle");
  const [result, setResult] = useState(initial.result || null);
  const [past, setPast] = useState([]);
  const loading = status === "running";

  const load = () => http.get("/pr").then((r) => setPast(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const unsub = subscribeJob(JOB_KEY, (snap) => {
      setStatus(snap.status || "idle");
      if (snap.status === "done" && snap.result) { setResult(snap.result); load(); }
      else if (snap.status === "error") {
        toast.error(formatApiErrorDetail(snap.error?.response?.data?.detail) || "PR search failed");
      }
    });
    return () => { unsub(); };
  }, []);

  const run = async () => {
    if (!query.trim()) { toast.error("Enter a brand or domain"); return; }
    try {
      await startSingleShotJob({ key: JOB_KEY, postPath: "/pr", postBody: { query } });
      toast.success("PR coverage generated");
    } catch { /* surfaced via subscription */ }
  };

  const r = result;
  const press = r?.press || [];
  const cats = r?.pitch_categories || [];

  return (
    <div>
      <PageHeader overline="Generative Engine (GEO)" title="PR Coverage" subtitle="See existing press mentions and a curated media pitch list — earned media is heavily cited by AI answer engines." />

      <Card className="p-4 rounded-xl border-border/60 mb-5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Newspaper size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="Brand name or domain — e.g. Notion or notion.so" className="pl-9" data-testid="pr-query-input" />
          </div>
          <Button onClick={run} disabled={loading} className="btn-brand hover:opacity-90 shrink-0" data-testid="run-pr-btn">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Generate</>}
          </Button>
        </div>
      </Card>

      {loading && !r && (
        <Card className="p-10 rounded-xl border-border/60 mb-8 grid place-items-center text-center">
          <Loader2 className="animate-spin text-[#6366F1] mb-3" />
          <p className="text-sm text-muted-foreground">Finding press mentions and building your pitch list…</p>
        </Card>
      )}

      {r && (
        <div className="mb-10" data-testid="pr-result">
          <Tabs defaultValue="press">
            <TabsList className="mb-5">
              <TabsTrigger value="press" data-testid="pr-tab-press"><Newspaper size={15} className="mr-2" /> Press Coverage ({press.length})</TabsTrigger>
              <TabsTrigger value="pitch" data-testid="pr-tab-pitch"><Megaphone size={15} className="mr-2" /> Media Pitch List</TabsTrigger>
            </TabsList>

            <TabsContent value="press">
              {press.length === 0 ? <EmptyState icon={Newspaper} text="No notable press coverage found for this brand yet." /> : (
                <div className="space-y-3">
                  {press.map((a, i) => {
                    const logo = logoFor(a.publication_domain);
                    return (
                      <Card key={i} className="p-5 rounded-xl border-border/60">
                        <div className="flex items-start gap-4">
                          <div className="w-11 h-11 rounded-lg bg-muted grid place-items-center shrink-0 overflow-hidden">
                            {logo ? <img src={logo} alt="" className="w-7 h-7" onError={(e) => { e.target.style.display = "none"; }} /> : <Newspaper size={18} className="text-muted-foreground" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm">{a.publication}</span>
                              {a.type ? <Badge className={`rounded-md border capitalize text-[11px] ${typeColor[a.type] || typeColor.news}`}>{a.type}</Badge> : null}
                              {a.pr_type ? <Badge className={`rounded-md border capitalize text-[11px] ${a.pr_type === "paid" ? "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}`}>{a.pr_type} PR</Badge> : null}
                              {a.date ? <span className="text-[11px] text-muted-foreground">{a.date}</span> : null}
                            </div>
                            <p className="font-head font-bold text-[15px] mt-1">{a.headline}</p>
                            {a.description ? <p className="text-xs text-muted-foreground mt-1">{a.description}</p> : null}
                            {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="text-xs text-[#6366F1] font-medium inline-flex items-center gap-1 mt-2 hover:underline">Read article <ExternalLink size={12} /></a> : null}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="pitch">
              {cats.length === 0 ? <EmptyState icon={Megaphone} text="No pitch list generated." /> : (
                <div className="space-y-6">
                  {cats.map((c, i) => (
                    <div key={i}>
                      <h3 className="font-head font-bold mb-3 flex items-center gap-2"><Send size={16} className="text-[#6366F1]" /> {c.category}</h3>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {(c.outlets || []).map((o, j) => {
                          const logo = logoFor(o.domain);
                          return (
                            <Card key={j} className="p-5 rounded-xl border-border/60">
                              <div className="flex items-center gap-2.5 mb-2">
                                {logo ? <img src={logo} alt="" className="w-6 h-6 rounded" onError={(e) => { e.target.style.display = "none"; }} /> : <Megaphone size={16} className="text-muted-foreground" />}
                                <div className="font-semibold text-sm truncate">{o.outlet}</div>
                              </div>
                              {o.beat ? <p className="text-xs"><span className="font-semibold">Beat:</span> {o.beat}</p> : null}
                              {o.why ? <p className="text-xs text-muted-foreground mt-1">{o.why}</p> : null}
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      <h3 className="font-head text-xl font-bold mb-4">Past searches</h3>
      {past.length === 0 ? <EmptyState icon={Newspaper} text="No PR searches yet." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {past.map((p) => (
            <button key={p.id} onClick={() => { setJobResult(JOB_KEY, p); setResult(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} data-testid={`pr-past-${p.id}`}
              className="text-left bg-white border border-border/60 rounded-xl p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg">
              <p className="font-head font-bold truncate">{p.brand}</p>
              <p className="text-xs text-muted-foreground mt-2">{p.press?.length || 0} press mentions · {new Date(p.created_at).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
