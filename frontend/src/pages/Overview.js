import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { http } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { PageHeader, ScorePill } from "@/components/ui-bits";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { FileText, Globe, Activity, Link2, MessageSquare, ArrowUpRight, Sparkles } from "lucide-react";

const tools = [
  { to: "/app/domain", label: "Domain Analysis", desc: "Audit a site's AI readiness", icon: Globe },
  { to: "/app/visibility", label: "Visibility Tracker", desc: "Track brand mentions in AI answers", icon: Activity },
  { to: "/app/citations", label: "Citation Sources", desc: "See what AI cites for a query", icon: Link2 },
  { to: "/app/reddit", label: "Reddit Finder", desc: "Find AI-cited Reddit threads", icon: MessageSquare },
  { to: "/app/optimizer", label: "Content Optimizer", desc: "Score & fix a page for AEO", icon: FileText },
];

function Stat({ label, value, accent }) {
  return (
    <Card className="p-5 rounded-xl border-border/60">
      <div className="text-xs uppercase tracking-wide font-bold text-muted-foreground">{label}</div>
      <div className="font-head text-3xl font-extrabold mt-1" style={accent ? { color: accent } : {}}>{value}</div>
    </Card>
  );
}

export default function Overview() {
  const [d, setD] = useState(null);
  useEffect(() => { http.get("/dashboard").then((r) => setD(r.data)).catch(() => {}); }, []);
  const s = d?.stats || {};

  return (
    <div>
      <PageHeader overline="Overview" title="Dashboard"
        subtitle="Your AI search visibility at a glance — across generative and answer engines." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Avg Content Score" value={s.avg_content_score ?? 0} accent="#002FA7" />
        <Stat label="Avg Domain Score" value={s.avg_domain_score ?? 0} accent="#002FA7" />
        <Stat label="Avg Visibility" value={s.avg_visibility ?? 0} accent="#002FA7" />
        <Stat label="Total Analyses" value={s.analyses ?? 0} />
      </div>

      <div className="grid lg:grid-cols-5 gap-6 mb-10">
        <Card className="lg:col-span-3 p-6 rounded-xl border-border/60">
          <h3 className="font-head font-bold mb-4">Content score trend</h3>
          {d?.content_trend?.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.content_trend.map((p) => ({ date: new Date(p.date).toLocaleDateString(), score: p.score }))} margin={{ left: -20 }}>
                  <defs><linearGradient id="ct" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#002FA7" stopOpacity={0.25} /><stop offset="100%" stopColor="#002FA7" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <Tooltip />
                  <Area type="monotone" dataKey="score" stroke="#002FA7" strokeWidth={2} fill="url(#ct)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="h-56 grid place-items-center text-sm text-muted-foreground grain rounded-lg">Run a Content audit to see trends</div>}
        </Card>

        <Card className="lg:col-span-2 p-6 rounded-xl border-border/60">
          <h3 className="font-head font-bold mb-4">Recent activity</h3>
          <div className="space-y-1" data-testid="activity-list">
            {d?.activity?.length ? d.activity.map((a, i) => (
              <Link key={i} to={a.link} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors">
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{a.type}</span>
                <span className="text-sm truncate flex-1">{a.label}</span>
                <ScorePill score={a.score} size="md" />
              </Link>
            )) : <p className="text-sm text-muted-foreground">No activity yet.</p>}
          </div>
        </Card>
      </div>

      <h3 className="font-head text-2xl font-bold tracking-tight mb-4">Tools</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((t) => (
          <Link key={t.to} to={t.to} data-testid={`tool-${t.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="group bg-white border border-border/60 rounded-xl p-6 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-black text-white grid place-items-center"><t.icon size={20} /></div>
              <ArrowUpRight size={18} className="text-muted-foreground group-hover:text-black transition-colors" />
            </div>
            <div className="font-head font-bold">{t.label}</div>
            <div className="text-sm text-muted-foreground mt-1">{t.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
