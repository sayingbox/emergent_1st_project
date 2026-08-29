import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { scoreColor } from "@/components/ScoreGauge";
import { Activity, Loader2, Sparkles, Check, X } from "lucide-react";
import { toast } from "sonner";

const engineLabels = { chatgpt: "ChatGPT", claude: "Claude", perplexity: "Perplexity", google_ai: "Google AI", gemini: "Gemini", copilot: "Copilot", grok: "Grok" };
const posColor = { top: "bg-green-100 text-green-700 border-green-200", recommended: "bg-green-100 text-green-700 border-green-200", passing: "bg-amber-100 text-amber-700 border-amber-200", none: "bg-red-100 text-red-700 border-red-200" };
const JOB_KEY = "visibility";

export default function Visibility() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [brand, setBrand] = useSessionState("visibility:brand", "");
  const [domain, setDomain] = useSessionState("visibility:domain", "");
  const [prompts, setPrompts] = useSessionState("visibility:prompts", "");
  const initial = getJobState(JOB_KEY);
  const [status, setStatus] = useState(initial.status || "idle");
  const [result, setResult] = useState(initial.result || null);
  const [past, setPast] = useState([]);
  const loading = status === "running";

  const load = () => http.get("/visibility").then((r) => setPast(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const unsub = subscribeJob(JOB_KEY, (snap) => {
      setStatus(snap.status || "idle");
      if (snap.status === "done" && snap.result) {
        setResult(snap.result);
        load();
      } else if (snap.status === "error") {
        const err = snap.error;
        toast.error(formatApiErrorDetail(err?.response?.data?.detail) || "Visibility scan failed");
      }
    });
    // Pre-fill from URL query params (drill-in from Projects)
    const qBrand = searchParams.get("brand");
    const qDomain = searchParams.get("domain");
    if (qBrand) setBrand(qBrand);
    if (qDomain) setDomain(qDomain);
    if (qBrand || qDomain) setSearchParams({}, { replace: true });
    return () => { unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    const list = prompts.split("\n").map((p) => p.trim()).filter(Boolean);
    if (!brand.trim() || list.length === 0) { toast.error("Enter a brand and at least one prompt"); return; }
    try {
      await startSingleShotJob({ key: JOB_KEY, postPath: "/visibility", postBody: { brand, domain: domain || null, prompts: list } });
      toast.success("Visibility scan complete");
    } catch {
      /* error already surfaced via subscription */
    }
  };

  const r = result;
  return (
    <div>
      <PageHeader overline="Generative Engine (GEO)" title="Visibility Tracker" subtitle="See whether AI engines mention or recommend your brand for the prompts your customers ask." />

      <Card className="p-4 rounded-xl border-border/60 mb-5 grid gap-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="text-xs uppercase font-bold text-muted-foreground">Brand</label><Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Notion" className="mt-1.5" data-testid="brand-input" /></div>
          <div><label className="text-xs uppercase font-bold text-muted-foreground">Domain (optional)</label><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="notion.so" className="mt-1.5" data-testid="vis-domain-input" /></div>
        </div>
        <div>
          <label className="text-xs uppercase font-bold text-muted-foreground">Prompts (one per line)</label>
          <Textarea value={prompts} onChange={(e) => setPrompts(e.target.value)} rows={4} className="mt-1.5 font-mono text-sm" data-testid="prompts-input"
            placeholder={"best note taking app for teams\ntop project management tools\nhow to organize company docs"} />
        </div>
        <Button onClick={run} disabled={loading} className="btn-brand hover:opacity-90 justify-self-start" data-testid="run-visibility-btn">
          {loading ? <><Loader2 size={16} className="mr-2 animate-spin" /> Scanning…</> : <><Sparkles size={16} className="mr-2" /> Run visibility scan</>}
        </Button>
      </Card>

      {r && (
        <div className="mb-10" data-testid="visibility-result">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
            <Card className="p-5 rounded-xl border-border/60"><div className="text-xs uppercase font-bold text-muted-foreground">Visibility Score</div><div className="font-head text-4xl font-extrabold" style={{ color: scoreColor(r.visibility_score) }}>{r.visibility_score}</div></Card>
            <Card className="p-5 rounded-xl border-border/60"><div className="text-xs uppercase font-bold text-muted-foreground">Share of Voice</div><div className="font-head text-4xl font-extrabold" style={{ color: scoreColor(r.share_of_voice) }}>{r.share_of_voice}</div></Card>
            <Card className="p-5 rounded-xl border-border/60 col-span-2 sm:col-span-1"><div className="text-xs uppercase font-bold text-muted-foreground">Prompts Tested</div><div className="font-head text-4xl font-extrabold">{r.results?.length || 0}</div></Card>
          </div>

          <div className="space-y-3">
            {(r.results || []).map((res, i) => (
              <Card key={i} className="p-5 rounded-xl border-border/60">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <p className="font-medium text-sm">"{res.prompt}"</p>
                  <Badge className={`rounded-md border capitalize shrink-0 ${posColor[res.position] || posColor.none}`}>{res.mentioned ? res.position : "not mentioned"}</Badge>
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {Object.entries(res.engines || {}).map(([k, v]) => (
                    <span key={k} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md ${v ? "bg-green-50 text-green-700" : "bg-muted text-muted-foreground"}`}>
                      {v ? <Check size={12} /> : <X size={12} />} {engineLabels[k] || k}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{res.note}</p>
                {res.competitors_mentioned?.length > 0 && <p className="text-xs mt-2"><span className="font-semibold">Competitors shown:</span> {res.competitors_mentioned.join(", ")}</p>}
              </Card>
            ))}
          </div>

          {r.recommendations?.length > 0 && (
            <Card className="p-6 rounded-xl border-border/60 mt-4">
              <h3 className="font-head font-bold mb-3">How to improve visibility</h3>
              <ul className="space-y-2">{r.recommendations.map((x, i) => <li key={i} className="text-sm flex gap-2"><Sparkles size={15} className="text-[#18C090] mt-0.5 shrink-0" />{x}</li>)}</ul>
            </Card>
          )}
        </div>
      )}

      <h3 className="font-head text-xl font-bold mb-4">Past scans</h3>
      {past.length === 0 ? <EmptyState icon={Activity} text="No visibility scans yet." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {past.map((p) => (
            <button key={p.id} onClick={() => { setJobResult(JOB_KEY, p); setResult(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} data-testid={`vis-past-${p.id}`}
              className="text-left bg-white border border-border/60 rounded-xl p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg">
              <div className="flex items-center justify-between"><span className="font-head font-bold truncate">{p.brand}</span><span className="font-head text-2xl font-extrabold" style={{ color: scoreColor(p.visibility_score) }}>{p.visibility_score}</span></div>
              <p className="text-xs text-muted-foreground mt-2">{p.results?.length || 0} prompts · {new Date(p.created_at).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
