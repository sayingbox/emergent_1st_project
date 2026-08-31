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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { scoreColor } from "@/components/ScoreGauge";
import { Link2, Loader2, Sparkles, CheckCircle2, XCircle, Globe, Search, ShieldCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const typeColor = {
  official: "bg-blue-50 text-blue-700",
  editorial: "bg-purple-50 text-purple-700",
  community: "bg-orange-50 text-orange-700",
  reference: "bg-green-50 text-green-700",
  competitor: "bg-red-50 text-red-700",
  encyclopedia: "bg-blue-50 text-blue-700",
  review: "bg-purple-50 text-purple-700",
  news: "bg-orange-50 text-orange-700",
  directory: "bg-green-50 text-green-700",
  social: "bg-sky-50 text-sky-700",
  video: "bg-red-50 text-red-700",
  forum: "bg-amber-50 text-amber-700",
  documentation: "bg-slate-100 text-slate-700",
};
const JOB_KEY = "citations";

function SourceRow({ s, i }) {
  return (
    <Card className="p-4 rounded-xl border-border/60 flex items-center gap-4">
      <span className="font-head font-extrabold text-lg text-muted-foreground w-6 text-center">{i + 1}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-head font-bold truncate">{s.domain || s.source}</span>
          {s.type && <Badge className={`rounded-md capitalize border-0 ${typeColor[s.type] || "bg-muted"}`}>{s.type}</Badge>}
          {s.verified && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-green-700 bg-green-50 border border-green-200 rounded-md px-1.5 py-0.5">
              <ShieldCheck size={11} /> Verified live
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {s.title ? `${s.title}` : ""}{s.title && s.why ? " — " : ""}{s.why || ""}
        </p>
        {s.url && (
          <a href={s.url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1 mt-1">
            <ExternalLink size={11} /> <span className="truncate">{s.url}</span>
          </a>
        )}
      </div>
      {typeof s.likelihood === "number" && (
        <div className="text-right shrink-0">
          <div className="font-head font-bold" style={{ color: scoreColor(s.likelihood) }}>{s.likelihood}%</div>
          <div className="text-[10px] uppercase text-muted-foreground">likely</div>
        </div>
      )}
      {typeof s.authority === "number" && typeof s.likelihood !== "number" && (
        <div className="text-right shrink-0">
          <div className="font-head font-bold" style={{ color: scoreColor(s.authority) }}>{s.authority}</div>
          <div className="text-[10px] uppercase text-muted-foreground">authority</div>
        </div>
      )}
    </Card>
  );
}

function ResultBlock({ r }) {
  if (!r) return null;
  const isDomain = r.search_kind === "domain";
  return (
    <div className="mb-10" data-testid="citations-result">
      {!isDomain && r.user_domain && (
        <Card className={`p-5 rounded-xl border mb-6 flex items-center gap-3 ${r.user_domain_cited ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
          {r.user_domain_cited ? <CheckCircle2 className="text-green-600" /> : <XCircle className="text-red-600" />}
          <div>
            <p className="font-head font-bold">
              {r.user_domain_cited ? `${r.user_domain} would likely be cited` : `${r.user_domain} is not likely cited`}
            </p>
            <p className="text-sm text-muted-foreground">
              {r.user_domain_cited ? `Estimated rank #${r.user_domain_rank}` : r.recommendation}
            </p>
          </div>
        </Card>
      )}
      {isDomain && (
        <Card className="p-5 rounded-xl border mb-6 flex items-center gap-3 border-slate-200 bg-slate-50">
          <Globe className="text-slate-600" />
          <div>
            <p className="font-head font-bold">
              {r.sources?.length
                ? `${r.sources.length} verified citation source${r.sources.length === 1 ? "" : "s"} for ${r.user_domain}`
                : `No verified citations found for ${r.user_domain}`}
            </p>
            {r.recommendation && <p className="text-sm text-muted-foreground">{r.recommendation}</p>}
          </div>
        </Card>
      )}
      <div className="space-y-2">
        {(r.sources || []).map((s, i) => <SourceRow key={i} s={s} i={i} />)}
      </div>
    </div>
  );
}

export default function Citations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useSessionState("citations:tab", "query");
  const [query, setQuery] = useSessionState("citations:query", "");
  const [queryDomain, setQueryDomain] = useSessionState("citations:queryDomain", "");
  const [domain, setDomain] = useSessionState("citations:domain", "");
  const initial = getJobState(JOB_KEY);
  const [status, setStatus] = useState(initial.status || "idle");
  const [result, setResult] = useState(initial.result || null);
  const [past, setPast] = useState([]);
  const loading = status === "running";

  const load = () => http.get("/citations").then((r) => setPast(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const unsub = subscribeJob(JOB_KEY, (snap) => {
      setStatus(snap.status || "idle");
      if (snap.status === "done" && snap.result) { setResult(snap.result); load(); }
      else if (snap.status === "error") {
        toast.error(formatApiErrorDetail(snap.error?.response?.data?.detail) || "Citation lookup failed");
      }
    });
    const qDomain = searchParams.get("domain");
    const qQuery = searchParams.get("query");
    if (qDomain) { setDomain(qDomain); setTab("domain"); }
    if (qQuery) { setQuery(qQuery); setTab("query"); }
    if (qDomain || qQuery) setSearchParams({}, { replace: true });
    return () => { unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runQuery = async () => {
    if (!query.trim()) { toast.error("Enter a query"); return; }
    try {
      await startSingleShotJob({ key: JOB_KEY, postPath: "/citations", postBody: { query, domain: queryDomain || null } });
      toast.success("Verified citation sources loaded");
    } catch { /* handled in subscription */ }
  };

  const runDomain = async () => {
    if (!domain.trim()) { toast.error("Enter a domain"); return; }
    try {
      await startSingleShotJob({ key: JOB_KEY, postPath: "/citations/by-domain", postBody: { domain } });
      toast.success("Verified citation sources loaded");
    } catch { /* handled in subscription */ }
  };

  return (
    <div>
      <PageHeader
        overline="Generative Engine (GEO)"
        title="Citation Sources"
        subtitle="Every source shown is a real, HTTP-verified live URL — nothing invented, nothing dead. Search by an AI query or by any domain."
      />

      <Tabs value={tab} onValueChange={setTab} className="mb-6">
        <TabsList data-testid="citations-tabs">
          <TabsTrigger value="query" data-testid="citations-tab-query"><Search size={14} className="mr-2" />By Query</TabsTrigger>
          <TabsTrigger value="domain" data-testid="citations-tab-domain"><Globe size={14} className="mr-2" />By Domain</TabsTrigger>
        </TabsList>

        <TabsContent value="query">
          <Card className="p-4 rounded-xl border-border/60 mt-4 grid gap-4">
            <div>
              <label className="text-xs uppercase font-bold text-muted-foreground">Query</label>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runQuery()} placeholder='e.g. "best crm for startups"' className="mt-1.5" data-testid="citation-query-input" />
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <label className="text-xs uppercase font-bold text-muted-foreground">Your domain (optional)</label>
                <Input value={queryDomain} onChange={(e) => setQueryDomain(e.target.value)} placeholder="yourdomain.com" className="mt-1.5" data-testid="citation-query-domain-input" />
              </div>
              <Button onClick={runQuery} disabled={loading} className="btn-brand hover:opacity-90" data-testid="run-citations-btn">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Find verified sources</>}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Uses real web search + live-link verification. Sources with dead URLs are dropped automatically.</p>
          </Card>
        </TabsContent>

        <TabsContent value="domain">
          <Card className="p-4 rounded-xl border-border/60 mt-4 grid gap-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <label className="text-xs uppercase font-bold text-muted-foreground">Domain</label>
                <Input value={domain} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runDomain()} placeholder="yourdomain.com" className="mt-1.5" data-testid="citation-domain-input" />
              </div>
              <Button onClick={runDomain} disabled={loading} className="btn-brand hover:opacity-90" data-testid="run-citations-domain-btn">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Find citations for domain</>}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Discovers every third-party page that already mentions this domain, then HTTP-verifies each link is live before showing it.</p>
          </Card>
        </TabsContent>
      </Tabs>

      <ResultBlock r={result} />

      <h3 className="font-head text-xl font-bold mb-4">Past lookups</h3>
      {past.length === 0 ? <EmptyState icon={Link2} text="No citation lookups yet." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {past.map((p) => (
            <button
              key={p.id}
              onClick={() => { setJobResult(JOB_KEY, p); setResult(p); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              data-testid={`cite-past-${p.id}`}
              className="text-left bg-white border border-border/60 rounded-xl p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="flex items-center gap-2 mb-2">
                <Badge className="rounded-md border-0 bg-slate-100 text-slate-700 capitalize">
                  {p.search_kind === "domain" ? "domain" : "query"}
                </Badge>
              </div>
              <p className="font-head font-bold truncate">
                {p.search_kind === "domain" ? p.domain : `"${p.query}"`}
              </p>
              <p className="text-xs text-muted-foreground mt-2">{p.sources?.length || 0} sources · {new Date(p.created_at).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
