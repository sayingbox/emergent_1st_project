import { Sidebar, MobileTopbar } from "@/components/Sidebar";

export function Layout({ children }) {
  return (
    <div className="min-h-screen flex app-bg">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileTopbar />
        <main className="flex-1 px-5 sm:px-8 py-8 max-w-6xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
