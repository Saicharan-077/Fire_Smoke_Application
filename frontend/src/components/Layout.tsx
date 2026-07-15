import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Flame, LayoutDashboard, Settings, Bell, LogOut,
  Camera, BarChart3, Shield, Menu,
  ChevronRight, ChevronLeft, Search, AlertTriangle
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useNotificationsStore } from '../store/notificationsStore';
import { usePermissions } from '../hooks/usePermissions';
import { useToast } from './ui/Toast';
import { NotificationsHub } from './SOC/NotificationsHub';

const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuthStore();
  const { hasPermission: can } = usePermissions();
  const { history: notifHistory, unreadCount, markAsRead, markAllAsRead, clearHistory } = useNotificationsStore();
  const { toast } = useToast();

  const [showNotifications, setShowNotifications] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const initials = currentUser
    ? currentUser.username.slice(0, 2).toUpperCase()
    : 'FG';

  const navItems = [
    { label: 'Dashboard',  path: '/dashboard',      icon: LayoutDashboard, group: 'main' },
    { label: 'Detection',  path: '/detection',       icon: Camera,          group: 'main' },
    { label: 'Analytics',  path: '/analytics',       icon: BarChart3,       group: 'main' },
    { label: 'Settings',   path: '/settings',        icon: Settings,        group: 'main' },
  ];

  const adminItems = can('admin')
    ? [{ label: 'Admin', path: '/admin', icon: Shield, group: 'admin' }]
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
    <div className={`flex flex-col h-full bg-white border-r border-[#e5e5e2] transition-all duration-200 select-none relative ${collapsed ? 'w-16' : 'w-60'}`}>

      {/* Logo / Workspace */}
      <div className="h-14 flex items-center px-4 border-b border-[#e5e5e2] shrink-0">
        <div
          onClick={() => navigate('/')}
          className={`flex items-center gap-3 cursor-pointer group ${collapsed ? 'justify-center w-full' : ''}`}
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#e5484d] to-[#e79020] flex items-center justify-center shrink-0 shadow-sm">
            <Flame size={14} className="text-white fill-white" />
          </div>
          {!collapsed && (
            <div>
              <p className="text-[13px] font-semibold text-[#1a1a1a] leading-none tracking-tight">FireGuard AI</p>
              <p className="text-[10px] text-[#6b6b6b] leading-none mt-0.5">Security Platform</p>
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-1 shrink-0">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a0a0a0]" />
            <input
              id="sidebar-search"
              type="text"
              placeholder="Search...  ⌘K"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#f9f9f8] border border-[#e5e5e2] text-[12px] text-[#1a1a1a] placeholder-[#a0a0a0] outline-none focus:border-[#0070f3] focus:bg-white transition-all"
            />
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 custom-scrollbar">
        {!collapsed && (
          <p className="text-[10px] font-semibold text-[#a0a0a0] uppercase tracking-widest px-2 py-2">Navigation</p>
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
                  ? 'bg-[#eff6ff] text-[#0070f3] font-semibold'
                  : 'text-[#6b6b6b] hover:bg-[#f0f0ed] hover:text-[#1a1a1a]'
                }
                ${collapsed ? 'justify-center px-0' : ''}
              `}
            >
              {isActive && !collapsed && (
                <span className="absolute left-0 top-1/4 bottom-1/4 w-0.5 bg-[#0070f3] rounded-r-full" />
              )}
              <Icon size={16} className={`shrink-0 ${isActive ? 'text-[#0070f3]' : 'text-[#a0a0a0] group-hover:text-[#1a1a1a]'}`} />
              {!collapsed && (
                <span className="flex-1 truncate">{item.label}</span>
              )}
              {collapsed && (
                <span className="absolute left-full ml-2 px-2 py-1 bg-[#1a1a1a] text-white text-[11px] rounded-md font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
                  {item.label}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-[#e5e5e2] space-y-1 shrink-0">
        {/* System status pill */}
        {!collapsed && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${wsConnected ? 'bg-[#30a46c]' : 'bg-[#e79020]'}`} style={{ animation: 'pulse-dot 2s infinite' }} />
            <span className="text-[11px] text-[#6b6b6b] font-medium">{wsConnected ? 'System Online' : 'Connecting...'}</span>
          </div>
        )}

        {/* Profile */}
        <div
          onClick={() => navigate('/profile')}
          className={`flex items-center gap-2.5 p-2 rounded-lg hover:bg-[#f0f0ed] cursor-pointer transition-colors ${collapsed ? 'justify-center' : ''}`}
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#0070f3] to-[#7c3aed] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
            {initials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-[#1a1a1a] truncate leading-none">
                {currentUser?.username?.split('@')[0] || 'Operator'}
              </p>
              <p className="text-[10px] text-[#6b6b6b] capitalize truncate mt-0.5 leading-none">
                {currentUser?.role || 'viewer'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="hidden lg:flex absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-white border border-[#e5e5e2] items-center justify-center text-[#6b6b6b] hover:text-[#1a1a1a] transition-all shadow-sm z-10 hover:scale-110"
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
      </button>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#f9f9f8] text-[#1a1a1a] overflow-hidden font-sans">

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
        <header className="h-13 bg-white border-b border-[#e5e5e2] flex items-center justify-between px-5 shrink-0 z-20" style={{ height: '52px' }}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-[#f0f0ed] text-[#6b6b6b] transition-colors"
            >
              <Menu size={16} />
            </button>
            <div className="flex items-center gap-1.5 text-[13px] min-w-0">
              <span className="text-[#a0a0a0] font-medium">FireGuard</span>
              <ChevronRight size={12} className="text-[#d4d4d0]" />
              <span className="font-semibold text-[#1a1a1a] truncate">
                {PAGE_TITLES[location.pathname] || 'Workspace'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">

            {/* Notifications */}
            <div className="relative" data-notif-panel>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className={`relative p-2 rounded-lg transition-colors ${showNotifications ? 'bg-[#f0f0ed] text-[#1a1a1a]' : 'text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-[#f0f0ed]'}`}
              >
                <Bell size={15} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-[#e5484d] rounded-full ring-1 ring-white" />
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-[#e5e5e2] rounded-xl shadow-xl z-50 overflow-hidden" data-notif-panel>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e2] bg-[#f9f9f8]">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={13} className="text-[#e5484d]" />
                      <span className="text-[12px] font-semibold text-[#1a1a1a]">Alerts</span>
                      {unreadCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-[#e5484d] text-white text-[10px] font-bold rounded-full">{unreadCount}</span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button onClick={markAllAsRead} className="text-[11px] text-[#0070f3] hover:underline font-medium">Mark all read</button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto custom-scrollbar divide-y divide-[#e5e5e2]">
                    {notifHistory.length === 0 ? (
                      <div className="py-10 text-center text-[13px] text-[#a0a0a0]">No alerts</div>
                    ) : (
                      notifHistory.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => { markAsRead(n.id); setShowNotifications(false); }}
                          className={`flex items-start gap-3 px-4 py-3 hover:bg-[#f9f9f8] cursor-pointer transition-colors ${n.isRead ? 'opacity-50' : ''}`}
                        >
                          <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${n.alertType === 'fire' ? 'bg-[#e5484d]' : 'bg-[#e79020]'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-[#1a1a1a] capitalize">{n.alertType} detected</p>
                            <p className="text-[11px] text-[#6b6b6b] truncate">{n.cameraName}</p>
                            <p className="text-[10px] text-[#a0a0a0] mt-0.5">{new Date(n.timestamp).toLocaleTimeString()}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {notifHistory.length > 0 && (
                    <div className="px-4 py-2 border-t border-[#e5e5e2] bg-[#f9f9f8]">
                      <button onClick={() => { clearHistory(); setShowNotifications(false); }} className="text-[11px] text-[#6b6b6b] hover:text-[#e5484d] transition-colors w-full text-center">Clear all</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Profile avatar */}
            <button
              onClick={() => navigate('/profile')}
              className="p-1 rounded-lg hover:bg-[#f0f0ed] transition-colors"
              title="Profile"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#0070f3] to-[#7c3aed] flex items-center justify-center text-white text-[10px] font-bold">
                {initials}
              </div>
            </button>

            {/* Logout */}
            <button
              onClick={async () => {
                try { await import('../services/api').then(m => m.logoutApi()); } catch { /* ignore */ }
                logout();
                toast('Signed out', 'success');
                navigate('/login');
              }}
              className="p-2 rounded-lg text-[#6b6b6b] hover:text-[#e5484d] hover:bg-[#fff1f1] transition-colors"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto custom-scrollbar bg-[#f9f9f8]">
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
  '/alerts-reports':  'Alerts & Reports',
  '/analytics':       'Analytics',
  '/settings':        'Settings',
  '/admin':           'Admin Console',
  '/profile':         'Profile',
};

export default Layout;
