import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { http } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { scoreColor } from "@/components/ScoreGauge";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp, ArrowUpRight } from "lucide-react";

export default function History() {
  const [groups, setGroups] = useState([]);
  useEffect(() => { http.get("/analyses/history").then((r) => setGroups(r.data)).catch(() => {}); }, []);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs tracking-[0.2em] uppercase font-bold text-[#002FA7]">Track progress</p>
        <h1 className="font-head text-4xl font-extrabold tracking-tight mt-2">Score history</h1>
        <p className="text-muted-foreground mt-3">Re-run audits on the same URL after edits to see your GEO score climb.</p>
      </div>

      {groups.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center text-muted-foreground grain">
          <TrendingUp className="mx-auto mb-3 opacity-40" />
          <p>No history yet. Analyze the same URL more than once to chart improvements.</p>
        </div>
      ) : (
        <div className="grid gap-6" data-testid="history-groups">
          {groups.map((g, i) => {
            const data = g.points.map((p) => ({ date: new Date(p.created_at).toLocaleDateString(), score: p.score, id: p.id }));
            const latest = g.points[g.points.length - 1];
            const first = g.points[0];
            const delta = latest.score - first.score;
            return (
              <Card key={i} className="p-6 rounded-lg border-border/60">
                <div className="flex items-start justify-between mb-4 gap-4">
                  <div className="min-w-0">
                    <p className="font-head font-bold truncate">{g.key}</p>
                    <p className="text-xs text-muted-foreground">{g.points.length} analysis{g.points.length > 1 ? "es" : ""}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-head text-3xl font-extrabold tabular-nums" style={{ color: scoreColor(latest.score) }}>{latest.score}</span>
                    {g.points.length > 1 && (
                      <div className={`text-xs font-bold ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>{delta >= 0 ? "+" : ""}{delta} pts</div>
                    )}
                  </div>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id={`g${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#002FA7" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#002FA7" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                      <Tooltip />
                      <Area type="monotone" dataKey="score" stroke="#002FA7" strokeWidth={2} fill={`url(#g${i})`} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border/60">
                  {g.points.map((p) => (
                    <Link key={p.id} to={`/app/analysis/${p.id}`} data-testid={`history-point-${p.id}`}
                      className="inline-flex items-center gap-1 text-xs bg-muted hover:bg-black hover:text-white px-2.5 py-1 rounded-md transition-colors">
                      {new Date(p.created_at).toLocaleDateString()} · {p.score} <ArrowUpRight size={12} />
                    </Link>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
