import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, ArrowRight, ShieldCheck } from "lucide-react";

/*
 * Public pricing page — landing entry point. Clicking a plan sends the user
 * to /signup?plan=<slug>, which creates a pending-payment account and hands
 * off to Stripe checkout.
 */

export default function Pricing() {
  const [plans, setPlans] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    http.get("/subscriptions/plans").then((r) => setPlans(r.data.plans || [])).catch(() => {});
  }, []);

  const highlighted = "growth";

  return (
    <div className="min-h-screen bg-white">
      <nav className="max-w-6xl mx-auto flex items-center justify-between py-6 px-6">
        <a href="/" className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Citetail logo" className="w-9 h-9 object-contain" />
          <span className="font-head font-extrabold text-xl tracking-tight">
            <span className="text-slate-900">Cite</span><span className="gradient-text">tail</span>
          </span>
        </a>
        <div className="flex items-center gap-3">
          <a href="/login" className="text-sm text-slate-600 hover:text-slate-900" data-testid="pricing-signin">Sign in</a>
        </div>
      </nav>

      <header className="max-w-4xl mx-auto text-center px-6 pt-8 pb-14">
        <Badge className="rounded-md border-0 bg-indigo-50 text-indigo-700 mb-4">Pricing</Badge>
        <h1 className="font-head text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight">Rank in AI answers.<br />Pay only for what you scan.</h1>
        <p className="text-base sm:text-lg text-muted-foreground mt-5 max-w-2xl mx-auto">
          Every plan bills monthly at <b>$49, $99 or $199</b> and unlocks a full 30 days of scans. Cancel any time — no auto-charge you didn't ask for.
        </p>
      </header>

      <section className="max-w-6xl mx-auto px-6 pb-24 grid md:grid-cols-3 gap-6">
        {plans.map((p) => {
          const featured = p.slug === highlighted;
          return (
            <Card
              key={p.slug}
              data-testid={`plan-card-${p.slug}`}
              className={`relative p-8 rounded-2xl transition-transform duration-200 hover:-translate-y-1 ${featured ? "border-2 border-indigo-500 shadow-xl bg-white" : "border-border/60"}`}
            >
              {featured && (
                <span className="absolute -top-3 left-8 bg-indigo-600 text-white text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-md">Most popular</span>
              )}
              <h3 className="font-head font-extrabold text-2xl tracking-tight">{p.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">{p.tagline}</p>
              <div className="mt-6 flex items-end gap-1">
                <span className="font-head text-5xl font-extrabold">${p.price_usd}</span>
                <span className="text-sm text-muted-foreground pb-2">/ month</span>
              </div>
              <ul className="mt-6 space-y-3 text-sm">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-2 items-start"><Check size={16} className="text-emerald-500 mt-0.5 shrink-0" /><span>{h}</span></li>
                ))}
              </ul>
              <Button
                data-testid={`plan-cta-${p.slug}`}
                onClick={() => navigate(`/signup?plan=${p.slug}`)}
                className={`w-full mt-8 ${featured ? "btn-brand hover:opacity-90" : ""}`}
                variant={featured ? "default" : "outline"}
              >
                <Sparkles size={14} className="mr-2" /> Start {p.name} — ${p.price_usd}/mo
                <ArrowRight size={14} className="ml-2" />
              </Button>
            </Card>
          );
        })}
      </section>

      <footer className="border-t border-slate-100 py-8 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-2">
          <ShieldCheck size={14} className="text-emerald-500" /> Secure checkout by Stripe · test cards enabled
        </div>
      </footer>
    </div>
  );
}
