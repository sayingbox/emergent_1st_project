import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { http } from "@/lib/api";
import { LayoutDashboard, Globe, Activity, Link2, MessageSquare, FileText, LogOut, FolderKanban, Heart, Bot, ShieldCheck, Newspaper, Lock } from "lucide-react";

const groups = [
  {
    label: "Overview",
    items: [
      { to: "/app", label: "Dashboard", icon: LayoutDashboard },
      { to: "/app/projects", label: "Projects", icon: FolderKanban },
      { to: "/app/domain", label: "Domain Analysis", icon: Globe, feature: "domain" },
    ],
  },
  {
    label: "Generative Engine (GEO)",
    items: [
      { to: "/app/visibility", label: "Visibility Tracker", icon: Activity, feature: "visibility" },
      { to: "/app/citations", label: "Citation Sources", icon: Link2, feature: "citations" },
      { to: "/app/sentiment", label: "Sentiment Analysis", icon: Heart, feature: "sentiment" },
      { to: "/app/reddit", label: "Reddit Finder", icon: MessageSquare, feature: "reddit" },
      { to: "/app/brand", label: "Brand Consistency", icon: ShieldCheck, feature: "brand" },
      { to: "/app/pr", label: "PR Coverage", icon: Newspaper, feature: "pr" },
    ],
  },
  {
    label: "Answer Engine (AEO)",
    items: [
      { to: "/app/optimizer", label: "Content Optimizer", icon: FileText, feature: "aeo" },
    ],
  },
  {
    label: "Assistant",
    items: [
      { to: "/app/agent", label: "AI Agent", icon: Bot, badgeKey: "alerts", feature: "agent" },
    ],
  },
];

export function Sidebar() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  const isActive = (to) => (to === "/app" ? pathname === "/app" : pathname.startsWith(to));

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      http.get("/alerts").then((r) => {
        if (!cancelled) setUnread(r.data?.unread_count || 0);
      }).catch(() => {});
    };
    load();
    const iv = setInterval(load, 60000); // refresh every 60s
    return () => { cancelled = true; clearInterval(iv); };
  }, [pathname]);

  return (
    <aside className="hidden lg:flex flex-col w-64 shrink-0 h-screen sticky top-0 sidebar-rail text-slate-600 border-r border-slate-200">
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-slate-200">
        <img src="/logo.png" alt="Citetail logo" className="w-9 h-9 object-contain" />
        <div className="leading-tight">
          <div className="font-head font-extrabold text-lg tracking-tight">
            <span className="text-slate-900">Cite</span><span className="gradient-text">tail</span>
          </div>
          <div className="text-[10px] text-slate-400 tracking-wider uppercase">AI Answer Visibility</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-4">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 mb-1.5 text-[10px] tracking-[0.16em] uppercase font-bold text-slate-400">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((it) => {
                const active = isActive(it.to);
                const badgeCount = it.badgeKey === "alerts" ? unread : 0;
                const features = user?.entitlements?.features || [];
                const fullAccess = user?.full_access;
                const locked = !fullAccess && it.feature && !features.includes(it.feature);
                if (locked) {
                  return (
                    <Link key={it.to} to="/app/upgrade" data-testid={`nav-locked-${it.feature}`}
                      className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                      <it.icon size={16} strokeWidth={2} className="text-slate-300" />
                      <span className="flex-1">{it.label}</span>
                      <Lock size={12} className="text-slate-400" />
                    </Link>
                  );
                }
                return (
                  <Link key={it.to} to={it.to} data-testid={`nav-${it.label.toLowerCase().replace(/\s+/g, "-")}`}
                    className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${active ? "nav-active-glow" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"}`}>
                    <it.icon size={16} strokeWidth={active ? 2.4 : 2} className={active ? "text-[#6366F1]" : "text-slate-400"} />
                    <span className="flex-1">{it.label}</span>
                    {badgeCount > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold grid place-items-center">
                        {badgeCount > 9 ? "9+" : badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-slate-200">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full sidebar-avatar text-white grid place-items-center text-xs font-bold">
            {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-800 truncate">{user?.name}</div>
            <div className="text-[10px] text-slate-400 truncate" data-testid="sidebar-email">{user?.email}</div>
          </div>
          <button data-testid="logout-btn" onClick={async () => { await logout(); navigate("/login"); }}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"><LogOut size={16} /></button>
        </div>
      </div>
    </aside>
  );
}

export function MobileTopbar() {
  const { pathname } = useLocation();
  const flat = groups.flatMap((g) => g.items);
  return (
    <div className="lg:hidden sticky top-0 z-40 bg-white text-slate-800 border-b border-slate-200 shadow-sm">
      <div className="h-14 px-4 flex items-center gap-2">
        <img src="/logo.png" alt="Citetail logo" className="w-7 h-7 object-contain" />
        <span className="font-head font-extrabold tracking-tight text-lg">
          <span className="text-slate-900">Cite</span><span className="gradient-text">tail</span>
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto px-3 pb-2">
        {flat.map((it) => {
          const active = it.to === "/app" ? pathname === "/app" : pathname.startsWith(it.to);
          return (
            <Link key={it.to} to={it.to}
              className={`whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium ${active ? "bg-[#6366F1] text-white shadow-[0_4px_16px_-4px_rgba(99,102,241,0.6)]" : "text-slate-500 hover:bg-slate-100"}`}>
              {it.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
