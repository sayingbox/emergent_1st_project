import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { http, formatApiErrorDetail } from "@/lib/api";
import { ScoreGauge, scoreColor } from "@/components/ScoreGauge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Check, X, Copy, Download, Sparkles, Loader2, Quote, HelpCircle, ChevronRight } from "lucide-react";

const priColor = { high: "bg-red-100 text-red-700 border-red-200", medium: "bg-amber-100 text-amber-700 border-amber-200", low: "bg-gray-100 text-gray-600 border-gray-200" };

function Bar({ score }) {
  return (
    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, background: scoreColor(score) }} />
    </div>
  );
}

export default function AnalysisDetail() {
  const { id } = useParams();
  const [a, setA] = useState(null);
  const [simQuery, setSimQuery] = useState("");
  const [simLoading, setSimLoading] = useState(false);
  const [gapLoading, setGapLoading] = useState(false);

  const load = async () => {
    try { const { data } = await http.get(`/analyses/${id}`); setA(data); setSimQuery(data.target_query || ""); }
    catch { toast.error("Could not load analysis"); }
  };
  useEffect(() => { load(); }, [id]);

  const copyJson = () => { navigator.clipboard.writeText(JSON.stringify(a.jsonld, null, 2)); toast.success("JSON-LD copied"); };
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(a.jsonld, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "schema.json"; link.click(); URL.revokeObjectURL(url);
    toast.success("Downloaded schema.json");
  };

  const runSim = async () => {
    if (!simQuery.trim()) { toast.error("Enter a target query"); return; }
    setSimLoading(true);
    try { const { data } = await http.post(`/analyses/${id}/simulate`, { query: simQuery }); setA((p) => ({ ...p, simulations: [...(p.simulations || []), data] })); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setSimLoading(false); }
  };

  const runGaps = async () => {
    setGapLoading(true);
    try { const { data } = await http.post(`/analyses/${id}/gaps`); setA((p) => ({ ...p, question_gaps: data.gaps })); toast.success("Question gaps generated"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setGapLoading(false); }
  };

  if (!a) return <div className="py-20 text-center text-muted-foreground"><Loader2 className="animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-8">
      <Link to="/app/optimizer" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-black" data-testid="back-link"><ArrowLeft size={16} /> Back</Link>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Score + meta */}
        <Card className="lg:col-span-4 p-8 rounded-lg border-border/60 flex flex-col items-center justify-center">
          <ScoreGauge score={a.overall_score} />
          <h1 className="font-head text-xl font-bold text-center mt-6 line-clamp-2">{a.title}</h1>
          <p className="text-xs text-muted-foreground text-center mt-1 truncate max-w-full">{a.source_url || "Pasted content"}</p>
          <div className="flex gap-4 mt-4 text-center">
            <div><div className="font-head font-bold text-lg">{a.word_count}</div><div className="text-[10px] uppercase text-muted-foreground">words</div></div>
            <div><div className="font-head font-bold text-lg">{a.dimensions?.length || 0}</div><div className="text-[10px] uppercase text-muted-foreground">dimensions</div></div>
            <div><div className="font-head font-bold text-lg">{a.recommendations?.length || 0}</div><div className="text-[10px] uppercase text-muted-foreground">fixes</div></div>
          </div>
        </Card>

        {/* Direct answer */}
        <Card className="lg:col-span-8 p-8 rounded-lg border-border/60">
          <div className="flex items-center gap-2 mb-3"><Quote size={16} className="text-[#002FA7]" /><span className="text-xs tracking-[0.2em] uppercase font-bold text-muted-foreground">Suggested direct answer</span></div>
          <p className="font-head text-2xl font-bold leading-snug" data-testid="summary-answer">{a.summary_answer}</p>
          <p className="text-sm text-muted-foreground mt-4">Place a 40–60 word direct answer like this immediately after your H1 so engines can quote it verbatim.</p>
        </Card>
      </div>

      <Tabs defaultValue="scores">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="scores" data-testid="tab-scores">Scores</TabsTrigger>
          <TabsTrigger value="fixes" data-testid="tab-fixes">Recommendations</TabsTrigger>
          <TabsTrigger value="schema" data-testid="tab-schema">Schema</TabsTrigger>
          <TabsTrigger value="simulator" data-testid="tab-simulator">AI Simulator</TabsTrigger>
          <TabsTrigger value="gaps" data-testid="tab-gaps">Question Gaps</TabsTrigger>
        </TabsList>

        {/* SCORES */}
        <TabsContent value="scores" className="mt-6">
          <div className="grid sm:grid-cols-2 gap-4" data-testid="dimensions-grid">
            {(a.dimensions || []).map((d) => (
              <Card key={d.key} className="p-5 rounded-lg border-border/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-head font-bold">{d.label}</span>
                  <span className="font-head font-extrabold tabular-nums" style={{ color: scoreColor(d.score) }}>{d.score}</span>
                </div>
                <Bar score={d.score} />
                <p className="text-sm text-muted-foreground mt-3">{d.summary}</p>
                <Accordion type="single" collapsible className="mt-2">
                  <AccordionItem value="sc" className="border-none">
                    <AccordionTrigger className="py-2 text-xs uppercase tracking-wide font-bold text-muted-foreground hover:no-underline">Sub-checks</AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-2">
                        {(d.sub_checks || []).map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            {s.passed ? <Check size={16} className="text-green-600 mt-0.5 shrink-0" /> : <X size={16} className="text-red-600 mt-0.5 shrink-0" />}
                            <span><span className="font-medium">{s.label}.</span> <span className="text-muted-foreground">{s.detail}</span></span>
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* FIXES */}
        <TabsContent value="fixes" className="mt-6">
          <div className="space-y-3" data-testid="recommendations-list">
            {(a.recommendations || []).map((r, i) => (
              <Card key={i} className="p-5 rounded-lg border-border/60 flex items-start gap-4">
                <ChevronRight size={18} className="mt-0.5 text-[#002FA7] shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={`${priColor[r.priority] || priColor.low} border rounded-md capitalize`}>{r.priority}</Badge>
                    <span className="text-xs uppercase tracking-wide font-bold text-muted-foreground">{r.dimension}</span>
                  </div>
                  <p className="text-sm">{r.fix}</p>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* SCHEMA */}
        <TabsContent value="schema" className="mt-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {(a.detected_schema_types || []).map((t) => <Badge key={t} variant="secondary" className="rounded-md">{t}</Badge>)}
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={copyJson} data-testid="copy-json-btn"><Copy size={14} className="mr-2" /> Copy</Button>
            <Button size="sm" className="bg-black text-white hover:bg-gray-800" onClick={downloadJson} data-testid="download-json-btn"><Download size={14} className="mr-2" /> Download</Button>
          </div>
          <pre className="bg-[#0b0b0f] text-[#d4d4d8] rounded-lg p-5 overflow-auto text-xs leading-relaxed max-h-[520px] font-mono" data-testid="jsonld-viewer">
{JSON.stringify(a.jsonld, null, 2)}
          </pre>
        </TabsContent>

        {/* SIMULATOR */}
        <TabsContent value="simulator" className="mt-6 space-y-4">
          <Card className="p-6 rounded-lg border-border/60">
            <p className="text-sm text-muted-foreground mb-3">Simulate how a generative engine would answer a query using this page.</p>
            <div className="flex gap-2">
              <Input value={simQuery} onChange={(e) => setSimQuery(e.target.value)} placeholder="Enter a target query…" data-testid="sim-query-input" />
              <Button onClick={runSim} disabled={simLoading} className="bg-black text-white hover:bg-gray-800 shrink-0" data-testid="simulate-btn">
                {simLoading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} className="mr-2" /> Simulate</>}
              </Button>
            </div>
          </Card>
          {(a.simulations || []).slice().reverse().map((s, i) => (
            <Card key={i} className="p-6 rounded-lg border-border/60" data-testid="sim-result">
              <div className="flex items-center justify-between mb-3">
                <span className="font-head font-bold">"{s.query}"</span>
                <Badge className={`rounded-md border ${s.would_cite ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                  {s.would_cite ? `Would cite · ${s.confidence}%` : `Unlikely · ${s.confidence}%`}
                </Badge>
              </div>
              <p className="text-sm leading-relaxed">{s.simulated_answer}</p>
              {s.cited_snippets?.length > 0 && (
                <div className="mt-4 border-l-2 border-[#002FA7] pl-3 space-y-1">
                  {s.cited_snippets.map((c, j) => <p key={j} className="text-xs text-muted-foreground italic">"{c}"</p>)}
                </div>
              )}
              {s.missing_for_citation && <p className="text-xs text-amber-700 mt-3"><strong>To improve citation:</strong> {s.missing_for_citation}</p>}
            </Card>
          ))}
        </TabsContent>

        {/* GAPS */}
        <TabsContent value="gaps" className="mt-6 space-y-4">
          <Button onClick={runGaps} disabled={gapLoading} className="bg-black text-white hover:bg-gray-800" data-testid="find-gaps-btn">
            {gapLoading ? <><Loader2 size={16} className="mr-2 animate-spin" /> Finding gaps…</> : <><HelpCircle size={16} className="mr-2" /> Find question gaps</>}
          </Button>
          <div className="space-y-2" data-testid="gaps-list">
            {(a.question_gaps || []).map((g, i) => (
              <Card key={i} className="p-4 rounded-lg border-border/60 flex items-start gap-3">
                {g.covered ? <Check size={18} className="text-green-600 mt-0.5 shrink-0" /> : <X size={18} className="text-red-600 mt-0.5 shrink-0" />}
                <div className="flex-1">
                  <p className="font-medium text-sm">{g.question}</p>
                  <p className="text-xs text-muted-foreground mt-1">{g.why}</p>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant="secondary" className="rounded-md capitalize">{g.volume} vol</Badge>
                  <div className="text-xs text-muted-foreground mt-1">rel {g.relevance}</div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
