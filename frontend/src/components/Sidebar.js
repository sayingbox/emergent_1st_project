import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { LayoutDashboard, Globe, Activity, Link2, MessageSquare, FileText, LogOut } from "lucide-react";

const groups = [
  {
    label: "Overview",
    items: [
      { to: "/app", label: "Dashboard", icon: LayoutDashboard },
      { to: "/app/domain", label: "Domain Analysis", icon: Globe },
    ],
  },
  {
    label: "Generative Engine (GEO)",
    items: [
      { to: "/app/visibility", label: "Visibility Tracker", icon: Activity },
      { to: "/app/citations", label: "Citation Sources", icon: Link2 },
      { to: "/app/reddit", label: "Reddit Finder", icon: MessageSquare },
    ],
  },
  {
    label: "Answer Engine (AEO)",
    items: [{ to: "/app/optimizer", label: "Content Optimizer", icon: FileText }],
  },
];

export function Sidebar() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const isActive = (to) => (to === "/app" ? pathname === "/app" : pathname.startsWith(to));

  return (
    <aside className="hidden lg:flex flex-col w-64 shrink-0 h-screen sticky top-0 bg-[#0b0b0f] text-zinc-300 border-r border-white/5">
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-white/5">
        <img src="/logo.png" alt="Citetail logo" className="w-9 h-9 object-contain" />
        <div className="leading-tight">
          <div className="font-head font-extrabold text-white text-lg tracking-tight">Cite<span className="text-[#18C090]">tail</span></div>
          <div className="text-[10px] text-zinc-500">AI Answer Visibility</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-6">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 mb-2 text-[10px] tracking-[0.18em] uppercase font-bold text-zinc-500">{g.label}</div>
            <div className="space-y-1">
              {g.items.map((it) => {
                const active = isActive(it.to);
                return (
                  <Link key={it.to} to={it.to} data-testid={`nav-${it.label.toLowerCase().replace(/\s+/g, "-")}`}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium border-l-2 transition-colors duration-150 ${active ? "bg-[#18C090]/10 text-white border-[#18C090]" : "text-zinc-400 border-transparent hover:text-white hover:bg-white/5"}`}>
                    <it.icon size={18} strokeWidth={active ? 2.4 : 2} className={active ? "text-[#18C090]" : ""} /> {it.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-white/5">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-[#18C090] text-white grid place-items-center text-xs font-bold">
            {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-white truncate">{user?.name}</div>
            <div className="text-[10px] text-zinc-500 truncate" data-testid="sidebar-email">{user?.email}</div>
          </div>
          <button data-testid="logout-btn" onClick={async () => { await logout(); navigate("/login"); }}
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"><LogOut size={16} /></button>
        </div>
      </div>
    </aside>
  );
}

export function MobileTopbar() {
  const { pathname } = useLocation();
  const flat = groups.flatMap((g) => g.items);
  return (
    <div className="lg:hidden sticky top-0 z-40 bg-[#0b0b0f] text-white border-b border-white/10">
      <div className="h-14 px-4 flex items-center gap-2">
        <img src="/logo.png" alt="Citetail logo" className="w-7 h-7 object-contain" />
        <span className="font-head font-extrabold tracking-tight">Cite<span className="text-[#18C090]">tail</span></span>
      </div>
      <div className="flex gap-1 overflow-x-auto px-3 pb-2">
        {flat.map((it) => {
          const active = it.to === "/app" ? pathname === "/app" : pathname.startsWith(it.to);
          return (
            <Link key={it.to} to={it.to}
              className={`whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium ${active ? "bg-[#18C090] text-white" : "text-zinc-400"}`}>
              {it.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
