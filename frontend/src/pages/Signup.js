import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { http, formatApiErrorDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { CreditCard, Loader2, ShieldCheck, ArrowLeft } from "lucide-react";

/*
 * Signup page: /signup?plan=starter|growth|pro
 * Creates a pending-payment account, then redirects to Stripe checkout.
 */

export default function Signup() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const planSlug = (searchParams.get("plan") || "growth").toLowerCase();
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    http.get("/subscriptions/plans").then((r) => setPlans(r.data.plans || [])).catch(() => {});
  }, []);
  const plan = plans.find((p) => p.slug === planSlug);

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      const { data } = await http.post("/subscriptions/register-and-checkout", {
        name: form.name, email: form.email, password: form.password,
        plan: planSlug, origin_url: window.location.origin,
      });
      // Persist session_id so the return URL can poll status even after Stripe redirect
      try { sessionStorage.setItem("citetail:last_session_id", data.session_id); } catch { /* ignore */ }
      window.location.href = data.checkout_url;
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Signup failed");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      <div className="hidden lg:flex flex-col justify-between relative overflow-hidden bg-[#0B0B0F] p-12 text-white">
        <a href="/pricing" className="relative flex items-center gap-2 text-white/70 hover:text-white text-sm w-fit"><ArrowLeft size={14} /> Back to pricing</a>
        <div className="relative">
          <h2 className="font-head text-4xl font-extrabold tracking-tight leading-tight">Create your Citetail account.</h2>
          <p className="text-white/60 mt-4 max-w-md">Payment is handled on Stripe's secure checkout. Your account activates automatically the moment payment succeeds.</p>
          {plan && (
            <Card className="bg-white/5 border-white/10 mt-8 p-6 text-white">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/50 font-bold">Selected plan</div>
              <div className="flex items-baseline justify-between mt-2">
                <span className="font-head text-2xl font-extrabold">{plan.name}</span>
                <span className="font-head text-3xl font-extrabold">${plan.price_usd}<span className="text-sm text-white/50">/mo</span></span>
              </div>
              <ul className="mt-4 text-sm space-y-2 text-white/80">
                {plan.highlights.map((h) => <li key={h}>· {h}</li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" data-testid="signup-form">
          <h1 className="font-head text-3xl font-extrabold tracking-tight">Start your {plan?.name || "plan"}</h1>
          <p className="text-muted-foreground text-sm">You'll be sent to Stripe to complete payment (${plan?.price_usd || "—"}/month).</p>
          <div>
            <Label>Full name</Label>
            <Input required value={form.name} onChange={setField("name")} data-testid="signup-name" />
          </div>
          <div>
            <Label>Email</Label>
            <Input required type="email" value={form.email} onChange={setField("email")} data-testid="signup-email" />
          </div>
          <div>
            <Label>Password (min 6 chars)</Label>
            <Input required type="password" value={form.password} onChange={setField("password")} data-testid="signup-password" />
          </div>
          <Button type="submit" className="w-full btn-brand hover:opacity-90" disabled={loading} data-testid="signup-submit">
            {loading ? <Loader2 className="animate-spin" size={16} /> : <><CreditCard size={16} className="mr-2" />Continue to secure checkout</>}
          </Button>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><ShieldCheck size={12} className="text-emerald-500" /> Card details never touch our servers — Stripe handles them.</p>
          <p className="text-xs text-muted-foreground">Already have an account? <a href="/login" className="underline">Sign in</a></p>
        </form>
      </div>
    </div>
  );
}
