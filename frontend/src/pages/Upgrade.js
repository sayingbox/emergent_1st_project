import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ArrowRight, Sparkles, ShieldCheck, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui-bits";
import { toast } from "sonner";

/*
 * In-app upgrade / renew page. Sends the signed-in user to a fresh Stripe
 * checkout for the picked plan. On return their access window is extended
 * by 30 days (webhook or /status poll — whichever wins).
 */

export default function Upgrade() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const currentPlan = user?.entitlements?.plan;
  const isActive = user?.entitlements?.is_active;

  useEffect(() => {
    http.get("/subscriptions/plans").then((r) => setPlans(r.data.plans || [])).catch(() => {});
  }, []);

  const start = async (slug) => {
    setLoading(slug);
    try {
      const { data } = await http.post("/subscriptions/upgrade", {
        plan: slug, origin_url: window.location.origin,
      });
      try { sessionStorage.setItem("citetail:last_session_id", data.session_id); } catch { /* ignore */ }
      window.location.href = data.checkout_url;
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not start checkout");
      setLoading(null);
    }
  };

  return (
    <div>
      <PageHeader
        overline="Subscription"
        title={isActive ? "Change plan or extend" : "Choose a plan"}
        subtitle={isActive
          ? `You're on the ${user?.entitlements?.plan_name || "—"} plan (${user?.entitlements?.days_remaining} days remaining). Upgrade to unlock more features, or renew to extend by 30 days.`
          : "Pick a plan to unlock scans, citations, and AI answer visibility. Payment is one-time each month — no surprise renewals."}
      />

      <div className="grid md:grid-cols-3 gap-6">
        {plans.map((p) => {
          const isCurrent = currentPlan === p.slug && isActive;
          const isHighlighted = p.slug === "growth";
          return (
            <Card
              key={p.slug}
              data-testid={`upgrade-plan-${p.slug}`}
              className={`relative p-7 rounded-2xl transition-transform duration-200 hover:-translate-y-1 ${isHighlighted ? "border-2 border-indigo-500 bg-white" : "border-border/60"}`}
            >
              {isCurrent && <Badge className="absolute -top-3 left-6 bg-emerald-500 text-white border-0 rounded-md">Current plan</Badge>}
              {isHighlighted && !isCurrent && <Badge className="absolute -top-3 left-6 bg-indigo-600 text-white border-0 rounded-md">Most popular</Badge>}
              <h3 className="font-head text-2xl font-extrabold tracking-tight">{p.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">{p.tagline}</p>
              <div className="mt-6 flex items-end gap-1">
                <span className="font-head text-4xl font-extrabold">${p.price_usd}</span>
                <span className="text-sm text-muted-foreground pb-1.5">/ month</span>
              </div>
              <ul className="mt-6 space-y-2 text-sm">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-2 items-start"><Check size={16} className="text-emerald-500 mt-0.5 shrink-0" /><span>{h}</span></li>
                ))}
              </ul>
              <Button
                data-testid={`upgrade-cta-${p.slug}`}
                onClick={() => start(p.slug)}
                disabled={loading === p.slug}
                className={`w-full mt-6 ${isHighlighted ? "btn-brand hover:opacity-90" : ""}`}
                variant={isHighlighted ? "default" : "outline"}
              >
                {loading === p.slug ? <Loader2 className="animate-spin" size={16} /> : (
                  <>
                    <Sparkles size={14} className="mr-2" />
                    {isCurrent ? "Renew for 30 days" : `Switch to ${p.name}`}
                    <ArrowRight size={14} className="ml-2" />
                  </>
                )}
              </Button>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground mt-8 flex items-center gap-1.5"><ShieldCheck size={12} className="text-emerald-500" /> Every payment unlocks 30 days of access. Nothing renews automatically — you're always in control.</p>
      <Button variant="ghost" className="mt-6" onClick={() => navigate("/app")}>← Back to dashboard</Button>
    </div>
  );
}
