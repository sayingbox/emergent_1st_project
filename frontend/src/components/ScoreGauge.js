import { motion } from "framer-motion";

const colorFor = (s) =>
  s >= 80 ? "#15803D" :   // strong green
  s >= 70 ? "#22C55E" :   // light green
  s >= 60 ? "#EAB308" :   // light yellow
  s >= 50 ? "#D97706" :   // yellow / amber
            "#DC2626";    // red

export function ScoreGauge({ score = 0, size = 190, stroke = 14, label = "GEO SCORE" }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const col = colorFor(score);
  return (
    <div className="relative inline-flex items-center justify-center" data-testid="score-gauge">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <motion.span
          className="font-head font-extrabold tabular-nums"
          style={{ fontSize: size * 0.28, color: col }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          data-testid="score-value"
        >
          {Math.round(score)}
        </motion.span>
        <span className="text-[10px] tracking-[0.2em] uppercase font-bold text-muted-foreground mt-1">{label}</span>
      </div>
    </div>
  );
}

export function scoreColor(s) { return colorFor(s); }
