import { useEffect, useState } from "react";
import { http, formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { ScoreGauge, scoreColor } from "@/components/ScoreGauge";
import { Globe, Loader2, Sparkles, Zap, Users } from "lucide-react";
import { toast } from "sonner";

const priColor = { high: "bg-red-100 text-red-700 border-red-200", medium: "bg-amber-100 text-amber-700 border-amber-200", low: "bg-gray-100 text-gray-600 border-gray-200" };

function Bar({ score, label, note }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1"><span className="font-medium">{label}</span><span className="font-head font-bold" style={{ color: scoreColor(score) }}>{score}</span></div>
      <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${score}%`, background: scoreColor(score) }} /></div>
      {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
    </div>
  );
}

export default function DomainAnalysis() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [past, setPast] = useState([]);

  const load = () => http.get("/domain").then((r) => setPast(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const run = async () => {
    if (!domain.trim()) { toast.error("Enter a domain"); return; }
    setLoading(true);
    try { const { data } = await http.post("/domain/analyze", { domain }); setResult(data); load(); toast.success("Domain analyzed"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setLoading(false); }
  };

  const r = result;
  return (
    <div>
      <PageHeader overline="Overview" title="Domain Analysis" subtitle="Enter a domain to get an AI-readiness report — authority, content depth, citation-worthiness and quick wins." />

      <Card className="p-6 rounded-xl border-border/60 mb-8">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="example.com" className="pl-9" data-testid="domain-input" />
          </div>
          <Button onClick={run} disabled={loading} className="bg-black text-white hover:bg-gray-800 shrink-0" data-testid="analyze-domain-btn">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Analyze</>}
          </Button>
        </div>
      </Card>

      {r && (
        <div className="grid lg:grid-cols-12 gap-6 mb-10" data-testid="domain-result">
          <Card className="lg:col-span-4 p-8 rounded-xl border-border/60 flex flex-col items-center justify-center text-center">
            <ScoreGauge score={r.ai_readiness_score} label="AI READINESS" />
            <h2 className="font-head text-xl font-bold mt-5">{r.domain}</h2>
            <p className="text-sm text-muted-foreground mt-2">{r.brand_summary}</p>
            <Badge className={`mt-3 rounded-md border ${r.known_by_ai ? "bg-green-100 text-green-700 border-green-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>
              {r.known_by_ai ? "Recognized by AI engines" : "Low AI recognition"}
            </Badge>
          </Card>

          <Card className="lg:col-span-8 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-4">Breakdown</h3>
            <div className="space-y-4">{(r.categories || []).map((c, i) => <Bar key={i} {...c} />)}</div>
          </Card>

          <Card className="lg:col-span-7 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-4 flex items-center gap-2"><Zap size={18} className="text-[#002FA7]" /> Quick wins</h3>
            <div className="space-y-2">
              {(r.quick_wins || []).map((q, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <Badge className={`${priColor[q.priority] || priColor.low} border rounded-md capitalize shrink-0`}>{q.priority}</Badge>
                  <span className="text-sm">{q.action}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="lg:col-span-5 p-6 rounded-xl border-border/60">
            <h3 className="font-head font-bold mb-3">Top topics</h3>
            <div className="flex flex-wrap gap-2 mb-5">{(r.top_topics || []).map((t, i) => <Badge key={i} variant="secondary" className="rounded-md">{t}</Badge>)}</div>
            <h3 className="font-head font-bold mb-3 flex items-center gap-2"><Users size={16} /> Competitors</h3>
            <div className="flex flex-wrap gap-2">{(r.competitors || []).map((t, i) => <Badge key={i} variant="outline" className="rounded-md">{t}</Badge>)}</div>
          </Card>
        </div>
      )}

      <h3 className="font-head text-xl font-bold mb-4">Past domain reports</h3>
      {past.length === 0 ? <EmptyState icon={Globe} text="No domain reports yet." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {past.map((p) => (
            <button key={p.id} onClick={() => { setResult(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} data-testid={`domain-past-${p.id}`}
              className="text-left bg-white border border-border/60 rounded-xl p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg">
              <div className="flex items-center justify-between">
                <span className="font-head font-bold truncate">{p.domain}</span>
                <span className="font-head text-2xl font-extrabold" style={{ color: scoreColor(p.ai_readiness_score) }}>{p.ai_readiness_score}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{new Date(p.created_at).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
