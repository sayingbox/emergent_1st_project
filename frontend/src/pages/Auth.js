import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export default function Auth() {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = mode === "login" ? await login(email, password, remember) : await register(name, email, password);
    setLoading(false);
    if (res.ok) {
      toast.success(mode === "login" ? "Welcome back" : "Account created");
      // Route paid users into /app; pending-payment users to /app/upgrade
      const ent = res.user?.entitlements;
      const admin = res.user?.full_access;
      if (!admin && ent && !ent.is_active) navigate("/app/upgrade");
      else navigate("/app");
    } else toast.error(res.error);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between relative overflow-hidden bg-[#0B0B0F] p-12">
        <div className="absolute -top-32 -left-24 w-[520px] h-[520px] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(99, 102, 241,0.45) 0%, rgba(99, 102, 241,0) 70%)" }} />
        <div className="absolute bottom-0 right-0 w-[420px] h-[420px] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(99, 102, 241,0.35) 0%, rgba(99, 102, 241,0) 70%)" }} />
        <div className="relative flex items-center gap-2.5">
          <img src="/logo.png" alt="Citetail logo" className="w-10 h-10 object-contain" />
          <span className="font-head font-extrabold text-2xl tracking-tight text-white">Cite<span className="gradient-text">tail</span></span>
        </div>
        <div className="relative text-white">
          <h2 className="font-head text-4xl font-extrabold tracking-tight leading-tight">Rank in the age of<br/>AI answers.</h2>
          <p className="text-white/60 mt-4 max-w-md text-base">Score any page for Generative &amp; Answer Engine Optimization. See exactly how ChatGPT, Perplexity, Claude and Gemini would cite you — and fix what they can&apos;t.</p>
          <div className="flex items-center gap-6 mt-8">
            {["Crawl-first analysis", "Verified citations", "Live AI rankings"].map((t) => (
              <div key={t} className="flex items-center gap-2 text-sm text-white/70">
                <span className="w-1.5 h-1.5 rounded-full bg-[#6366F1]" /> {t}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <img src="/logo.png" alt="Citetail logo" className="w-9 h-9 object-contain" />
            <span className="font-head font-extrabold text-xl tracking-tight">Cite<span className="text-[#6366F1]">tail</span></span>
          </div>
          <h1 className="font-head text-3xl font-extrabold tracking-tight">{mode === "login" ? "Sign in" : "Create account"}</h1>
          <p className="text-muted-foreground text-sm mt-2 mb-8">{mode === "login" ? "Access your analyses and score history." : "Start scoring content in seconds."}</p>

          <form onSubmit={submit} className="space-y-4" data-testid="auth-form">
            {mode === "register" && (
              <div>
                <Label className="mb-1.5 block">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" data-testid="name-input" />
              </div>
            )}
            <div>
              <Label className="mb-1.5 block">Email</Label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" data-testid="email-input" />
            </div>
            <div>
              <Label className="mb-1.5 block">Password</Label>
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" data-testid="password-input" />
            </div>
            {mode === "login" && (
              <label className="flex items-center gap-2 cursor-pointer select-none" data-testid="remember-me-label">
                <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} data-testid="remember-me-checkbox" />
                <span className="text-sm text-muted-foreground">Keep me signed in for 15 days</span>
              </label>
            )}
            <Button type="submit" disabled={loading} className="w-full btn-brand transition-all" data-testid="auth-submit">
              {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground mt-6">
            {mode === "login" ? (
              <>New here? <a className="font-semibold text-[#129E75] underline underline-offset-4" href="/pricing" data-testid="link-pricing">See plans &amp; sign up</a></>
            ) : (
              <>Already have an account? <button className="font-semibold text-[#129E75] underline underline-offset-4" data-testid="toggle-mode"
                onClick={() => setMode("login")}>Sign in</button></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
