import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Settings, Bell, LogOut,
  Camera, BarChart3, Shield, Menu,
  ChevronRight, ChevronLeft, Search, AlertTriangle,
  Video, History, Sun, Moon, Sparkles
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
    { label: 'Dashboard',       path: '/dashboard',       icon: LayoutDashboard },
    { label: 'Live Monitoring',  path: '/live-monitoring', icon: Video },
    { label: 'Detection',       path: '/detection',       icon: Camera },
    { label: 'History',         path: '/alerts-reports',  icon: History },
    { label: 'Analytics',       path: '/analytics',       icon: BarChart3 },
    { label: 'Settings',        path: '/settings',        icon: Settings },
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
    <div className={`flex flex-col h-full bg-[var(--surface-2)] border-r border-[var(--border)] transition-all duration-200 select-none relative ${collapsed ? 'w-16' : 'w-60'}`}>

      {/* Logo / Workspace */}
      <div className="h-14 flex items-center px-4 border-b border-[var(--border)] shrink-0 bg-[var(--surface-2)]">
        <div
          onClick={() => navigate('/')}
          className={`flex items-center gap-3 cursor-pointer group ${collapsed ? 'justify-center w-full' : ''}`}
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#0070f3] flex items-center justify-center shrink-0 shadow-sm">
            <Shield size={14} className="text-white fill-white" />
          </div>
          {!collapsed && (
            <div>
              <p className="text-[13px] font-semibold text-[var(--text)] leading-none tracking-tight">SentinelOS</p>
              <p className="text-[10px] text-[var(--text-3)] leading-none mt-0.5">Control Center</p>
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-1 shrink-0">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              id="sidebar-search"
              type="text"
              placeholder="Search...  ⌘K"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text)] placeholder-[var(--text-3)] outline-none focus:border-[var(--primary)] focus:bg-[var(--surface)] transition-all"
            />
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 custom-scrollbar">
        {!collapsed && (
          <p className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest px-2 py-2">Navigation</p>
        )}

        {filteredItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-100 group relative
                ${isActive
                  ? 'bg-[var(--primary-light)] text-[var(--primary)] font-semibold'
                  : 'text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
                }
                ${collapsed ? 'justify-center px-0' : ''}
              `}
            >
              {isActive && !collapsed && (
                <span className="absolute left-0 top-1/4 bottom-1/4 w-0.5 bg-[var(--primary)] rounded-r-full" />
              )}
              <Icon size={16} className={`shrink-0 ${isActive ? 'text-[var(--primary)]' : 'text-[var(--text-3)] group-hover:text-[var(--text)]'}`} />
              {!collapsed && (
                <span className="flex-1 truncate">{item.label}</span>
              )}
              {collapsed && (
                <span className="absolute left-full ml-2 px-2 py-1 bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-[11px] rounded-md font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
                  {item.label}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-[var(--border)] space-y-1 shrink-0 bg-[var(--surface-2)]">
        {/* System status pill */}
        {!collapsed && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${wsConnected ? 'bg-[var(--safe)]' : 'bg-[var(--smoke)]'}`} style={{ animation: 'pulse-dot 2s infinite' }} />
            <span className="text-[11px] text-[var(--text-2)] font-medium">{wsConnected ? 'System Online' : 'Connecting...'}</span>
          </div>
        )}

        {/* Profile */}
        <div
          onClick={() => navigate('/profile')}
          className={`flex items-center gap-2.5 p-2 rounded-lg hover:bg-[var(--surface-hover)] cursor-pointer transition-colors ${collapsed ? 'justify-center' : ''}`}
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[#7c3aed] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
            {initials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-[var(--text)] truncate leading-none">
                {currentUser?.username?.split('@')[0] || 'Operator'}
              </p>
              <p className="text-[10px] text-[var(--text-3)] capitalize truncate mt-0.5 leading-none">
                {currentUser?.role || 'viewer'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="hidden lg:flex absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-[var(--surface)] border border-[var(--border)] items-center justify-center text-[var(--text-2)] hover:text-[var(--text)] transition-all shadow-sm z-10 hover:scale-110"
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
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

        {/* Top header bar */}
        <header className="h-13 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between px-5 shrink-0 z-20" style={{ height: '52px' }}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-[var(--surface-hover)] text-[var(--text-2)] transition-colors"
            >
              <Menu size={16} />
            </button>
            <div className="flex items-center gap-1.5 text-[13px] min-w-0">
              <span className="text-[var(--text-3)] font-medium">SentinelOS</span>
              <ChevronRight size={12} className="text-[var(--border-strong)]" />
              <span className="font-semibold text-[var(--text)] truncate">
                {PAGE_TITLES[location.pathname] || 'Workspace'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">

            {/* Notifications */}
            <div className="relative" data-notif-panel>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className={`relative p-2 rounded-lg transition-colors ${showNotifications ? 'bg-[var(--surface-hover)] text-[var(--text)]' : 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]'}`}
              >
                <Bell size={15} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-[var(--fire)] rounded-full ring-1 ring-[var(--surface)]" />
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl z-50 overflow-hidden" data-notif-panel>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={13} className="text-[var(--fire)]" />
                      <span className="text-[12px] font-semibold text-[var(--text)]">Alerts</span>
                      {unreadCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-[var(--fire)] text-white text-[10px] font-bold rounded-full">{unreadCount}</span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button onClick={markAllAsRead} className="text-[11px] text-[var(--primary)] hover:underline font-medium">Mark all read</button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto custom-scrollbar divide-y divide-[var(--border)] bg-[var(--surface)]">
                    {notifHistory.length === 0 ? (
                      <div className="py-10 text-center text-[13px] text-[var(--text-3)] bg-[var(--surface)]">No alerts</div>
                    ) : (
                      notifHistory.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => { markAsRead(n.id); setShowNotifications(false); }}
                          className={`flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-hover)] cursor-pointer transition-colors ${n.isRead ? 'opacity-50' : ''}`}
                        >
                          <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${n.alertType === 'fire' ? 'bg-[var(--fire)]' : 'bg-[var(--smoke)]'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-[var(--text)] capitalize">{n.alertType} detected</p>
                            <p className="text-[11px] text-[var(--text-2)] truncate">{n.cameraName}</p>
                            <p className="text-[10px] text-[var(--text-3)] mt-0.5">{new Date(n.timestamp).toLocaleTimeString()}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {notifHistory.length > 0 && (
                    <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--surface-2)]">
                      <button onClick={() => { clearHistory(); setShowNotifications(false); }} className="text-[11px] text-[var(--text-2)] hover:text-[var(--fire)] transition-colors w-full text-center">Clear all</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Theme Switcher */}
            <button
              onClick={cycleTheme}
              className="p-2 rounded-lg text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors mr-1"
              title={`Switch Theme (Current: ${currentTheme})`}
            >
              {currentTheme === 'light' && <Sun size={15} />}
              {currentTheme === 'dark' && <Moon size={15} />}
              {currentTheme === 'midnight' && <Sparkles size={15} />}
            </button>

            {/* Profile avatar */}
            <button
              onClick={() => navigate('/profile')}
              className="p-1 rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
              title="Profile"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[#7c3aed] flex items-center justify-center text-white text-[10px] font-bold">
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
              className="p-2 rounded-lg text-[var(--text-2)] hover:text-[var(--fire)] hover:bg-[var(--fire-bg)] transition-colors"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto custom-scrollbar bg-[var(--bg)]">
          <div className="max-w-[1600px] mx-auto w-full p-6 lg:p-8">
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
  '/detection':       'Detection',
  '/live-monitoring': 'Live Monitoring',
  '/alerts-reports':  'History',
  '/analytics':       'Analytics',
  '/settings':        'Settings',
  '/admin':           'Admin Console',
  '/profile':         'Profile',
};

export default Layout;
