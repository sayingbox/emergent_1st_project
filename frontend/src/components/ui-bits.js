import { scoreColor } from "@/components/ScoreGauge";

export function PageHeader({ overline, title, subtitle, action, accent = false }) {
  return (
    <div className="mb-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {overline && <span className="overline-chip">{overline}</span>}
          <h1 className="font-head text-3xl sm:text-[2.375rem] font-extrabold tracking-tight mt-3 leading-tight">
            {accent ? <span className="gradient-text">{title}</span> : title}
          </h1>
          {subtitle && <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="divider-fade mt-6" />
    </div>
  );
}

export function ScorePill({ score, size = "md" }) {
  const cls = size === "lg" ? "text-3xl" : "text-xl";
  return <span className={`font-head font-extrabold tabular-nums ${cls}`} style={{ color: scoreColor(score) }}>{score}</span>;
}

export function EmptyState({ icon: Icon, text }) {
  return (
    <div className="border border-dashed border-border/70 rounded-xl p-14 text-center text-muted-foreground grain bg-card/40">
      {Icon && (
        <div className="mx-auto mb-4 w-12 h-12 rounded-full grid place-items-center bg-gradient-to-br from-[#18C090]/10 to-[#7C5CFF]/10 border border-[#18C090]/20">
          <Icon size={20} className="text-[#18C090]" />
        </div>
      )}
      <p className="text-sm max-w-md mx-auto leading-relaxed">{text}</p>
    </div>
  );
}
