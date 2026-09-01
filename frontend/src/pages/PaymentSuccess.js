import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { http, formatApiErrorDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

/*
 * Stripe redirects here with ?session_id=cs_test_... on success.
 * We poll /api/subscriptions/status/<id> until it flips to "paid".
 * On success the backend has already extended plan_expires_at by 30 days.
 */

export default function PaymentSuccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = params.get("session_id") || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("citetail:last_session_id") : null);
  const [status, setStatus] = useState({ state: "polling", plan: null, error: null });

  useEffect(() => {
    if (!sessionId) { setStatus({ state: "error", error: "Missing session id" }); return; }
    let cancelled = false;
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const { data } = await http.get(`/subscriptions/status/${sessionId}`);
        if (cancelled) return;
        if (data.payment_status === "paid") {
          setStatus({ state: "paid", plan: data.plan });
          try { sessionStorage.removeItem("citetail:last_session_id"); } catch { /* ignore */ }
          return;
        }
        if (["failed", "expired"].includes(data.payment_status) || attempts >= 30) {
          setStatus({ state: "failed", error: data.payment_status });
          return;
        }
        setTimeout(poll, 2000);
      } catch (e) {
        if (cancelled) return;
        setStatus({ state: "error", error: formatApiErrorDetail(e.response?.data?.detail) || "Status check failed" });
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [sessionId]);

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <div className="max-w-md w-full bg-white border border-border/60 rounded-2xl p-10 text-center" data-testid="payment-success">
        {status.state === "polling" && (
          <>
            <Loader2 className="animate-spin mx-auto mb-4 text-indigo-500" size={40} />
            <h1 className="font-head text-2xl font-extrabold tracking-tight">Confirming your payment…</h1>
            <p className="text-sm text-muted-foreground mt-2">This usually takes a few seconds. Please don't close this tab.</p>
          </>
        )}
        {status.state === "paid" && (
          <>
            <CheckCircle2 className="mx-auto mb-4 text-emerald-500" size={44} />
            <h1 className="font-head text-2xl font-extrabold tracking-tight">You're in — welcome to Citetail</h1>
            <p className="text-sm text-muted-foreground mt-2">Your <b className="capitalize">{status.plan}</b> plan is active for the next 30 days.</p>
            <Button
              onClick={async () => {
                // Force a fresh session probe so the app picks up new entitlements
                try { await http.get("/auth/me"); } catch { /* ignore */ }
                navigate("/app");
              }}
              className="mt-8 btn-brand hover:opacity-90"
              data-testid="payment-success-cta"
            >
              Go to dashboard
            </Button>
          </>
        )}
        {(status.state === "failed" || status.state === "error") && (
          <>
            <XCircle className="mx-auto mb-4 text-red-500" size={44} />
            <h1 className="font-head text-2xl font-extrabold tracking-tight">Payment didn't complete</h1>
            <p className="text-sm text-muted-foreground mt-2">{status.error === "expired" ? "The checkout session expired." : "We couldn't confirm the payment. Try again or contact support."}</p>
            <div className="flex gap-3 justify-center mt-8">
              <Button variant="outline" onClick={() => navigate("/pricing")}>Pick a plan</Button>
              <Button className="btn-brand" onClick={() => navigate("/login")}>Sign in</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
