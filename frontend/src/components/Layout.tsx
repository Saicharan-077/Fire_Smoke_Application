import { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Flame, Activity, LayoutDashboard, Settings, Moon, Sun, Bell, LogOut, User,
  Camera, ShieldAlert, BarChart3, Shield, Menu, X, ChevronRight
} from 'lucide-react';
import { useAppSettingsStore } from '../store/appSettingsStore';
import { useAuthStore } from '../store/authStore';
import { useNotificationsStore } from '../store/notificationsStore';
import { usePermissions } from '../hooks/usePermissions';
import { NAV_ITEMS, hasPermission } from '../utils/permissions';
import { useToast } from './ui/Toast';
import { NotificationsHub } from './SOC/NotificationsHub';

const ICONS: Record<string, React.ReactNode> = {
  '/dashboard': <LayoutDashboard size={14} />,
  '/detection': <Camera size={14} />,
  '/live-monitoring': <Activity size={14} />,
  '/alerts-reports': <ShieldAlert size={14} />,
  '/analytics': <BarChart3 size={14} />,
  '/settings': <Settings size={14} />,
  '/admin': <Shield size={14} />,
  '/profile': <User size={14} />,
};

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'SOC Console',
  '/detection': 'AI Threat Detection',
  '/live-monitoring': 'Live Streams Grid',
  '/alerts-reports': 'Security Incident Logs',
  '/analytics': 'Threat Analytics',
  '/settings': 'System Settings',
  '/admin': 'Admin Console',
  '/profile': 'Profile',
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
    <div className="flex flex-col h-full bg-[var(--bg-alt)] select-none">
      {/* Notion Workspace Switcher look */}
      <div className="h-14 flex items-center px-4 border-b border-[var(--border)] shrink-0">
        <div 
          onClick={() => navigate('/')}
          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.04] cursor-pointer transition-colors w-full"
        >
          <div className="p-1 rounded bg-red-500/10 text-red-500 border border-red-500/10 flex items-center justify-center shrink-0">
            <Flame size={15} className="fill-current" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold truncate leading-none text-[var(--text)]">FireGuard AI</p>
            <p className="text-[10px] text-[var(--text-2)] truncate leading-none mt-1">Workspace Console</p>
          </div>
        </div>
      </div>

      {/* Sidebar List Links */}
      <div className="flex-1 overflow-y-auto py-4 px-2 custom-scrollbar space-y-1">
        <p className="px-2.5 text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mb-2">Workspace</p>
        <nav className="space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-black/[0.05] dark:bg-white/[0.05] text-[var(--text)] font-semibold'
                    : 'text-[var(--text-2)] hover:bg-black/[0.03] dark:hover:bg-white/[0.03] hover:text-[var(--text)]'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`shrink-0 ${isActive ? 'text-[var(--primary)]' : 'text-[var(--text-2)] group-hover:text-[var(--text)]'}`}>{ICONS[item.path]}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Sidebar Footer Controls */}
      <div className="p-3 border-t border-[var(--border)] shrink-0 space-y-3">
        <div className="flex items-center justify-between px-2 text-[10px] text-[var(--text-2)]">
          <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider">
            <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.3)]' : 'bg-amber-500'}`} />
            <span>{wsConnected ? 'SOC Active' : 'Connecting'}</span>
          </div>

          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1 rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.05] text-[var(--text-2)] hover:text-[var(--text)] transition-colors cursor-pointer"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </div>

        {/* User Profile Switcher */}
        <div
          onClick={() => { navigate('/profile'); setSidebarOpen(false); }}
          className="flex items-center gap-2.5 p-2 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.04] cursor-pointer transition-colors border border-transparent hover:border-[var(--border)]"
        >
          <div className="h-7 w-7 rounded bg-gradient-to-br from-red-500 to-orange-400 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold truncate leading-none text-[var(--text)]">{currentUser?.username?.split('@')[0] || 'User'}</p>
            <p className="text-[9px] text-[var(--muted)] capitalize truncate mt-0.5 leading-none">{currentUser?.role || 'viewer'}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden font-sans">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-none transition-all" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex w-[220px] xl:w-[240px] border-r border-[var(--border)] bg-[var(--bg-alt)] flex-col relative z-10 shrink-0">
        <SidebarContent />
      </aside>

      {/* Sidebar — mobile drawer */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-[240px] bg-[var(--bg-alt)] border-r border-[var(--border)] flex flex-col transform transition-transform duration-200 lg:hidden ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <button onClick={() => setSidebarOpen(false)} className="absolute top-3 right-3 p-1.5 rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.05] text-[var(--text-2)]">
          <X size={16} />
        </button>
        <SidebarContent />
      </aside>

      {/* Main Container */}
      <main className="flex-1 flex flex-col relative overflow-hidden min-w-0 bg-[var(--bg)]">
        {/* Header - Flat, simple */}
        <header className="h-12 border-b border-[var(--border)] bg-[var(--bg)] flex items-center justify-between px-6 z-10 shrink-0 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-1.5 rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.05] text-[var(--text-2)]">
              <Menu size={16} />
            </button>
            <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] truncate">
              <span>FireGuard AI</span>
              <ChevronRight size={10} />
              <span className="font-bold text-[var(--text)] truncate">{pageTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Notifications Trigger */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className={`p-1.5 rounded transition-colors ${showNotifications ? 'bg-black/5 dark:bg-white/5 text-[var(--text)]' : 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'} relative cursor-pointer`}
                aria-label="Notifications"
              >
                <Bell size={15} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 bg-red-500 text-white text-[8px] w-3 h-3 rounded-full flex items-center justify-center font-bold ring-1 ring-[var(--bg)]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl z-[9999] overflow-hidden flex flex-col max-h-[60vh] animate-slide-up">
                  <div className="p-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg-alt)]">
                    <span className="font-bold text-xs text-[var(--text)]">Threat Notifications</span>
                    {unreadCount > 0 && (
                      <button onClick={() => markAllAsRead()} className="text-[10px] text-red-500 hover:text-red-400 font-bold cursor-pointer">Mark all read</button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-[var(--border)]">
                    {notifHistory.length === 0 ? (
                      <div className="p-10 text-center text-xs text-[var(--muted)]">No active threat warnings.</div>
                    ) : (
                      notifHistory.map((n) => {
                        const severityColors =
                          n.severity === 'critical' ? 'border-red-500 bg-red-500/[0.03]' :
                          n.severity === 'warning' ? 'border-orange-500 bg-orange-500/[0.03]' :
                          'border-blue-500 bg-blue-500/[0.03]';
                        return (
                          <div
                            key={n.id}
                            onClick={() => {
                              markAsRead(n.id);
                              setShowNotifications(false);
                              if (can('live_monitoring')) navigate(`/live-monitoring?cameraId=${encodeURIComponent(n.cameraId || '')}`);
                            }}
                            className={`p-3 hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer border-l-2 ${n.isRead ? 'border-transparent opacity-50' : severityColors}`}
                          >
                            <div className="flex justify-between text-[9px] font-mono text-[var(--muted)] mb-1">
                              <span className="capitalize font-bold text-[var(--text-2)]">{n.alertType} Alert</span>
                              <span>{new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <p className="text-xs font-bold text-[var(--text)]">{n.cameraName} {n.zone ? `· ${n.zone}` : ''}</p>
                            <p className="text-[10px] text-[var(--text-2)] mt-0.5">Confidence: {(n.confidence * 100).toFixed(0)}%</p>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {notifHistory.length > 0 && (
                    <div className="p-2 border-t border-[var(--border)] text-center bg-[var(--bg-alt)]">
                      <button onClick={() => { clearHistory(); setShowNotifications(false); }} className="text-[10px] text-[var(--text-2)] hover:text-red-500 py-1 w-full font-bold cursor-pointer">Clear alert feed</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Logout button */}
            <button
              onClick={async () => {
                try { await import('../services/api').then(m => m.logoutApi()); } catch { /* ignore */ }
                logout();
                toast('Logged out successfully', 'success');
                navigate('/login');
              }}
              className="p-1.5 text-[var(--text-2)] hover:text-red-500 rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
              title="Sign Out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>

        {/* Scrollable page body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[var(--bg)]">
          <div className="p-6 sm:p-8 max-w-[1440px] mx-auto w-full min-h-full">
            <Outlet />
          </div>
        </div>

        <NotificationsHub onConnectionChange={setWsConnected} />
      </main>
    </div>
  );
};

export default Layout;
