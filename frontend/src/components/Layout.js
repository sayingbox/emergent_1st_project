import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Gauge, LogOut, History as HistoryIcon, LayoutDashboard } from "lucide-react";

export function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const nav = [
    { to: "/app", label: "Analyze", icon: LayoutDashboard },
    { to: "/app/history", label: "History", icon: HistoryIcon },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/70 border-b border-border/60 backdrop-saturate-150">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/app" className="flex items-center gap-2" data-testid="brand-logo">
            <div className="w-8 h-8 bg-black text-white grid place-items-center rounded-md">
              <Gauge size={18} />
            </div>
            <span className="font-head font-extrabold text-lg tracking-tight">GEO<span className="text-[#002FA7]">rank</span></span>
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((n) => {
              const active = pathname === n.to;
              return (
                <Link key={n.to} to={n.to} data-testid={`nav-${n.label.toLowerCase()}`}
                  className={`px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${active ? "bg-black text-white" : "text-muted-foreground hover:bg-muted"}`}>
                  <n.icon size={16} /> <span className="hidden sm:inline">{n.label}</span>
                </Link>
              );
            })}
            <div className="w-px h-6 bg-border mx-2" />
            <span className="text-sm text-muted-foreground hidden md:inline mr-1" data-testid="user-email">{user?.email}</span>
            <Button variant="ghost" size="sm" data-testid="logout-btn"
              onClick={async () => { await logout(); navigate("/login"); }}>
              <LogOut size={16} />
            </Button>
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}
