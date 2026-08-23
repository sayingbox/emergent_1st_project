import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";
import Auth from "@/pages/Auth";
import Overview from "@/pages/Overview";
import DomainAnalysis from "@/pages/DomainAnalysis";
import Visibility from "@/pages/Visibility";
import Citations from "@/pages/Citations";
import Reddit from "@/pages/Reddit";
import SentimentAnalysis from "@/pages/SentimentAnalysis";
import AiAgent from "@/pages/AiAgent";
import Optimizer from "@/pages/Dashboard";
import AnalysisDetail from "@/pages/AnalysisDetail";
import History from "@/pages/History";
import Projects from "@/pages/Projects";
import ProjectDetail from "@/pages/ProjectDetail";
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
            <Route path="/app" element={<Protected><Overview /></Protected>} />
            <Route path="/app/projects" element={<Protected><Projects /></Protected>} />
            <Route path="/app/projects/:id" element={<Protected><ProjectDetail /></Protected>} />
            <Route path="/app/domain" element={<Protected><DomainAnalysis /></Protected>} />
            <Route path="/app/visibility" element={<Protected><Visibility /></Protected>} />
            <Route path="/app/citations" element={<Protected><Citations /></Protected>} />
            <Route path="/app/sentiment" element={<Protected><SentimentAnalysis /></Protected>} />
            <Route path="/app/reddit" element={<Protected><Reddit /></Protected>} />
            <Route path="/app/optimizer" element={<Protected><Optimizer /></Protected>} />
            <Route path="/app/agent" element={<Protected><AiAgent /></Protected>} />
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
