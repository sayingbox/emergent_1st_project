import { useLocation } from "react-router-dom";
import { Sidebar, MobileTopbar } from "@/components/Sidebar";

export function Layout({ children }) {
  const location = useLocation();
  return (
    <div className="min-h-screen flex app-bg">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileTopbar />
        <main key={location.pathname} className="flex-1 px-5 sm:px-8 py-8 max-w-6xl w-full mx-auto animate-rise">
          {children}
        </main>
      </div>
    </div>
  );
}
