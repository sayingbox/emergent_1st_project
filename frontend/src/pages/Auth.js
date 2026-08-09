import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Gauge } from "lucide-react";
import { toast } from "sonner";

export default function Auth() {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = mode === "login" ? await login(email, password) : await register(name, email, password);
    setLoading(false);
    if (res.ok) { toast.success(mode === "login" ? "Welcome back" : "Account created"); navigate("/app"); }
    else toast.error(res.error);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:block relative bg-black">
        <img src="https://images.unsplash.com/photo-1454117096348-e4abbeba002c?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Njd8MHwxfHNlYXJjaHwxfHxtaW5pbWFsJTIwYWJzdHJhY3QlMjBnZW9tZXRyaWMlMjB3aGl0ZXxlbnwwfHx8fDE3ODYzMDQyMzJ8MA&ixlib=rb-4.1.0&q=85"
          alt="abstract" className="absolute inset-0 w-full h-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-black/10" />
        <div className="absolute bottom-0 p-12 text-white">
          <h2 className="font-head text-4xl font-extrabold tracking-tight leading-tight">Rank in the age of<br/>AI answers.</h2>
          <p className="text-white/70 mt-4 max-w-md text-base">Score any page for Generative & Answer Engine Optimization. See exactly how ChatGPT, Perplexity and Google AI would cite you — and fix what they can't.</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-9 h-9 bg-black text-white grid place-items-center rounded-md"><Gauge size={20} /></div>
            <span className="font-head font-extrabold text-xl tracking-tight">GEO<span className="text-[#002FA7]">rank</span></span>
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
            <Button type="submit" disabled={loading} className="w-full bg-black text-white hover:bg-gray-800" data-testid="auth-submit">
              {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground mt-6">
            {mode === "login" ? "New here? " : "Already have an account? "}
            <button className="font-semibold text-black underline underline-offset-4" data-testid="toggle-mode"
              onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
