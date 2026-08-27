import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import Layout from './components/Layout';
import { useAuthStore } from './store/authStore';
import { RequireRole } from './components/RequireRole';

import Login from './pages/Login';
import Landing from './pages/Landing';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Detection = lazy(() => import('./pages/Detection'));
const LiveMonitoring = lazy(() => import('./pages/LiveMonitoring'));
const AlertsReports = lazy(() => import('./pages/AlertsReports'));
const AnalyticsMerged = lazy(() => import('./pages/AnalyticsMerged'));
const SettingsMerged = lazy(() => import('./pages/SettingsMerged'));
const ProfileMerged = lazy(() => import('./pages/ProfileMerged'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));

const Unauthorized = lazy(() => import('./pages/Unauthorized'));
const Forbidden = lazy(() => import('./pages/Forbidden'));
const NotFound = lazy(() => import('./pages/NotFound'));
const ServerError = lazy(() => import('./pages/ServerError'));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <div className="w-10 h-10 border-2 border-red-500/30 rounded-full" />
        <div className="absolute inset-0 w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
      <span className="text-sm font-medium text-gray-400 tracking-wide">Loading module...</span>
    </div>
  </div>
);

const RequireAuth = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

const RedirectIfAuth = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <>{children}</>;
};

function App() {
  return (
    <Router>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<RedirectIfAuth><Landing /></RedirectIfAuth>} />
          <Route path="/login" element={<RedirectIfAuth><Login /></RedirectIfAuth>} />
          <Route path="/register" element={<RedirectIfAuth><Register /></RedirectIfAuth>} />
          <Route path="/forgot-password" element={<RedirectIfAuth><ForgotPassword /></RedirectIfAuth>} />

          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route path="/forbidden" element={<Forbidden />} />
          <Route path="/server-error" element={<ServerError />} />

          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<RequireRole permission="dashboard"><Dashboard /></RequireRole>} />
              <Route path="/detection" element={<RequireRole permission="detection"><Detection /></RequireRole>} />
              <Route path="/live-monitoring" element={<RequireRole permission="live_monitoring"><LiveMonitoring /></RequireRole>} />
              <Route path="/alerts-reports" element={<RequireRole permission="alerts_reports"><AlertsReports /></RequireRole>} />
              <Route path="/analytics" element={<RequireRole permission="analytics"><AnalyticsMerged /></RequireRole>} />
              <Route path="/settings" element={<RequireRole permission="settings"><SettingsMerged /></RequireRole>} />
              <Route path="/admin" element={<RequireRole permission="admin"><AdminPanel /></RequireRole>} />
              <Route path="/profile" element={<RequireRole permission="profile"><ProfileMerged /></RequireRole>} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
