import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Settings, Bell, LogOut,
  Camera, BarChart3, Shield, Menu,
  ChevronRight, ChevronLeft, Search, AlertTriangle,
  Video, History, Sun, Moon, Sparkles, Target
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useNotificationsStore } from '../store/notificationsStore';
import { usePermissions } from '../hooks/usePermissions';
import { useToast } from './ui/Toast';
import { NotificationsHub } from './SOC/NotificationsHub';
import { useAppSettingsStore } from '../store/appSettingsStore';

const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuthStore();
  const { hasPermission: can } = usePermissions();
  const { history: notifHistory, unreadCount, markAsRead, markAllAsRead, clearHistory } = useNotificationsStore();
  const { toast } = useToast();
  const { theme: currentTheme, cycleTheme } = useAppSettingsStore();

  const [showNotifications, setShowNotifications] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const initials = currentUser
    ? currentUser.username.slice(0, 2).toUpperCase()
    : 'SO';

  const navItems = [
    { label: 'Dashboard',         path: '/dashboard',       icon: LayoutDashboard },
    { label: 'Live Monitoring',    path: '/live-monitoring', icon: Video },
    { label: 'Detection',         path: '/detection',       icon: Camera },
    { label: 'Alerts & Incidents', path: '/alerts-reports',  icon: AlertTriangle },
    { label: 'Settings',          path: '/settings',        icon: Settings },
  ];

  const adminItems = can('admin')
    ? [{ label: 'Admin', path: '/admin', icon: Shield }]
    : [];

  const allItems = [...navItems, ...adminItems];

  const filteredItems = searchQuery
    ? allItems.filter(i => i.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : allItems;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('sidebar-search')?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setCollapsed(c => !c);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Close notifications on outside click
  useEffect(() => {
    if (!showNotifications) return;
    const handle = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-notif-panel]')) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showNotifications]);

  const SidebarNav = () => (
    <div className={`flex flex-col h-full glass border-r border-[var(--color-border)] transition-all duration-300 select-none relative ${collapsed ? 'w-16' : 'w-60'}`}>

      {/* Logo / Workspace */}
      <div className="h-16 flex items-center px-4 border-b border-[var(--color-border)] shrink-0 bg-[var(--glass-bg)] backdrop-blur-xl">
        <div
          onClick={() => navigate('/')}
          className={`flex items-center gap-3 cursor-pointer group ${collapsed ? 'justify-center w-full' : ''}`}
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 via-purple-600 to-blue-500 flex items-center justify-center shrink-0 shadow-glow transition-all duration-300 group-hover:scale-105">
            <span className="text-[13px] font-black text-white tracking-wider">SC</span>
          </div>
          {!collapsed && (
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-[14px] font-black tracking-tight text-[var(--color-fg)] leading-none">
                  Sai Charan
                </p>
              </div>
              <p className="text-[10px] font-bold text-[var(--color-muted)] leading-none mt-1 uppercase tracking-wider">
                <span className="gradient-text font-extrabold">FireGuard</span> AI SOC
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="px-3 pt-4 pb-2 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
            <input
              id="sidebar-search"
              type="text"
              placeholder="Search...  ⌘K"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl glass-light border border-[var(--color-border)] text-[12px] text-[var(--color-fg)] placeholder-[var(--color-muted)] outline-none focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] transition-all shadow-sm"
            />
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1 custom-scrollbar">
        {!collapsed && (
          <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-widest px-2 py-2">Menu</p>
        )}

        {filteredItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group relative
                ${isActive
                  ? 'bg-gradient-to-r from-[var(--color-accent)]/20 to-[var(--color-accent-2)]/10 text-[var(--color-accent)] font-semibold border border-[var(--color-accent)]/30 shadow-glow'
                  : 'text-[var(--color-fg-secondary)] hover:bg-[var(--glass-light-bg)] hover:text-[var(--color-fg)]'
                }
                ${collapsed ? 'justify-center px-0' : ''}
              `}
            >
              {isActive && !collapsed && (
                <span className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-gradient-to-b from-[var(--color-accent)] to-[var(--color-accent-2)] rounded-r-full shadow-glow" />
              )}
              <Icon size={17} className={`shrink-0 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)] group-hover:text-[var(--color-fg)]'}`} />
              {!collapsed && (
                <span className="flex-1 truncate">{item.label}</span>
              )}
              {collapsed && (
                <span className="absolute left-full ml-2 px-2.5 py-1 glass border border-[var(--color-border)] text-[var(--color-fg)] text-[11px] rounded-lg font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-premium">
                  {item.label}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-[var(--color-border)] space-y-2 shrink-0 bg-[var(--glass-bg)] backdrop-blur-xl">
        {/* System status pill */}
        {!collapsed && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl glass-light border border-[var(--color-border)]">
            <span className={`w-2 h-2 rounded-full shrink-0 ${wsConnected ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]' : 'bg-amber-400 animate-pulse'}`} />
            <span className="text-[11px] text-[var(--color-fg-secondary)] font-semibold">{wsConnected ? 'System Online' : 'Connecting...'}</span>
          </div>
        )}

        {/* Profile */}
        <div
          onClick={() => navigate('/profile')}
          className={`flex items-center gap-3 p-2 rounded-xl hover:bg-[var(--glass-light-bg)] cursor-pointer transition-colors ${collapsed ? 'justify-center' : ''}`}
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--color-accent)] via-[var(--color-accent-2)] to-[var(--color-accent-3)] flex items-center justify-center text-white text-[11px] font-black shrink-0 shadow-md">
            {initials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-[var(--color-fg)] truncate leading-none">
                {currentUser?.username?.split('@')[0] || 'Operator'}
              </p>
              <p className="text-[10px] text-[var(--color-muted)] capitalize truncate mt-1 font-medium leading-none">
                {currentUser?.role || 'viewer'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="hidden lg:flex absolute -right-3 top-[76px] w-6 h-6 rounded-full glass border border-[var(--color-border)] items-center justify-center text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] transition-all shadow-md z-10 hover:scale-110 cursor-pointer"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </div>
  );

  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden font-sans">

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Desktop sidebar */}
      <aside className={`hidden lg:block shrink-0 transition-all duration-200 ${collapsed ? 'w-16' : 'w-60'}`}>
        <SidebarNav />
      </aside>

      {/* Mobile drawer */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex flex-col transform transition-transform duration-200 lg:hidden ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <SidebarNav />
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top header bar (Compact Operational Navigation) */}
        <header className="sticky top-0 h-[52px] glass border-b border-[var(--color-border)] flex items-center justify-between px-4 sm:px-6 shrink-0 z-20 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-[var(--glass-light-bg)] text-[var(--color-fg-secondary)] transition-colors cursor-pointer"
            >
              <Menu size={16} />
            </button>
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="text-[var(--color-muted)] font-semibold">FireGuard SOC</span>
              <ChevronRight size={11} className="text-[var(--color-muted)]" />
              <span className="font-bold text-[var(--color-fg)] truncate">
                {PAGE_TITLES[location.pathname] || 'Workspace'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Live Operational Status */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full glass-light border border-[var(--color-border)] text-[11px] font-semibold">
              <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]' : 'bg-amber-400 animate-pulse'}`} />
              <span className="text-[var(--color-fg-secondary)]">
                {wsConnected ? 'System Online' : 'Connecting...'}
              </span>
            </div>

            {/* Notifications */}
            <div className="relative" data-notif-panel>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className={`relative p-2 rounded-lg transition-all cursor-pointer ${showNotifications ? 'glass text-[var(--color-accent)]' : 'text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] hover:bg-[var(--glass-light-bg)]'}`}
              >
                <Bell size={15} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 top-full mt-2 w-80 glass-heavy border border-[var(--color-border)] rounded-xl shadow-premium z-50 overflow-hidden" data-notif-panel>
                  <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--color-border)] bg-[var(--glass-light-bg)]">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle size={13} className="text-red-400" />
                      <span className="text-xs font-bold text-[var(--color-fg)]">Alerts</span>
                      {unreadCount > 0 && (
                        <span className="px-1.5 py-0.2 bg-red-500/20 text-red-400 text-[10px] font-bold rounded-full">{unreadCount}</span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button onClick={markAllAsRead} className="text-[10px] text-[var(--primary)] hover:underline font-medium cursor-pointer">Mark all read</button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto custom-scrollbar divide-y divide-[var(--color-border)] bg-[var(--color-surface)]">
                    {notifHistory.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[var(--color-muted)]">No active warnings</div>
                    ) : (
                      notifHistory.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => { markAsRead(n.id); setShowNotifications(false); }}
                          className={`flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-[var(--glass-light-bg)] cursor-pointer transition-colors ${n.isRead ? 'opacity-50' : ''}`}
                        >
                          <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${n.alertType === 'fire' ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]' : 'bg-amber-500'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-[var(--color-fg)] capitalize">{n.alertType} detected</p>
                            <p className="text-[11px] text-[var(--color-fg-secondary)] truncate">{n.cameraName}</p>
                            <p className="text-[10px] text-[var(--color-muted)]">{new Date(n.timestamp).toLocaleTimeString()}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {notifHistory.length > 0 && (
                    <div className="px-3 py-2 border-t border-[var(--color-border)] bg-[var(--glass-light-bg)]">
                      <button onClick={() => { clearHistory(); setShowNotifications(false); }} className="text-[10px] text-[var(--color-muted)] hover:text-red-400 transition-colors w-full text-center cursor-pointer">Clear all</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Theme Switcher */}
            <button
              onClick={cycleTheme}
              className="p-2 rounded-lg glass-light border border-[var(--color-border)] text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] transition-all cursor-pointer"
              title={`Switch Theme (Current: ${currentTheme})`}
            >
              {currentTheme === 'light' && <Sun size={14} className="text-amber-500" />}
              {currentTheme === 'dark' && <Moon size={14} className="text-indigo-400" />}
              {currentTheme === 'midnight' && <Sparkles size={14} className="text-purple-400" />}
            </button>

            {/* Profile avatar */}
            <button
              onClick={() => navigate('/profile')}
              className="p-0.5 rounded-lg hover:bg-[var(--glass-light-bg)] transition-colors cursor-pointer"
              title="Profile"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white text-[10px] font-black shadow-sm">
                {initials}
              </div>
            </button>

            {/* Logout */}
            <button
              onClick={() => {
                logout();
                toast('Signed out successfully', 'success');
                navigate('/login');
              }}
              className="p-2 rounded-lg text-[var(--color-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </header>

        {/* Page content with reduced enterprise padding */}
        <main className="flex-1 overflow-y-auto custom-scrollbar bg-[var(--bg)]">
          <div className="max-w-[1680px] mx-auto w-full p-4 sm:p-5 lg:p-6">
            <Outlet />
          </div>
        </main>

        <NotificationsHub onConnectionChange={setWsConnected} />
      </div>
    </div>
  );
};

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':       'Dashboard',
  '/detection':       'Detection Engine',
  '/live-monitoring': 'Live Camera Monitoring',
  '/alerts-reports':  'Alerts & Incident Response',
  '/analytics':       'Analytics',
  '/settings':        'System Settings',
  '/admin':           'Admin Console',
  '/profile':         'User Profile',
};

export default Layout;
