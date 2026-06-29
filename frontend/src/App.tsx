import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import Layout from './components/Layout';
import { useAuthStore } from './store/authStore';

// ── Eager-loaded Auth & Landing ───────────────────────────────────────────────
import Login from './pages/Login';
import Landing from './pages/Landing';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';

// ── Lazy-loaded Dashboard pages ───────────────────────────────────────────────
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Detection = lazy(() => import('./pages/Detection'));
const LiveMonitoring = lazy(() => import('./pages/LiveMonitoring'));
const AlertsReports = lazy(() => import('./pages/AlertsReports'));
const AnalyticsMerged = lazy(() => import('./pages/AnalyticsMerged'));
const SettingsMerged = lazy(() => import('./pages/SettingsMerged'));
const ProfileMerged = lazy(() => import('./pages/ProfileMerged'));

// ── Lazy-loaded Error pages ───────────────────────────────────────────────────
const Unauthorized = lazy(() => import('./pages/Unauthorized'));
const Forbidden = lazy(() => import('./pages/Forbidden'));
const NotFound = lazy(() => import('./pages/NotFound'));
const ServerError = lazy(() => import('./pages/ServerError'));

// ── Loading Fallback ──────────────────────────────────────────────────────────
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-3 border-red-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-xs font-semibold text-slate-400">Loading module...</span>
    </div>
  </div>
);

// ── Auth Guard ────────────────────────────────────────────────────────────────
const RequireAuth = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

// ── Redirect if already authenticated ─────────────────────────────────────────
const RedirectIfAuth = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <>{children}</>;
};

function App() {
  return (
    <Router>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* ── Public Routes ──────────────────────────────────────── */}
          <Route path="/" element={<RedirectIfAuth><Landing /></RedirectIfAuth>} />
          <Route path="/login" element={<RedirectIfAuth><Login /></RedirectIfAuth>} />
          <Route path="/register" element={<RedirectIfAuth><Register /></RedirectIfAuth>} />
          <Route path="/forgot-password" element={<RedirectIfAuth><ForgotPassword /></RedirectIfAuth>} />

          {/* ── Error Pages (public) ───────────────────────────────── */}
          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route path="/forbidden" element={<Forbidden />} />
          <Route path="/server-error" element={<ServerError />} />

          {/* ── Protected Dashboard Routes ─────────────────────────── */}
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              {/* Core */}
              <Route path="/dashboard" element={<Dashboard />} />

              {/* 7 Consolidated Pages */}
              <Route path="/detection" element={<Detection />} />
              <Route path="/live-monitoring" element={<LiveMonitoring />} />
              <Route path="/alerts-reports" element={<AlertsReports />} />
              <Route path="/analytics" element={<AnalyticsMerged />} />
              <Route path="/settings" element={<SettingsMerged />} />
              <Route path="/profile" element={<ProfileMerged />} />
            </Route>
          </Route>

          {/* ── Catch-all ──────────────────────────────────────────── */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
