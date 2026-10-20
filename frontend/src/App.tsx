import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AegisProvider } from "./context/AegisContext";
import { LandingPage } from "./pages/LandingPage";
import { AppLayout } from "./components/AppLayout";
import { WelcomeView } from "./pages/WelcomeView";
import { VaultView } from "./pages/VaultView";
import { PolicyView } from "./pages/PolicyView";
import { DashboardView } from "./pages/DashboardView";
import { RedTeamView } from "./pages/RedTeamView";
import { HistoryView } from "./pages/HistoryView";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AegisProvider>
        <BrowserRouter>
          <Routes>
            {/* Landing Page */}
            <Route path="/" element={<LandingPage />} />

            {/* App Sub-Routes */}
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<WelcomeView />} />
              <Route path="welcome" element={<WelcomeView />} />
              <Route path="vault" element={<VaultView />} />
              <Route path="policy" element={<PolicyView />} />
              <Route path="dashboard" element={<DashboardView />} />
              <Route path="red-team" element={<RedTeamView />} />
              <Route path="history" element={<HistoryView />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AegisProvider>
    </QueryClientProvider>
  );
}
