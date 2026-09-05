import { useEffect, useState, useMemo } from "react";
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
  Activity, Loader2, Sparkles, Check, X, Plus, Trash2, Wand2, ChevronDown,
  ChevronUp, ExternalLink, ShieldCheck, FolderPlus, Folder,
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
  top:         "bg-emerald-100 text-emerald-800 border-emerald-200",
  recommended: "bg-emerald-50 text-emerald-700 border-emerald-200",
  passing:     "bg-amber-50 text-amber-700 border-amber-200",
  none:        "bg-red-50 text-red-700 border-red-200",
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

function EngineLogo({ engine, present, size = 14 }) {
  const meta = engineMeta[engine] || { label: engine, domain: "" };
  return (
    <span
      className={
        "relative inline-flex items-center justify-center rounded-full border-2 " +
        (present
          ? "bg-white border-emerald-400 shadow-sm"
          : "bg-slate-100 border-slate-200")
      }
      style={{ width: size + 10, height: size + 10 }}
      title={present ? `Ranks on ${meta.label}` : `Not ranking on ${meta.label}`}
    >
      <img
        src={engFav(meta.domain)}
        alt=""
        className={"rounded " + (present ? "" : "opacity-40 grayscale")}
        style={{ width: size, height: size }}
        onError={(ev) => { ev.target.style.display = "none"; }}
      />
      {!present && (
        <span className="absolute -bottom-0.5 -right-0.5 bg-slate-400 text-white rounded-full">
          <X size={9} strokeWidth={3} />
        </span>
      )}
      {present && (
        <span className="absolute -bottom-0.5 -right-0.5 bg-emerald-500 text-white rounded-full">
          <Check size={9} strokeWidth={3} />
        </span>
      )}
    </span>
  );
}

function PromptRow({ index, res, brand, domain, expanded, onToggle }) {
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState(null);
  const [enrichedOnce, setEnrichedOnce] = useState(false);

  const rankingCount = ENGINE_ORDER.filter((k) => (res.engines || {})[k]).length;
  const isRanking = res.mentioned && rankingCount > 0;

  const openAndLoad = async () => {
    onToggle();
    if (!expanded && sources === null) {
      setLoading(true);
      try {
        const { data } = await http.post("/visibility/prompt-sources", {
          prompt: res.prompt,
          brand,
          domain: domain || null,
        });
        setSources(data.sources || []);
      } catch (e) {
        toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not load sources");
        setSources([]);
      } finally {
        setLoading(false);
      }
    }
  };

  // Puter.js enrichment for perplexity/grok/chatgpt/claude — silent on skip.
  useEffect(() => {
    if (expanded && Array.isArray(sources) && sources.length > 0 && !enrichedOnce) {
      setEnrichedOnce(true);
      (async () => {
        try {
          const enriched = await enrichWithPuterEngines({
            query: res.prompt,
            brand: brand || "",
            sources,
          });
          setSources(enriched);
        } catch { /* silent */ }
      })();
    }
  }, [expanded, sources, enrichedOnce, res.prompt, brand]);

  return (
    <Card className="rounded-xl border-border/60 overflow-hidden" data-testid={`prompt-row-${index}`}>
      <button
        type="button"
        onClick={openAndLoad}
        className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-muted/40 transition-colors"
      >
        <span className="font-head font-bold text-sm text-muted-foreground w-6 text-center shrink-0">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-foreground truncate">&quot;{res.prompt}&quot;</p>
          <div className="flex items-center gap-2 mt-1.5">
            {ENGINE_ORDER.map((k) => (
              <EngineLogo key={k} engine={k} present={!!(res.engines || {})[k]} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Badge className={`rounded-md border capitalize text-[11px] ${posColor[res.position] || posColor.none}`}>
            {isRanking ? res.position : "not ranking"}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
            {rankingCount}/{ENGINE_ORDER.length}
          </span>
          {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/60 bg-muted/20 px-4 py-4">
          {res.note && <p className="text-xs text-muted-foreground italic mb-3">&ldquo;{res.note}&rdquo;</p>}
          {res.competitors_mentioned?.length > 0 && (
            <p className="text-xs mb-3">
              <span className="font-semibold text-foreground">Competitors AI mentions:</span>{" "}
              <span className="text-muted-foreground">{res.competitors_mentioned.join(", ")}</span>
            </p>
          )}

          <div className="flex items-center gap-2 mb-2">
            <ExternalLink size={13} className="text-[#6366F1]" />
            <h4 className="text-xs uppercase tracking-wide font-bold text-muted-foreground">
              Sources AI engines pull for this prompt
            </h4>
            {Array.isArray(sources) && (
              <span className="text-[11px] text-muted-foreground">· {sources.length} live</span>
            )}
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 size={14} className="animate-spin" /> Fetching live sources…
            </div>
          )}
          {!loading && Array.isArray(sources) && sources.length === 0 && (
            <p className="text-xs text-muted-foreground py-3">No live sources found for this prompt.</p>
          )}
          {!loading && Array.isArray(sources) && sources.length > 0 && (
            <div className="space-y-1.5">
              {sources.map((s, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-lg bg-white p-2.5 border border-border/50">
                  <img
                    src={engFav(s.domain)}
                    alt=""
                    className="w-4 h-4 rounded shrink-0 mt-0.5"
                    onError={(ev) => { ev.target.style.display = "none"; }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-foreground hover:underline truncate max-w-full"
                      >
                        {s.title || s.domain}
                      </a>
                      {s.type && (
                        <Badge className={`rounded-md capitalize border-0 text-[10px] ${typeColor[s.type] || "bg-muted"}`}>
                          {s.type}
                        </Badge>
                      )}
                      {s.verified && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-green-700 bg-green-50 border border-green-200 rounded-md px-1 py-0.5">
                          <ShieldCheck size={9} /> Live
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                      <span className="font-medium text-foreground/60">{s.domain}</span>
                      {s.why ? ` — ${s.why}` : ""}
                    </p>
                    {Array.isArray(s.engines) && s.engines.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        <span className="text-[10px] text-muted-foreground mr-0.5">Cited by:</span>
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
                      <div className="text-[9px] uppercase text-muted-foreground">auth</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SeedRow({ value, onChange, onRemove, index }) {
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
        data-testid={`seed-row-${index}`}
      />
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-red-600 shrink-0 transition-colors p-1"
        aria-label="Remove prompt"
        data-testid={`seed-remove-${index}`}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

export default function Visibility() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [brand, setBrand] = useSessionState("visibility:brand", "");
  const [domain, setDomain] = useSessionState("visibility:domain", "");
  const [projectName, setProjectName] = useSessionState("visibility:projectName", "");
  const [seeds, setSeeds] = useSessionState("visibility:seeds", [""]);
  const [expanding, setExpanding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [expandedPreview, setExpandedPreview] = useState([]); // prompts after LLM expansion, pre-scan
  const initial = getJobState(JOB_KEY);
  const [status, setStatus] = useState(initial.status || "idle");
  const [result, setResult] = useState(initial.result || null);
  const [past, setPast] = useState([]);
  const [expandedRows, setExpandedRows] = useState({}); // index -> bool
  const loading = status === "running";

  const load = () => http.get("/visibility").then((r) => setPast(r.data)).catch(() => {});

  useEffect(() => {
    load();
    const unsub = subscribeJob(JOB_KEY, (snap) => {
      setStatus(snap.status || "idle");
      if (snap.status === "done" && snap.result) {
        setResult(snap.result);
        setExpandedRows({});
        load();
      } else if (snap.status === "error") {
        toast.error(formatApiErrorDetail(snap.error?.response?.data?.detail) || "Visibility scan failed");
      }
    });
    // Pre-fill from URL (drill-in)
    const qBrand = searchParams.get("brand");
    const qDomain = searchParams.get("domain");
    if (qBrand) setBrand(qBrand);
    if (qDomain) setDomain(qDomain);
    if (qBrand || qDomain) setSearchParams({}, { replace: true });
    return () => { unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setSeed = (i, v) => setSeeds((prev) => prev.map((r, k) => (k === i ? v : r)));
  const addSeed = () => setSeeds((prev) => [...prev, ""]);
  const removeSeed = (i) => setSeeds((prev) => (prev.length === 1 ? [""] : prev.filter((_, k) => k !== i)));
  const cleanSeeds = useMemo(() => seeds.map((s) => s.trim()).filter(Boolean), [seeds]);

  const resetForNewProject = () => {
    setBrand("");
    setDomain("");
    setProjectName("");
    setSeeds([""]);
    setExpandedPreview([]);
    setResult(null);
    setJobResult(JOB_KEY, null);
    setExpandedRows({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const suggest = async () => {
    if (!brand.trim() && !domain.trim()) {
      toast.error("Enter a brand or domain first");
      return;
    }
    setSuggesting(true);
    try {
      const { data } = await http.post("/visibility/suggest-prompts", { brand, domain });
      const list = (data?.prompts || []).filter(Boolean);
      if (list.length === 0) {
        toast.error("No suggestions returned");
      } else {
        const existing = seeds.map((r) => r.trim()).filter(Boolean);
        const dedup = [];
        const seen = new Set();
        for (const p of [...existing, ...list]) {
          const k = p.toLowerCase();
          if (!seen.has(k)) { seen.add(k); dedup.push(p); }
        }
        setSeeds(dedup.slice(0, 12));
        toast.success(`Added ${list.length} suggested seed prompts`);
      }
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not fetch suggestions");
    } finally {
      setSuggesting(false);
    }
  };

  const runScan = async () => {
    if (!brand.trim() && !domain.trim()) { toast.error("Enter a brand or domain"); return; }
    if (cleanSeeds.length === 0) { toast.error("Add at least one seed prompt"); return; }

    // 1) Expand seeds → 25-30 prompts (1 cheap LLM call)
    setExpanding(true);
    let expandedList = expandedPreview;
    try {
      if (expandedPreview.length === 0) {
        const { data } = await http.post("/visibility/expand-prompts", {
          brand: brand || domain,
          domain,
          seeds: cleanSeeds,
        });
        expandedList = data?.prompts || cleanSeeds;
        setExpandedPreview(expandedList);
      }
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Prompt expansion failed");
      setExpanding(false);
      return;
    } finally {
      setExpanding(false);
    }

    // 2) Run the actual visibility scan (1 LLM call) with the expanded list
    try {
      await startSingleShotJob({
        key: JOB_KEY,
        postPath: "/visibility",
        postBody: {
          brand: brand || domain,
          domain: domain || null,
          prompts: expandedList,
          seed_prompts: cleanSeeds,
          project_name: (projectName || brand || domain).trim(),
        },
      });
      toast.success(`Scanning ${expandedList.length} prompts across AI engines`);
    } catch { /* handled in subscription */ }
  };

  const openPast = (p) => {
    setJobResult(JOB_KEY, p);
    setResult(p);
    setBrand(p.brand || "");
    setDomain(p.domain || "");
    setProjectName(p.project_name || p.brand || "");
    if (Array.isArray(p.seed_prompts) && p.seed_prompts.length > 0) setSeeds(p.seed_prompts);
    else setSeeds([""]);
    setExpandedPreview(p.prompts || []);
    setExpandedRows({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleRow = (i) =>
    setExpandedRows((prev) => ({ ...prev, [i]: !prev[i] }));

  const r = result;
  const rankingSummary = useMemo(() => {
    if (!r?.results) return { ranking: 0, total: 0 };
    const total = r.results.length;
    const ranking = r.results.filter((x) => {
      const engines = x.engines || {};
      return ENGINE_ORDER.some((k) => engines[k]);
    }).length;
    return { ranking, total };
  }, [r]);

  return (
    <div>
      <PageHeader
        overline="Generative Engine (GEO)"
        title="Visibility Tracker"
        subtitle="Create a project with your brand, add a few seed prompts, and we auto-expand them into 25–30 buyer-intent queries. We scan all 7 AI engines and, for each prompt, reveal the exact sources those engines pull from."
      />

      {/* Project switcher */}
      {past.length > 0 && (
        <Card className="p-4 rounded-xl border-border/60 mb-6" data-testid="vis-project-switcher">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Folder size={15} className="text-[#6366F1]" />
              <h3 className="text-xs uppercase tracking-wide font-bold text-muted-foreground">Your projects</h3>
              <span className="text-[11px] text-muted-foreground">· {past.length}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetForNewProject}
              className="h-8"
              data-testid="new-project-btn"
            >
              <FolderPlus size={13} className="mr-1.5" /> New project
            </Button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {past.map((p) => {
              const active = r && r.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => openPast(p)}
                  data-testid={`vis-project-chip-${p.id}`}
                  className={
                    "shrink-0 text-left rounded-xl border px-3.5 py-2.5 transition-all min-w-[180px] " +
                    (active
                      ? "border-[#6366F1] bg-[#6366F1]/5 shadow-sm"
                      : "border-border/60 bg-white hover:border-[#6366F1]/40 hover:bg-muted/40")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-head font-bold text-sm truncate">
                      {p.project_name || p.brand}
                    </span>
                    <span
                      className="font-head text-base font-extrabold tabular-nums"
                      style={{ color: scoreColor(p.visibility_score) }}
                    >
                      {p.visibility_score ?? 0}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {p.prompts?.length || p.results?.length || 0} prompts · {new Date(p.created_at).toLocaleDateString()}
                  </p>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Project setup */}
      <Card className="p-5 rounded-xl border-border/60 mb-6" data-testid="vis-project-card">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-lg bg-[#6366F1]/10 flex items-center justify-center">
            <Activity size={17} className="text-[#6366F1]" />
          </div>
          <div>
            <h3 className="font-head font-bold">
              {r ? "Edit this project or start another" : "New visibility project"}
            </h3>
            <p className="text-xs text-muted-foreground">
              Give us a few seed prompts — we expand them into 25–30 buyer queries and scan all 7 AI engines.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mb-5">
          <div>
            <label className="text-xs uppercase font-bold text-muted-foreground">Project name (optional)</label>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Notion tracker Q1"
              className="mt-1.5"
              data-testid="project-name-input"
            />
          </div>
          <div>
            <label className="text-xs uppercase font-bold text-muted-foreground">Brand</label>
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

        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs uppercase font-bold text-muted-foreground">Seed prompts</label>
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
              Suggest seeds
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Add 3–8 prompts your buyers ask AI engines. We&apos;ll expand them to 25–30 diverse queries.
        </p>

        <div className="space-y-2 mb-3">
          {seeds.map((v, i) => (
            <SeedRow
              key={i}
              index={i}
              value={v}
              onChange={(nv) => setSeed(i, nv)}
              onRemove={() => removeSeed(i)}
            />
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addSeed}
          disabled={seeds.length >= 12}
          className="h-8 mb-5"
          data-testid="add-seed-btn"
        >
          <Plus size={13} className="mr-1.5" /> Add seed prompt
        </Button>

        <div className="flex items-center gap-3 pt-4 border-t border-border/60">
          <Button
            onClick={runScan}
            disabled={loading || expanding}
            className="btn-brand hover:opacity-90"
            data-testid="run-visibility-btn"
          >
            {expanding ? (
              <><Loader2 size={16} className="mr-2 animate-spin" /> Expanding prompts…</>
            ) : loading ? (
              <><Loader2 size={16} className="mr-2 animate-spin" /> Scanning across engines…</>
            ) : (
              <><Sparkles size={16} className="mr-2" /> Expand &amp; scan project</>
            )}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            2 tiny LLM calls per project · citations load lazily per prompt (cached 24h).
          </p>
        </div>
      </Card>

      {/* Results */}
      {r && (
        <div className="mb-10" data-testid="visibility-result">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Card className="p-4 rounded-xl border-border/60">
              <div className="text-[10px] uppercase font-bold text-muted-foreground">Visibility Score</div>
              <div className="font-head text-3xl font-extrabold" style={{ color: scoreColor(r.visibility_score) }}>
                {r.visibility_score ?? 0}
              </div>
            </Card>
            <Card className="p-4 rounded-xl border-border/60">
              <div className="text-[10px] uppercase font-bold text-muted-foreground">Share of Voice</div>
              <div className="font-head text-3xl font-extrabold" style={{ color: scoreColor(r.share_of_voice) }}>
                {r.share_of_voice ?? 0}
              </div>
            </Card>
            <Card className="p-4 rounded-xl border-border/60">
              <div className="text-[10px] uppercase font-bold text-muted-foreground">Prompts Ranking</div>
              <div className="font-head text-3xl font-extrabold text-emerald-600">
                {rankingSummary.ranking}<span className="text-lg text-muted-foreground">/{rankingSummary.total}</span>
              </div>
            </Card>
            <Card className="p-4 rounded-xl border-border/60">
              <div className="text-[10px] uppercase font-bold text-muted-foreground">Prompts Scanned</div>
              <div className="font-head text-3xl font-extrabold">{r.results?.length || 0}</div>
            </Card>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <Activity size={16} className="text-[#6366F1]" />
            <h3 className="font-head text-lg font-bold">Prompts &amp; ranking across engines</h3>
            <span className="text-[11px] text-muted-foreground">· click any prompt to see its live sources</span>
          </div>

          <div className="space-y-2">
            {(r.results || []).map((res, i) => (
              <PromptRow
                key={`${r.id || "cur"}-${i}`}
                index={i}
                res={res}
                brand={r.brand}
                domain={r.domain}
                expanded={!!expandedRows[i]}
                onToggle={() => toggleRow(i)}
              />
            ))}
          </div>

          {r.recommendations?.length > 0 && (
            <Card className="p-6 rounded-xl border-border/60 mt-6">
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

      {!r && past.length === 0 && (
        <EmptyState icon={Activity} text="No visibility projects yet. Set up your first one above." />
      )}
    </div>
  );
}
