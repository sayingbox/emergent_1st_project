import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { http } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { ScorePill } from "@/components/ui-bits";
import { scoreColor } from "@/components/ScoreGauge";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { FileText, Globe, Activity, Link2, MessageSquare, ArrowUpRight, Sparkles, Gauge, TrendingUp, BarChart3 } from "lucide-react";

const BRAND = "#6366F1";

const tools = [
  { to: "/app/domain", label: "Domain Analysis", desc: "Crawl-first AI-search audit of any site", icon: Globe },
  { to: "/app/visibility", label: "Visibility Tracker", desc: "Track brand mentions in AI answers", icon: Activity },
  { to: "/app/citations", label: "Citation Sources", desc: "See what AI cites for a query", icon: Link2 },
  { to: "/app/reddit", label: "Reddit Finder", desc: "Find AI-cited Reddit threads", icon: MessageSquare },
  { to: "/app/optimizer", label: "Content Optimizer", desc: "Score & fix a page for AEO", icon: FileText },
];

const fadeUp = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };

function StatCard({ label, value, icon: Icon, isScore }) {
  const col = isScore ? scoreColor(value || 0) : "#09090B";
  return (
    <motion.div variants={fadeUp}>
      <Card data-testid={`stat-card-${label.toLowerCase().replace(/\s+/g, "-")}`}
        className="group relative overflow-hidden p-6 rounded-lg border-zinc-200 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-transform duration-200 hover:-translate-y-[3px] hover:shadow-lg">
        <div className="absolute top-0 left-0 h-[3px] w-0 group-hover:w-full bg-[#6366F1] transition-all duration-300" />
        <div className="flex items-center justify-between">
          <div className="w-9 h-9 rounded-md grid place-items-center" style={{ background: "rgba(99, 102, 241,0.1)", color: BRAND }}>
            <Icon size={18} />
          </div>
          {isScore && <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: `${col}1a`, color: col }}>/100</span>}
        </div>
        <div className="font-head text-4xl font-extrabold tabular-nums mt-4" style={{ color: col }}>{value ?? 0}</div>
        <div className="text-xs uppercase tracking-wide font-bold text-zinc-500 mt-1">{label}</div>
      </Card>
    </motion.div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-md shadow-lg px-3 py-2">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="font-head font-bold text-sm" style={{ color: scoreColor(payload[0].value) }}>{payload[0].value} <span className="text-zinc-400 font-normal">score</span></p>
    </div>
  );
}

export default function Overview() {
  const [d, setD] = useState(null);
  useEffect(() => { http.get("/dashboard").then((r) => setD(r.data)).catch(() => {}); }, []);
  const s = d?.stats || {};

  return (
    <div>
      {/* Hero band */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-2xl bg-[#0B0B0F] p-8 sm:p-10 mb-8">
        <div className="absolute -top-24 -right-16 w-[380px] h-[380px] rounded-full blur-3xl opacity-60"
          style={{ background: "radial-gradient(circle, rgba(99, 102, 241,0.45) 0%, rgba(99, 102, 241,0) 70%)" }} />
        <div className="relative">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-[#6366F1]">Overview</p>
          <h1 className="font-head text-3xl sm:text-4xl font-extrabold tracking-tight text-white mt-2">Your AI-search command center</h1>
          <p className="text-white/60 mt-2 max-w-2xl text-sm">Track how ChatGPT, Claude, Perplexity and Gemini see your brand — across generative and answer engines, in one place.</p>
          <Link to="/app/domain" data-testid="hero-cta"
            className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-md bg-[#6366F1] text-white text-sm font-semibold hover:bg-[#129E75] transition-colors">
            <Sparkles size={16} /> Analyze a domain
          </Link>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Avg Content Score" value={s.avg_content_score ?? 0} icon={FileText} isScore />
        <StatCard label="Avg Domain Score" value={s.avg_domain_score ?? 0} icon={Globe} isScore />
        <StatCard label="Avg Visibility" value={s.avg_visibility ?? 0} icon={Activity} isScore />
        <StatCard label="Total Analyses" value={s.analyses ?? 0} icon={BarChart3} />
      </motion.div>

      <div className="grid lg:grid-cols-5 gap-6 mb-10">
        <Card className="lg:col-span-3 p-6 rounded-lg border-zinc-200 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-[#6366F1]" />
            <h3 className="font-head font-bold">Content score trend</h3>
          </div>
          {d?.content_trend?.length ? (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.content_trend.map((p) => ({ date: new Date(p.date).toLocaleDateString(), score: p.score }))} margin={{ left: -18, right: 6, top: 6 }}>
                  <defs><linearGradient id="ct" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366F1" stopOpacity={0.28} /><stop offset="100%" stopColor="#6366F1" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f1f4" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#a1a1aa" tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#a1a1aa" tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#6366F1", strokeOpacity: 0.3 }} />
                  <Area type="monotone" dataKey="score" stroke="#6366F1" strokeWidth={2.5} fill="url(#ct)" dot={{ r: 2.5, fill: "#6366F1", strokeWidth: 0 }} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-60 grid place-items-center text-center rounded-lg border border-dashed border-zinc-200">
              <div>
                <Gauge className="mx-auto mb-2 text-zinc-300" />
                <p className="text-sm text-zinc-500">Run a Content audit to see your trend</p>
              </div>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2 p-6 rounded-lg border-zinc-200 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <h3 className="font-head font-bold mb-3">Recent activity</h3>
          <div data-testid="activity-list">
            {d?.activity?.length ? d.activity.map((a, i) => (
              <Link key={i} to={a.link}
                className={`flex items-center gap-3 py-2.5 group ${i !== d.activity.length - 1 ? "border-b border-zinc-100" : ""}`}>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0" style={{ background: "rgba(99, 102, 241,0.1)", color: BRAND }}>{a.type}</span>
                <span className="text-sm truncate flex-1 group-hover:text-[#129E75] transition-colors">{a.label}</span>
                <ScorePill score={a.score} size="md" />
              </Link>
            )) : <p className="text-sm text-zinc-500">No activity yet.</p>}
          </div>
        </Card>
      </div>

      <h3 className="font-head text-2xl font-bold tracking-tight mb-4">Tools</h3>
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((t) => (
          <motion.div key={t.to} variants={fadeUp}>
            <Link to={t.to} data-testid={`tool-${t.label.toLowerCase().replace(/\s+/g, "-")}`}
              className="group flex flex-col h-full bg-white border border-zinc-200 rounded-lg p-6 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="w-11 h-11 rounded-lg grid place-items-center transition-colors" style={{ background: "rgba(99, 102, 241,0.1)", color: BRAND }}>
                  <t.icon size={20} />
                </div>
                <ArrowUpRight size={18} className="text-zinc-300 group-hover:text-[#6366F1] transition-colors" />
              </div>
              <div className="font-head font-bold">{t.label}</div>
              <div className="text-sm text-zinc-500 mt-1">{t.desc}</div>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
