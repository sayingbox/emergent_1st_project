import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { http, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ShieldCheck, KeyRound, Loader2, Mail } from "lucide-react";

/*
 * Admin auth flow — completely separate from the standard user signup at /login.
 * Available at /admin/auth with three modes: register, login, reset.
 * - Registration is restricted to the allowed admin email domain (fetched from
 *   /api/admin/config). A 6-digit OTP is emailed to the admin approval inbox
 *   (NOT to the registering user), and must be entered here to complete signup.
 * - Login enforces a 30-day password rotation; the backend returns 403 with
 *   detail=`password_reset_required` once the current password is older than
 *   30 days — this UI switches to reset mode automatically.
 * - Reset also sends an OTP to the same approval inbox, never to the user.
 */

export default function AdminAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshUser } = useAuth();
  const [cfg, setCfg] = useState(null);
  const initialMode = location.pathname === "/admin/register" ? "register"
    : location.pathname === "/admin/reset" ? "reset" : "login";
  const [mode, setMode] = useState(initialMode); // login | register | reset
  const [stage, setStage] = useState("form"); // form | otp
  const [form, setForm] = useState({ name: "", email: "", password: "", newPassword: "" });
  const [otp, setOtp] = useState("");
  const [otpMeta, setOtpMeta] = useState(null); // { delivered_to, expires_in }
  const [loading, setLoading] = useState(false);

  useEffect(() => { http.get("/admin/config").then((r) => setCfg(r.data)).catch(() => {}); }, []);

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const domain = cfg?.allowed_domain || "citetail.com";
  const inbox = cfg?.otp_delivered_to || "admin@citetail.com";
  const sessionDays = cfg?.session_days || 30;

  const err = (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message || "Request failed");

  const startRegister = async () => {
    if (!form.email.toLowerCase().endsWith(`@${domain}`)) {
      toast.error(`Admin email must end in @${domain}`); return;
    }
    if (form.password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (form.name.trim().length < 1) { toast.error("Enter your name"); return; }
    setLoading(true);
    try {
      const { data } = await http.post("/admin/register/request-otp", {
        email: form.email, password: form.password, name: form.name,
      });
      setOtpMeta(data); setStage("otp");
      toast.success(`OTP sent to ${data.delivered_to}`);
    } catch (e) { err(e); } finally { setLoading(false); }
  };

  const verifyRegister = async () => {
    if (otp.length !== 6) { toast.error("Enter the 6-digit OTP"); return; }
    setLoading(true);
    try {
      await http.post("/admin/register/verify-otp", { otp });
      toast.success("Admin account created");
      if (refreshUser) await refreshUser();
      navigate("/app");
    } catch (e) { err(e); } finally { setLoading(false); }
  };

  const doLogin = async () => {
    if (!form.email || !form.password) { toast.error("Email and password required"); return; }
    setLoading(true);
    try {
      await http.post("/admin/login", { email: form.email, password: form.password });
      toast.success("Signed in");
      if (refreshUser) await refreshUser();
      navigate("/app");
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (detail === "password_reset_required") {
        toast.info("Password expired — please reset it via OTP");
        setMode("reset"); setStage("form");
      } else {
        err(e);
      }
    } finally { setLoading(false); }
  };

  const startReset = async () => {
    if (!form.email.toLowerCase().endsWith(`@${domain}`)) {
      toast.error(`Admin email must end in @${domain}`); return;
    }
    if (form.newPassword.length < 8) { toast.error("New password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      const { data } = await http.post("/admin/password-reset/request-otp", { email: form.email });
      setOtpMeta(data); setStage("otp");
      toast.success(`OTP sent to ${data.delivered_to}`);
    } catch (e) { err(e); } finally { setLoading(false); }
  };

  const verifyReset = async () => {
    if (otp.length !== 6) { toast.error("Enter the 6-digit OTP"); return; }
    setLoading(true);
    try {
      await http.post("/admin/password-reset/verify-otp", {
        email: form.email, otp, new_password: form.newPassword,
      });
      toast.success("Password reset and signed in");
      if (refreshUser) await refreshUser();
      navigate("/app");
    } catch (e) { err(e); } finally { setLoading(false); }
  };

  const onSwitchMode = (m) => { setMode(m); setStage("form"); setOtp(""); };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      {/* Left hero */}
      <div className="hidden lg:flex flex-col justify-between relative overflow-hidden bg-[#0B0B0F] p-12">
        <div className="absolute -top-32 -left-24 w-[520px] h-[520px] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(16,185,129,0.35) 0%, rgba(16,185,129,0) 70%)" }} />
        <div className="relative flex items-center gap-2.5 text-white">
          <ShieldCheck className="w-10 h-10 text-emerald-400" />
          <span className="font-head font-extrabold text-2xl tracking-tight">Citetail <span className="text-emerald-400">Admin</span></span>
        </div>
        <div className="relative text-white">
          <h2 className="font-head text-4xl font-extrabold tracking-tight leading-tight">Restricted access.<br/>Approval required.</h2>
          <p className="text-white/60 mt-4 max-w-md text-base">
            Admin accounts are limited to <b>@{domain}</b> emails and every registration or password reset must be approved by an OTP delivered to <b>{inbox}</b>. Sessions rotate every {sessionDays} days.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/70">
            <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Domain-locked signup</li>
            <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> OTP goes to the approval mailbox</li>
            <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {sessionDays}-day password rotation</li>
          </ul>
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <ShieldCheck className="w-9 h-9 text-emerald-500" />
            <span className="font-head font-extrabold text-xl tracking-tight">Citetail Admin</span>
          </div>

          <h1 className="font-head text-3xl font-extrabold tracking-tight">Admin access</h1>
          <p className="text-muted-foreground text-sm mt-2 mb-6">Not an admin? <a className="underline underline-offset-2" href="/login">Use standard sign-in</a>.</p>

          <Tabs value={mode} onValueChange={onSwitchMode} className="mb-6">
            <TabsList className="w-full grid grid-cols-3" data-testid="admin-mode-tabs">
              <TabsTrigger value="login" data-testid="admin-tab-login">Sign in</TabsTrigger>
              <TabsTrigger value="register" data-testid="admin-tab-register">Register</TabsTrigger>
              <TabsTrigger value="reset" data-testid="admin-tab-reset">Reset</TabsTrigger>
            </TabsList>

            {/* LOGIN */}
            <TabsContent value="login" className="mt-6 space-y-4">
              <div>
                <Label>Email</Label>
                <Input type="email" placeholder={`you@${domain}`} value={form.email} onChange={setField("email")} data-testid="admin-login-email" />
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" placeholder="••••••••" value={form.password} onChange={setField("password")} onKeyDown={(e) => e.key === "Enter" && doLogin()} data-testid="admin-login-password" />
              </div>
              <Button className="w-full btn-brand" onClick={doLogin} disabled={loading} data-testid="admin-login-submit">
                {loading ? <Loader2 className="animate-spin" size={16} /> : <><KeyRound size={16} className="mr-2" />Sign in as admin</>}
              </Button>
            </TabsContent>

            {/* REGISTER */}
            <TabsContent value="register" className="mt-6 space-y-4">
              {stage === "form" ? (
                <>
                  <div>
                    <Label>Full name</Label>
                    <Input value={form.name} onChange={setField("name")} data-testid="admin-register-name" />
                  </div>
                  <div>
                    <Label>Email (must be @{domain})</Label>
                    <Input type="email" placeholder={`you@${domain}`} value={form.email} onChange={setField("email")} data-testid="admin-register-email" />
                  </div>
                  <div>
                    <Label>Password (min 8 chars)</Label>
                    <Input type="password" placeholder="••••••••" value={form.password} onChange={setField("password")} data-testid="admin-register-password" />
                  </div>
                  <Button className="w-full btn-brand" onClick={startRegister} disabled={loading} data-testid="admin-register-submit">
                    {loading ? <Loader2 className="animate-spin" size={16} /> : <><Mail size={16} className="mr-2" />Send approval OTP</>}
                  </Button>
                  <p className="text-xs text-muted-foreground">OTP is emailed to <b>{inbox}</b> (the approval mailbox), never to the registering address.</p>
                </>
              ) : (
                <OtpEnter
                  otp={otp} setOtp={setOtp} meta={otpMeta} inbox={inbox}
                  onSubmit={verifyRegister} onBack={() => setStage("form")} loading={loading}
                  testId="admin-register-otp"
                />
              )}
            </TabsContent>

            {/* RESET */}
            <TabsContent value="reset" className="mt-6 space-y-4">
              {stage === "form" ? (
                <>
                  <div>
                    <Label>Admin email (@{domain})</Label>
                    <Input type="email" placeholder={`you@${domain}`} value={form.email} onChange={setField("email")} data-testid="admin-reset-email" />
                  </div>
                  <div>
                    <Label>New password (min 8 chars)</Label>
                    <Input type="password" placeholder="••••••••" value={form.newPassword} onChange={setField("newPassword")} data-testid="admin-reset-newpassword" />
                  </div>
                  <Button className="w-full btn-brand" onClick={startReset} disabled={loading} data-testid="admin-reset-submit">
                    {loading ? <Loader2 className="animate-spin" size={16} /> : <><Mail size={16} className="mr-2" />Send reset OTP</>}
                  </Button>
                  <p className="text-xs text-muted-foreground">OTP is emailed to <b>{inbox}</b>, not to the user resetting the password.</p>
                </>
              ) : (
                <OtpEnter
                  otp={otp} setOtp={setOtp} meta={otpMeta} inbox={inbox}
                  onSubmit={verifyReset} onBack={() => setStage("form")} loading={loading}
                  testId="admin-reset-otp"
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function OtpEnter({ otp, setOtp, meta, inbox, onSubmit, onBack, loading, testId }) {
  return (
    <>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 p-4 flex gap-3">
        <Mail className="shrink-0 mt-0.5" size={18} />
        <div className="text-sm">
          <p><b>OTP sent to {meta?.delivered_to || inbox}</b></p>
          <p className="text-emerald-900/70">Expires in {Math.round((meta?.expires_in || 600) / 60)} minutes.</p>
        </div>
      </div>
      <div>
        <Label>6-digit OTP</Label>
        <Input
          inputMode="numeric" maxLength={6} pattern="[0-9]{6}"
          className="tracking-[0.5em] text-center font-mono text-xl"
          value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          data-testid={testId}
        />
      </div>
      <Button className="w-full btn-brand" onClick={onSubmit} disabled={loading} data-testid={`${testId}-submit`}>
        {loading ? <Loader2 className="animate-spin" size={16} /> : "Verify & continue"}
      </Button>
      <button type="button" onClick={onBack} className="text-xs text-muted-foreground underline underline-offset-2">Back</button>
    </>
  );
}
