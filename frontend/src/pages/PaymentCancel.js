import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function PaymentCancel() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const plan = params.get("plan");
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <div className="max-w-md w-full bg-white border border-border/60 rounded-2xl p-10 text-center" data-testid="payment-cancel">
        <AlertCircle className="mx-auto mb-4 text-amber-500" size={44} />
        <h1 className="font-head text-2xl font-extrabold tracking-tight">Checkout cancelled</h1>
        <p className="text-sm text-muted-foreground mt-2">No charge was made. You can complete your payment any time by signing in.</p>
        <div className="flex gap-3 justify-center mt-8">
          <Button variant="outline" onClick={() => navigate("/pricing")}>Change plan</Button>
          <Button className="btn-brand" onClick={() => navigate(`/signup${plan ? `?plan=${plan}` : ""}`)}>Try again</Button>
        </div>
      </div>
    </div>
  );
}
