import { useEffect, useState } from "react";
import { http, formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { scoreColor } from "@/components/ScoreGauge";
import { Link2, Loader2, Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

const typeColor = { official: "bg-blue-50 text-blue-700", editorial: "bg-purple-50 text-purple-700", community: "bg-orange-50 text-orange-700", reference: "bg-green-50 text-green-700", competitor: "bg-red-50 text-red-700" };

export default function Citations() {
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [past, setPast] = useState([]);

  const load = () => http.get("/citations").then((r) => setPast(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const run = async () => {
    if (!query.trim()) { toast.error("Enter a query"); return; }
    setLoading(true);
    try { const { data } = await http.post("/citations", { query, domain: domain || null }); setResult(data); load(); toast.success("Citation sources predicted"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setLoading(false); }
  };

  const r = result;
  return (
    <div>
      <PageHeader overline="Generative Engine (GEO)" title="Citation Sources" subtitle="For any query, see which domains an AI engine would most likely cite — and whether yours makes the cut." />

      <Card className="p-6 rounded-xl border-border/60 mb-8 grid gap-4">
        <div><label className="text-xs uppercase font-bold text-muted-foreground">Query</label><Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder='e.g. "best crm for startups"' className="mt-1.5" data-testid="citation-query-input" /></div>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1"><label className="text-xs uppercase font-bold text-muted-foreground">Your domain (optional)</label><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourdomain.com" className="mt-1.5" data-testid="citation-domain-input" /></div>
          <Button onClick={run} disabled={loading} className="bg-black text-white hover:bg-gray-800" data-testid="run-citations-btn">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Predict sources</>}
          </Button>
        </div>
      </Card>

      {r && (
        <div className="mb-10" data-testid="citations-result">
          {r.user_domain && (
            <Card className={`p-5 rounded-xl border mb-6 flex items-center gap-3 ${r.user_domain_cited ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
              {r.user_domain_cited ? <CheckCircle2 className="text-green-600" /> : <XCircle className="text-red-600" />}
              <div>
                <p className="font-head font-bold">{r.user_domain_cited ? `${r.user_domain} would likely be cited` : `${r.user_domain} is not likely cited`}</p>
                <p className="text-sm text-muted-foreground">{r.user_domain_cited ? `Estimated rank #${r.user_domain_rank}` : r.recommendation}</p>
              </div>
            </Card>
          )}
          <div className="space-y-2">
            {(r.sources || []).map((s, i) => (
              <Card key={i} className="p-4 rounded-xl border-border/60 flex items-center gap-4">
                <span className="font-head font-extrabold text-lg text-muted-foreground w-6 text-center">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="font-head font-bold truncate">{s.domain}</span><Badge className={`rounded-md capitalize border-0 ${typeColor[s.type] || "bg-muted"}`}>{s.type}</Badge></div>
                  <p className="text-xs text-muted-foreground truncate">{s.title} — {s.why}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-head font-bold" style={{ color: scoreColor(s.likelihood) }}>{s.likelihood}%</div>
                  <div className="text-[10px] uppercase text-muted-foreground">likely</div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <h3 className="font-head text-xl font-bold mb-4">Past lookups</h3>
      {past.length === 0 ? <EmptyState icon={Link2} text="No citation lookups yet." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {past.map((p) => (
            <button key={p.id} onClick={() => { setResult(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} data-testid={`cite-past-${p.id}`}
              className="text-left bg-white border border-border/60 rounded-xl p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg">
              <p className="font-head font-bold truncate">"{p.query}"</p>
              <p className="text-xs text-muted-foreground mt-2">{p.sources?.length || 0} sources · {new Date(p.created_at).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
