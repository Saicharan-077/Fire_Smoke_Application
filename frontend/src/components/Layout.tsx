import { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Flame, Activity, LayoutDashboard, Settings, Moon, Sun, Bell, LogOut, User, Camera, ShieldAlert, BarChart3 } from 'lucide-react';
import { useAppSettingsStore } from '../store/appSettingsStore';
import { useWebSocketStore } from '../store/websocketStore';
import { useAuthStore } from '../store/authStore';
import { useNotificationsStore } from '../store/notificationsStore';
import { useToast } from './ui/Toast';
import { APP_CONFIG } from '../config/appConfig';
import { NotificationsHub } from './SOC/NotificationsHub';

const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useAppSettingsStore();
  const { connect, disconnect, isConnected } = useWebSocketStore();
  const { currentUser, logout } = useAuthStore();
  const { history: notifHistory, unreadCount, markAsRead, markAllAsRead, clearHistory } = useNotificationsStore();
  const { toast } = useToast();

  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    connect(APP_CONFIG.websocketUrl);
    return () => disconnect();
  }, [connect, disconnect]);

  const navItems = [
    { path: '/dashboard', icon: <LayoutDashboard size={18} />, label: 'Dashboard' },
    { path: '/detection', icon: <Camera size={18} />, label: 'Detection' },
    { path: '/live-monitoring', icon: <Activity size={18} />, label: 'Live Monitoring' },
    { path: '/alerts-reports', icon: <ShieldAlert size={18} />, label: 'Alerts & Reports' },
    { path: '/analytics', icon: <BarChart3 size={18} />, label: 'Analytics' },
    { path: '/settings', icon: <Settings size={18} />, label: 'Settings' },
    { path: '/profile', icon: <User size={18} />, label: 'Profile' },
  ];

  const initials = currentUser ? currentUser.username.slice(0, 2).toUpperCase() : 'AD';

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-[#0a0a0f] text-gray-900 dark:text-gray-100 font-sans transition-colors duration-200">
      {/* Sidebar */}
      <aside className="w-72 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0f0f17] flex flex-col relative z-10 shadow-sm shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5 text-red-600 dark:text-red-500 font-bold text-xl tracking-tight">
            <Flame className="w-6 h-6 fill-current" />
            <span>FireGuard<span className="text-gray-900 dark:text-white font-black ml-1">AI</span></span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-3 custom-scrollbar">
          <p className="px-3 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Main Menu</p>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-[14px] font-semibold transition-all duration-150 ${
                    isActive
                      ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
                  }`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></div>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {isConnected ? 'System Online' : 'Connecting...'}
            </span>
          </div>
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-gray-50 dark:bg-[#0a0a0f]">
        {/* Top Header */}
        <header className="h-16 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-[#0f0f17]/80 backdrop-blur-md flex items-center justify-between px-8 z-10">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white capitalize">
            {location.pathname.replace('/', '').replace('-', ' ')}
          </h1>
          <div className="flex items-center gap-4">
            
            {/* Interactive Bell Dropdown Popover */}
            <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className={`p-2 rounded-full transition-colors relative text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5`}
                aria-label="Notification Center"
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] w-4.5 h-4.5 rounded-full flex items-center justify-center font-bold ring-2 ring-white dark:ring-[#0f0f17]">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[#0f0f17] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl z-[9999] overflow-hidden flex flex-col max-h-96">
                  <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-slate-900/50 flex items-center justify-between">
                    <span className="font-semibold text-sm text-gray-900 dark:text-white">Alert Notifications</span>
                    {unreadCount > 0 && (
                      <button 
                        onClick={() => markAllAsRead()}
                        className="text-xs text-red-500 hover:text-red-400 font-medium"
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>
                  
                  <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-gray-100 dark:divide-gray-800">
                    {notifHistory.length === 0 ? (
                      <div className="p-8 text-center text-xs text-gray-500">
                        No notification history
                      </div>
                    ) : (
                      notifHistory.map((n) => {
                        const severityColors = 
                          n.severity === 'critical' 
                            ? 'border-red-500 bg-red-500/5 text-red-400' 
                            : n.severity === 'warning' 
                              ? 'border-amber-500 bg-amber-500/5 text-amber-400' 
                              : 'border-blue-500 bg-blue-500/5 text-blue-400';

                        return (
                          <div 
                            key={n.id}
                            onClick={() => {
                              markAsRead(n.id);
                              setShowNotifications(false);
                              navigate(`/live-monitoring?cameraId=${encodeURIComponent(n.cameraId || '')}`);
                            }}
                            className={`p-3.5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer flex flex-col gap-1.5 relative border-l-2 ${n.isRead ? 'border-transparent opacity-65' : severityColors}`}
                          >
                            <div className="flex items-center justify-between text-[11px] font-mono text-gray-400">
                              <span className="capitalize font-bold">{n.alertType} Alert</span>
                              <span>{new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            </div>
                            <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                              {n.cameraName} {n.zone ? `(Zone ${n.zone})` : ''}
                            </p>
                            <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono">
                              <span>Match: {(n.confidence * 100).toFixed(0)}%</span>
                              <span className="uppercase text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300">
                                {n.severity}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  
                  {notifHistory.length > 0 && (
                    <div className="p-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-slate-900/50 text-center">
                      <button 
                        onClick={() => {
                          clearHistory();
                          setShowNotifications(false);
                        }}
                        className="text-xs text-gray-500 hover:text-red-500 font-medium py-1 w-full block transition-colors"
                      >
                        Clear Notification History
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-semibold text-gray-900 dark:text-white capitalize">{currentUser?.username?.split('@')[0] || 'Admin'}</p>
                <p className="text-xs text-gray-500 capitalize">{currentUser?.role || 'Operator'}</p>
              </div>
              <div 
                onClick={() => navigate('/profile')}
                className="h-8 w-8 rounded-full bg-gradient-to-tr from-red-500 to-orange-500 text-white flex items-center justify-center font-bold text-sm shadow-sm ring-2 ring-white dark:ring-[#0f0f17] select-none cursor-pointer hover:scale-105 transition-transform"
              >
                {initials}
              </div>
              <button
                onClick={() => {
                  logout();
                  toast('Logged out successfully', 'success');
                }}
                className="p-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                title="Sign Out"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>
        
        {/* Page Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="w-full h-full">
            <Outlet />
          </div>
        </div>

        {/* Global overlay — NotificationsHub lives outside the scroll container */}
        <NotificationsHub />
      </main>
    </div>
  );
};

export default Layout;
