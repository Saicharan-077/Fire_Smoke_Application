import { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Flame, Activity, LayoutDashboard, Settings, Moon, Sun, Bell, LogOut, User,
  Camera, ShieldAlert, BarChart3, Shield, Menu, X, ChevronRight,
} from 'lucide-react';
import { useAppSettingsStore } from '../store/appSettingsStore';
import { useAuthStore } from '../store/authStore';
import { useNotificationsStore } from '../store/notificationsStore';
import { usePermissions } from '../hooks/usePermissions';
import { NAV_ITEMS, hasPermission } from '../utils/permissions';
import { useToast } from './ui/Toast';
import { NotificationsHub } from './SOC/NotificationsHub';

const ICONS: Record<string, React.ReactNode> = {
  '/dashboard': <LayoutDashboard size={18} />,
  '/detection': <Camera size={18} />,
  '/live-monitoring': <Activity size={18} />,
  '/alerts-reports': <ShieldAlert size={18} />,
  '/analytics': <BarChart3 size={18} />,
  '/settings': <Settings size={18} />,
  '/admin': <Shield size={18} />,
  '/profile': <User size={18} />,
};

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Security Operations Center',
  '/detection': 'AI Detection Engine',
  '/live-monitoring': 'Live Monitoring',
  '/alerts-reports': 'Alerts & Reports',
  '/analytics': 'Analytics & Intelligence',
  '/settings': 'System Settings',
  '/admin': 'Admin Control Center',
  '/profile': 'User Profile',
};

const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useAppSettingsStore();
  const { currentUser, logout } = useAuthStore();
  const { hasPermission: can } = usePermissions();
  const { history: notifHistory, unreadCount, markAsRead, markAllAsRead, clearHistory } = useNotificationsStore();
  const { toast } = useToast();

  const [showNotifications, setShowNotifications] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = NAV_ITEMS.filter((item) => hasPermission(currentUser?.role, item.permission));
  const initials = currentUser ? currentUser.username.slice(0, 2).toUpperCase() : 'FG';
  const pageTitle = PAGE_TITLES[location.pathname] || location.pathname.replace('/', '').replace(/-/g, ' ');

  const SidebarContent = () => (
    <>
      <div className="h-16 flex items-center px-6 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2.5 text-red-600 dark:text-red-500 font-bold text-xl tracking-tight">
          <div className="p-1.5 rounded-xl bg-red-500/10">
            <Flame className="w-5 h-5 fill-current" />
          </div>
          <span>FireGuard<span className="text-gray-900 dark:text-white font-black ml-0.5">AI</span></span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-5 px-3 custom-scrollbar">
        <p className="px-3 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.15em] mb-3">Navigation</p>
        <nav className="space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200 ${
                  isActive
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`shrink-0 ${isActive ? 'text-red-500' : ''}`}>{ICONS[item.path]}</span>
                  <span className="flex-1">{item.label}</span>
                  {isActive && <ChevronRight size={14} className="opacity-50" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="p-4 border-t border-[var(--border)] shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-amber-500 animate-pulse'}`} />
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
              {wsConnected ? 'System Online' : 'Connecting...'}
            </span>
          </div>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
        <div
          onClick={() => { navigate('/profile'); setSidebarOpen(false); }}
          className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer transition-colors"
        >
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-red-500 to-orange-500 text-white flex items-center justify-center font-bold text-xs shadow-md">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate capitalize">{currentUser?.username?.split('@')[0] || 'User'}</p>
            <p className="text-[11px] text-gray-500 capitalize truncate">{currentUser?.role || 'viewer'}</p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--text)] font-sans transition-colors duration-200 overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex w-[260px] xl:w-[280px] border-r border-[var(--border)] bg-[var(--surface)] flex-col relative z-10 shrink-0">
        <SidebarContent />
      </aside>

      {/* Sidebar — mobile drawer */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-[280px] bg-[var(--surface)] border-r border-[var(--border)] flex flex-col transform transition-transform duration-300 lg:hidden ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <button onClick={() => setSidebarOpen(false)} className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">
          <X size={20} />
        </button>
        <SidebarContent />
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col relative overflow-hidden min-w-0">
        <header className="h-14 lg:h-16 border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-xl flex items-center justify-between px-4 lg:px-8 z-10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 text-gray-600 dark:text-gray-300">
              <Menu size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="text-base lg:text-lg font-bold text-gray-900 dark:text-white truncate">{pageTitle}</h1>
              <p className="text-[11px] text-gray-500 hidden sm:block">FireGuard AI Surveillance Platform</p>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-4 shrink-0">
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 rounded-xl transition-colors relative text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
                aria-label="Notifications"
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 bg-red-500 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold ring-2 ring-[var(--surface)]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl z-[9999] overflow-hidden flex flex-col max-h-[70vh]">
                  <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                    <span className="font-semibold text-sm">Alert Notifications</span>
                    {unreadCount > 0 && (
                      <button onClick={() => markAllAsRead()} className="text-xs text-red-500 hover:text-red-400 font-medium">Mark all read</button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-[var(--border)]">
                    {notifHistory.length === 0 ? (
                      <div className="p-10 text-center text-xs text-gray-500">No notifications yet</div>
                    ) : (
                      notifHistory.map((n) => {
                        const severityColors =
                          n.severity === 'critical' ? 'border-red-500 bg-red-500/5' :
                          n.severity === 'warning' ? 'border-amber-500 bg-amber-500/5' :
                          'border-blue-500 bg-blue-500/5';
                        return (
                          <div
                            key={n.id}
                            onClick={() => {
                              markAsRead(n.id);
                              setShowNotifications(false);
                              if (can('live_monitoring')) navigate(`/live-monitoring?cameraId=${encodeURIComponent(n.cameraId || '')}`);
                            }}
                            className={`p-3.5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer border-l-2 ${n.isRead ? 'border-transparent opacity-60' : severityColors}`}
                          >
                            <div className="flex justify-between text-[11px] font-mono text-gray-400 mb-1">
                              <span className="capitalize font-bold">{n.alertType} Alert</span>
                              <span>{new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <p className="text-xs font-semibold">{n.cameraName} {n.zone ? `· ${n.zone}` : ''}</p>
                            <p className="text-[10px] text-gray-500 mt-1">Confidence: {(n.confidence * 100).toFixed(0)}%</p>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {notifHistory.length > 0 && (
                    <div className="p-2 border-t border-[var(--border)] text-center">
                      <button onClick={() => { clearHistory(); setShowNotifications(false); }} className="text-xs text-gray-500 hover:text-red-500 py-1.5 w-full">Clear history</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={async () => {
                try { await import('../services/api').then(m => m.logoutApi()); } catch { /* ignore */ }
                logout();
                toast('Logged out successfully', 'success');
                navigate('/login');
              }}
              className="p-2 text-gray-400 hover:text-red-500 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
              title="Sign Out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="p-4 sm:p-6 lg:p-8 max-w-[1920px] mx-auto w-full min-h-full">
            <Outlet />
          </div>
        </div>

        <NotificationsHub onConnectionChange={setWsConnected} />
      </main>
    </div>
  );
};

export default Layout;
