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
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { scoreColor } from "@/components/ScoreGauge";
import {
  Activity, Loader2, Sparkles, Check, X, Plus, Trash2, Wand2,
  ExternalLink, ShieldCheck, Link2,
} from "lucide-react";
import { toast } from "sonner";
import { enrichWithPuterEngines } from "@/lib/puterEngines";

const engineMeta = {
  chatgpt:    { label: "ChatGPT",             domain: "openai.com" },
  claude:     { label: "Claude",              domain: "claude.ai" },
  perplexity: { label: "Perplexity",          domain: "perplexity.ai" },
  gemini:     { label: "Gemini",              domain: "gemini.google.com" },
  google_ai:  { label: "Google AI Overviews", domain: "google.com" },
  copilot:    { label: "Copilot",             domain: "copilot.microsoft.com" },
  grok:       { label: "Grok",                domain: "x.ai" },
};
const ENGINE_ORDER = ["chatgpt", "claude", "perplexity", "gemini", "google_ai", "copilot", "grok"];
const engFav = (d) => `https://www.google.com/s2/favicons?domain=${d}&sz=64`;

const posColor = {
  top:         "bg-green-100 text-green-700 border-green-200",
  recommended: "bg-emerald-100 text-emerald-700 border-emerald-200",
  passing:     "bg-amber-100 text-amber-700 border-amber-200",
  none:        "bg-red-100 text-red-700 border-red-200",
};
const typeColor = {
  official: "bg-blue-50 text-blue-700",
  editorial: "bg-purple-50 text-purple-700",
  community: "bg-orange-50 text-orange-700",
  reference: "bg-green-50 text-green-700",
  encyclopedia: "bg-blue-50 text-blue-700",
  review: "bg-purple-50 text-purple-700",
  news: "bg-orange-50 text-orange-700",
  directory: "bg-green-50 text-green-700",
  social: "bg-sky-50 text-sky-700",
  video: "bg-red-50 text-red-700",
  forum: "bg-amber-50 text-amber-700",
  documentation: "bg-slate-100 text-slate-700",
};

const JOB_KEY = "visibility";

function EngineChip({ engine, present }) {
  const meta = engineMeta[engine] || { label: engine, domain: "" };
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border transition-colors " +
        (present
          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
          : "bg-muted/50 border-border/60 text-muted-foreground")
      }
      title={present ? `Ranks on ${meta.label}` : `Not ranking on ${meta.label}`}
      data-testid={`engine-chip-${engine}`}
    >
      <img
        src={engFav(meta.domain)}
        alt=""
        className={"w-3.5 h-3.5 rounded-sm " + (present ? "" : "opacity-50 grayscale")}
        onError={(ev) => { ev.target.style.display = "none"; }}
      />
      <span className="font-medium">{meta.label}</span>
      {present ? <Check size={12} className="text-emerald-600" /> : <X size={12} className="text-muted-foreground" />}
    </span>
  );
}

function PromptRow({ value, onChange, onRemove, index }) {
  return (
    <div className="flex items-center gap-2 group">
      <span className="font-head font-bold text-sm text-muted-foreground w-6 text-center shrink-0">
        {index + 1}
      </span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. best crm for startups"
        className="text-sm"
        data-testid={`prompt-row-${index}`}
      />
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-red-600 shrink-0 transition-colors p-1"
        aria-label="Remove prompt"
        data-testid={`prompt-remove-${index}`}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function CitationCard({ s, i }) {
  return (
    <Card className="p-3.5 rounded-xl border-border/60 flex items-start gap-3">
      <span className="font-head font-extrabold text-sm text-muted-foreground w-5 text-center shrink-0">
        {i + 1}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-head font-bold text-sm truncate">
            {s.title || s.domain || s.source}
          </span>
          {s.type && (
            <Badge className={`rounded-md capitalize border-0 text-[10px] ${typeColor[s.type] || "bg-muted"}`}>
              {s.type}
            </Badge>
          )}
          {s.verified && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-green-700 bg-green-50 border border-green-200 rounded-md px-1.5 py-0.5">
              <ShieldCheck size={10} /> Live
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          <span className="font-medium text-foreground/70">{s.domain || s.source}</span>
          {s.why ? ` — ${s.why}` : ""}
        </p>
        {s.url && (
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1 mt-1"
          >
            <ExternalLink size={11} />
            <span className="truncate max-w-[420px]">{s.url}</span>
          </a>
        )}
        {Array.isArray(s.engines) && s.engines.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-2">
            <span className="text-[10px] text-muted-foreground mr-0.5">Picked up by:</span>
            {s.engines.map((e) => {
              const m = engineMeta[e] || { label: e, domain: "" };
              return (
                <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-[#6366F1]/10 text-[#6366F1] inline-flex items-center gap-1">
                  <img
                    src={engFav(m.domain)}
                    alt=""
                    className="w-3 h-3 rounded-sm"
                    onError={(ev) => { ev.target.style.display = "none"; }}
                  />
                  {m.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
      {typeof s.authority === "number" && (
        <div className="text-right shrink-0">
          <div className="font-head font-bold text-sm" style={{ color: scoreColor(s.authority) }}>
            {s.authority}
          </div>
          <div className="text-[9px] uppercase text-muted-foreground">authority</div>
        </div>
      )}
    </Card>
  );
}

export default function Visibility() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [brand, setBrand] = useSessionState("visibility:brand", "");
  const [domain, setDomain] = useSessionState("visibility:domain", "");
  const [rows, setRows] = useSessionState("visibility:rows", [""]);
  const [suggesting, setSuggesting] = useState(false);
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
        // Enrich citation sources with real Perplexity / Grok / ChatGPT / Claude via Puter.js (silent on failure).
        (async () => {
          try {
            const enriched = await enrichWithPuterEngines({
              query: snap.result.brand || snap.result.domain || "",
              brand: snap.result.brand || snap.result.domain || "",
              sources: snap.result.citation_sources || [],
            });
            setResult((prev) => (prev && prev.id === snap.result.id ? { ...prev, citation_sources: enriched } : prev));
          } catch { /* silent */ }
        })();
      } else if (snap.status === "error") {
        toast.error(formatApiErrorDetail(snap.error?.response?.data?.detail) || "Visibility scan failed");
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

  const setRow = (i, v) => setRows((prev) => prev.map((r, k) => (k === i ? v : r)));
  const addRow = () => setRows((prev) => [...prev, ""]);
  const removeRow = (i) => setRows((prev) => (prev.length === 1 ? [""] : prev.filter((_, k) => k !== i)));
  const clearAll = () => setRows([""]);

  const suggest = async () => {
    if (!brand.trim() && !domain.trim()) {
      toast.error("Enter a brand or domain first");
      return;
    }
    setSuggesting(true);
    try {
      const { data } = await http.post("/visibility/suggest-prompts", { brand, domain });
      const suggested = (data?.prompts || []).filter(Boolean);
      if (suggested.length === 0) {
        toast.error("No suggestions returned — please add prompts manually");
      } else {
        // Merge into existing non-empty prompts, de-duplicated
        const existing = rows.map((r) => r.trim()).filter(Boolean);
        const dedup = [];
        const seen = new Set();
        for (const p of [...existing, ...suggested]) {
          const k = p.toLowerCase();
          if (!seen.has(k)) { seen.add(k); dedup.push(p); }
        }
        setRows(dedup.slice(0, 12));
        toast.success(`Added ${suggested.length} suggested prompts`);
      }
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not fetch suggestions");
    } finally {
      setSuggesting(false);
    }
  };

  const run = async () => {
    const list = rows.map((p) => p.trim()).filter(Boolean);
    if (!brand.trim()) { toast.error("Enter a brand or domain"); return; }
    if (list.length === 0) { toast.error("Add at least one prompt"); return; }
    try {
      await startSingleShotJob({
        key: JOB_KEY,
        postPath: "/visibility",
        postBody: { brand, domain: domain || null, prompts: list },
      });
      toast.success("Visibility scan complete");
    } catch { /* handled in subscription */ }
  };

  const openPast = async (p) => {
    setJobResult(JOB_KEY, p);
    setResult(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const enriched = await enrichWithPuterEngines({
        query: p.brand || p.domain || "",
        brand: p.brand || p.domain || "",
        sources: p.citation_sources || [],
      });
      setResult((prev) => (prev && prev.id === p.id ? { ...prev, citation_sources: enriched } : prev));
    } catch { /* silent */ }
  };

  const r = result;
  const cites = r?.citation_sources || [];

  return (
    <div>
      <PageHeader
        overline="Generative Engine (GEO)"
        title="Visibility Tracker"
        subtitle="Set up a project with your brand and the prompts your customers ask AI engines. We scan across ChatGPT, Claude, Perplexity, Gemini, Copilot, Grok & Google AI to show where you rank — and where you don't."
      />

      {/* Project setup card */}
      <Card className="p-5 rounded-xl border-border/60 mb-6" data-testid="vis-project-card">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-[#6366F1]/10 flex items-center justify-center">
            <Activity size={16} className="text-[#6366F1]" />
          </div>
          <div>
            <h3 className="font-head font-bold">New visibility project</h3>
            <p className="text-xs text-muted-foreground">Track how AI engines rank your brand across the prompts that matter to your buyers.</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          <div>
            <label className="text-xs uppercase font-bold text-muted-foreground">Brand name</label>
            <Input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="e.g. Notion"
              className="mt-1.5"
              data-testid="brand-input"
            />
          </div>
          <div>
            <label className="text-xs uppercase font-bold text-muted-foreground">Domain (optional)</label>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="notion.so"
              className="mt-1.5"
              data-testid="vis-domain-input"
            />
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <label className="text-xs uppercase font-bold text-muted-foreground">Prompts to track</label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={suggest}
              disabled={suggesting}
              className="h-8"
              data-testid="suggest-prompts-btn"
            >
              {suggesting ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Wand2 size={13} className="mr-1.5" />}
              Suggest prompts
            </Button>
            {rows.some((r) => r.trim()) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="h-8 text-muted-foreground hover:text-red-600"
                data-testid="clear-prompts-btn"
              >
                Clear all
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2 mb-3">
          {rows.map((v, i) => (
            <PromptRow
              key={i}
              index={i}
              value={v}
              onChange={(nv) => setRow(i, nv)}
              onRemove={() => removeRow(i)}
            />
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={rows.length >= 12}
          className="h-8 mb-4"
          data-testid="add-prompt-btn"
        >
          <Plus size={13} className="mr-1.5" /> Add prompt
        </Button>

        <div className="flex items-center gap-3 pt-4 border-t border-border/60">
          <Button
            onClick={run}
            disabled={loading}
            className="btn-brand hover:opacity-90"
            data-testid="run-visibility-btn"
          >
            {loading
              ? <><Loader2 size={16} className="mr-2 animate-spin" /> Scanning across engines…</>
              : <><Sparkles size={16} className="mr-2" /> Add project &amp; scan</>}
          </Button>
          <p className="text-[11px] text-muted-foreground">Scans across 7 AI engines · citations discovered via live web search.</p>
        </div>
      </Card>

      {/* Results */}
      {r && (
        <div className="mb-10" data-testid="visibility-result">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
            <Card className="p-5 rounded-xl border-border/60">
              <div className="text-xs uppercase font-bold text-muted-foreground">Visibility Score</div>
              <div className="font-head text-4xl font-extrabold" style={{ color: scoreColor(r.visibility_score) }}>
                {r.visibility_score ?? 0}
              </div>
            </Card>
            <Card className="p-5 rounded-xl border-border/60">
              <div className="text-xs uppercase font-bold text-muted-foreground">Share of Voice</div>
              <div className="font-head text-4xl font-extrabold" style={{ color: scoreColor(r.share_of_voice) }}>
                {r.share_of_voice ?? 0}
              </div>
            </Card>
            <Card className="p-5 rounded-xl border-border/60 col-span-2 sm:col-span-1">
              <div className="text-xs uppercase font-bold text-muted-foreground">Prompts Tested</div>
              <div className="font-head text-4xl font-extrabold">{r.results?.length || 0}</div>
            </Card>
          </div>

          <h3 className="font-head text-lg font-bold mb-3">Ranking across AI engines</h3>
          <div className="space-y-3 mb-8">
            {(r.results || []).map((res, i) => (
              <Card key={i} className="p-5 rounded-xl border-border/60" data-testid={`prompt-result-${i}`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <p className="font-medium text-sm">&quot;{res.prompt}&quot;</p>
                  <Badge className={`rounded-md border capitalize shrink-0 ${posColor[res.position] || posColor.none}`}>
                    {res.mentioned ? res.position : "not ranking"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {ENGINE_ORDER.map((k) => (
                    <EngineChip key={k} engine={k} present={!!(res.engines || {})[k]} />
                  ))}
                </div>
                {res.note && <p className="text-xs text-muted-foreground mt-1">{res.note}</p>}
                {res.competitors_mentioned?.length > 0 && (
                  <p className="text-xs mt-2">
                    <span className="font-semibold">Competitors shown:</span>{" "}
                    {res.competitors_mentioned.join(", ")}
                  </p>
                )}
              </Card>
            ))}
          </div>

          {cites.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <Link2 size={16} className="text-[#6366F1]" />
                <h3 className="font-head text-lg font-bold">Citation sources</h3>
                <Badge className="rounded-md border-0 bg-slate-100 text-slate-700">{cites.length}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Real, HTTP-verified pages where <b className="text-foreground">{r.brand}</b> is mentioned across the web — with the AI engines that actually pick each source up.
              </p>
              <div className="space-y-2 mb-6">
                {cites.map((s, i) => <CitationCard key={i} s={s} i={i} />)}
              </div>
            </>
          )}

          {r.recommendations?.length > 0 && (
            <Card className="p-6 rounded-xl border-border/60 mt-4">
              <h3 className="font-head font-bold mb-3">How to improve visibility</h3>
              <ul className="space-y-2">
                {r.recommendations.map((x, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <Sparkles size={15} className="text-[#6366F1] mt-0.5 shrink-0" />
                    {x}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* Past projects */}
      <h3 className="font-head text-xl font-bold mb-4">Past projects</h3>
      {past.length === 0 ? (
        <EmptyState icon={Activity} text="No visibility projects yet." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {past.map((p) => (
            <button
              key={p.id}
              onClick={() => openPast(p)}
              data-testid={`vis-past-${p.id}`}
              className="text-left bg-white border border-border/60 rounded-xl p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="flex items-center justify-between">
                <span className="font-head font-bold truncate">{p.brand}</span>
                <span className="font-head text-2xl font-extrabold" style={{ color: scoreColor(p.visibility_score) }}>
                  {p.visibility_score ?? 0}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {p.results?.length || 0} prompts · {new Date(p.created_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
