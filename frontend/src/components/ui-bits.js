import { scoreColor } from "@/components/ScoreGauge";

export function PageHeader({ overline, title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-8">
      <div>
        {overline && <p className="text-xs tracking-[0.2em] uppercase font-bold text-[#002FA7]">{overline}</p>}
        <h1 className="font-head text-3xl sm:text-4xl font-extrabold tracking-tight mt-2">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-2 max-w-2xl text-sm">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ScorePill({ score, size = "md" }) {
  const cls = size === "lg" ? "text-3xl" : "text-xl";
  return <span className={`font-head font-extrabold tabular-nums ${cls}`} style={{ color: scoreColor(score) }}>{score}</span>;
}

export function EmptyState({ icon: Icon, text }) {
  return (
    <div className="border border-dashed border-border rounded-xl p-12 text-center text-muted-foreground grain">
      {Icon && <Icon className="mx-auto mb-3 opacity-40" />}
      <p className="text-sm">{text}</p>
    </div>
  );
}
