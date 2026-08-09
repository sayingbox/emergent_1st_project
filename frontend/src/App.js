import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import AnalysisDetail from "@/pages/AnalysisDetail";
import History from "@/pages/History";
import { Toaster } from "@/components/ui/sonner";
import { Loader2 } from "lucide-react";

function Protected({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function LoginRoute() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  if (user) return <Navigate to="/app" replace />;
  return <Auth />;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/app" element={<Protected><Dashboard /></Protected>} />
            <Route path="/app/history" element={<Protected><History /></Protected>} />
            <Route path="/app/analysis/:id" element={<Protected><AnalysisDetail /></Protected>} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </div>
  );
}

export default App;
