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
import { PageHeader, EmptyState, ScorePill } from "@/components/ui-bits";
import { ShieldCheck, Loader2, Sparkles, Globe, Building2, Star, AlertTriangle, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const JOB_KEY = "brand";

const GROUPS = [
  { key: "social", label: "Social Media", icon: Globe },
  { key: "directories", label: "Startup Directories", icon: Building2 },
  { key: "reviews", label: "Review Sites", icon: Star },
];

const sevColor = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-gray-100 text-gray-600 border-gray-200",
};

function favicon(url, platform) {
  let dom = "";
  try {
    if (url) dom = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
  } catch (e) { dom = ""; }
  if (!dom) {
    const map = { LinkedIn: "linkedin.com", Facebook: "facebook.com", Instagram: "instagram.com", "X (Twitter)": "twitter.com", X: "twitter.com", Twitter: "twitter.com", Crunchbase: "crunchbase.com", Wellfound: "wellfound.com", AngelList: "angel.co", G2: "g2.com", Capterra: "capterra.com", Clutch: "clutch.co", Trustpilot: "trustpilot.com", "Product Hunt": "producthunt.com" };
    dom = map[platform] || "";
  }
  return dom ? `https://www.google.com/s2/favicons?domain=${dom}&sz=64` : null;
}

function PlatformCard({ p }) {
  const logo = favicon(p.url, p.platform);
  return (
    <Card className="p-5 rounded-xl border-border/60">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {logo ? <img src={logo} alt="" className="w-6 h-6 rounded" onError={(e) => { e.target.style.display = "none"; }} /> : null}
          <div className="min-w-0">
            <div className="font-head font-bold text-sm truncate">{p.platform}</div>
            {p.name ? <div className="text-xs text-muted-foreground truncate">{p.name}</div> : null}
          </div>
        </div>
        {p.status === "found" ? (
          <Badge className="rounded-md border bg-green-100 text-green-700 border-green-200 shrink-0"><CheckCircle2 size={12} className="mr-1" />Found</Badge>
        ) : p.status === "uncertain" ? (
          <Badge className="rounded-md border bg-amber-100 text-amber-700 border-amber-200 shrink-0">Uncertain</Badge>
        ) : (
          <Badge className="rounded-md border bg-gray-100 text-gray-500 border-gray-200 shrink-0"><XCircle size={12} className="mr-1" />Not found</Badge>
        )}
      </div>
      {p.present && (
        <div className="mt-3 space-y-2">
          {p.description ? <p className="text-xs text-foreground/80">{p.description}</p> : null}
          {Array.isArray(p.features) && p.features.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.features.slice(0, 8).map((f, i) => <Badge key={i} variant="secondary" className="rounded-md text-[11px] font-normal">{f}</Badge>)}
            </div>
          )}
          {p.pricing ? <p className="text-xs"><span className="font-semibold">Pricing:</span> {p.pricing}</p> : null}
          {p.note ? <p className="text-[11px] text-muted-foreground italic">{p.note}</p> : null}
          {Array.isArray(p.links) && p.links.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-border/40 mt-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold pt-1">Live links</div>
              {p.links.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noreferrer" className="text-[11px] text-[#18C090] font-medium flex items-center gap-1 hover:underline">
                  <ExternalLink size={11} className="shrink-0" /> <span className="truncate">{l.url}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function BrandConsistency() {
  const [query, setQuery] = useSessionState("brand:query", "");
  const initial = getJobState(JOB_KEY);
  const [status, setStatus] = useState(initial.status || "idle");
  const [result, setResult] = useState(initial.result || null);
  const [past, setPast] = useState([]);
  const loading = status === "running";

  const load = () => http.get("/brand").then((r) => setPast(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const unsub = subscribeJob(JOB_KEY, (snap) => {
      setStatus(snap.status || "idle");
      if (snap.status === "done" && snap.result) { setResult(snap.result); load(); }
      else if (snap.status === "error") {
        toast.error(formatApiErrorDetail(snap.error?.response?.data?.detail) || "Brand check failed");
      }
    });
    return () => { unsub(); };
  }, []);

  const run = async () => {
    if (!query.trim()) { toast.error("Enter a brand name or domain"); return; }
    try {
      await startSingleShotJob({ key: JOB_KEY, postPath: "/brand", postBody: { query } });
      toast.success("Brand consistency analysed");
    } catch { /* surfaced via subscription */ }
  };

  const r = result;
  const byGroup = (g) => (r?.platforms || []).filter((p) => (p.group || "").toLowerCase() === g);

  return (
    <div>
      <PageHeader overline="Generative Engine (GEO)" title="Brand Consistency Checker" subtitle="Check how consistently your brand appears across social, startup directories and review sites so AI engines describe you the same way everywhere." />

      <Card className="p-4 rounded-xl border-border/60 mb-5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <ShieldCheck size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="Brand name or domain — e.g. Notion or notion.so" className="pl-9" data-testid="brand-query-input" />
          </div>
          <Button onClick={run} disabled={loading} className="btn-brand hover:opacity-90 shrink-0" data-testid="run-brand-btn">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Check</>}
          </Button>
        </div>
      </Card>

      {loading && !r && (
        <Card className="p-10 rounded-xl border-border/60 mb-8 grid place-items-center text-center">
          <Loader2 className="animate-spin text-[#18C090] mb-3" />
          <p className="text-sm text-muted-foreground">Scanning platforms and comparing brand info…</p>
        </Card>
      )}

      {r && (
        <div className="mb-10 space-y-6" data-testid="brand-result">
          <Card className="p-6 rounded-xl border-border/60">
            <div className="flex flex-wrap items-center gap-5">
              <div className="flex items-center gap-4">
                <ScorePill score={r.consistency_score} size="lg" />
                <div>
                  <div className="font-head text-xl font-bold">{r.canonical?.name || r.brand}</div>
                  <div className="text-xs text-muted-foreground">{r.canonical?.category}</div>
                </div>
              </div>
              <div className="flex-1 min-w-[240px] text-sm text-foreground/80">{r.canonical?.description}</div>
            </div>
          </Card>

          {Array.isArray(r.inconsistencies) && r.inconsistencies.length > 0 && (
            <Card className="p-6 rounded-xl border-border/60">
              <h3 className="font-head font-bold mb-4 flex items-center gap-2"><AlertTriangle size={18} className="text-amber-500" /> Inconsistencies detected</h3>
              <div className="space-y-3">
                {r.inconsistencies.map((inc, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Badge className={`rounded-md border capitalize shrink-0 ${sevColor[inc.severity] || sevColor.low}`}>{inc.severity}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm"><span className="font-semibold capitalize">{inc.field}:</span> {inc.detail}</p>
                      {Array.isArray(inc.platforms) && inc.platforms.length > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{inc.platforms.join(" · ")}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {GROUPS.map((g) => {
            const items = byGroup(g.key);
            if (items.length === 0) return null;
            return (
              <div key={g.key}>
                <h3 className="font-head font-bold mb-3 flex items-center gap-2"><g.icon size={18} className="text-[#18C090]" /> {g.label}</h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map((p, i) => <PlatformCard key={i} p={p} />)}
                </div>
              </div>
            );
          })}

          {Array.isArray(r.recommendations) && r.recommendations.length > 0 && (
            <Card className="p-6 rounded-xl border-border/60">
              <h3 className="font-head font-bold mb-3">Recommendations</h3>
              <ul className="space-y-2">{r.recommendations.map((x, i) => <li key={i} className="text-sm flex gap-2"><Sparkles size={15} className="text-[#18C090] mt-0.5 shrink-0" />{x}</li>)}</ul>
            </Card>
          )}
        </div>
      )}

      <h3 className="font-head text-xl font-bold mb-4">Past checks</h3>
      {past.length === 0 ? <EmptyState icon={ShieldCheck} text="No brand checks yet." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {past.map((p) => (
            <button key={p.id} onClick={() => { setJobResult(JOB_KEY, p); setResult(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} data-testid={`brand-past-${p.id}`}
              className="text-left bg-white border border-border/60 rounded-xl p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg">
              <div className="flex items-center justify-between gap-2">
                <p className="font-head font-bold truncate">{p.brand}</p>
                <ScorePill score={p.consistency_score} size="sm" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">{p.platforms?.length || 0} platforms · {new Date(p.created_at).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
