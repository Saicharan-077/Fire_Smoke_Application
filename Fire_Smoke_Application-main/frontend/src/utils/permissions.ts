export type UserRole = 'administrator' | 'admin' | 'operator' | 'viewer';

export function normalizeRole(role?: string | null): UserRole {
  const r = (role || 'viewer').toLowerCase();
  if (r === 'admin') return 'administrator';
  if (r === 'administrator' || r === 'operator' || r === 'viewer') return r;
  return 'viewer';
}

export function isAdmin(role?: string | null): boolean {
  const r = normalizeRole(role);
  return r === 'administrator';
}

export function isOperator(role?: string | null): boolean {
  const r = normalizeRole(role);
  return r === 'administrator' || r === 'operator';
}

export function isViewer(role?: string | null): boolean {
  return normalizeRole(role) === 'viewer';
}

export type Permission =
  | 'dashboard'
  | 'detection'
  | 'live_monitoring'
  | 'alerts_reports'
  | 'analytics'
  | 'settings'
  | 'profile'
  | 'admin'
  | 'manage_cameras'
  | 'manage_alerts'
  | 'manage_incidents'
  | 'manage_users'
  | 'upload_detection';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  administrator: [
    'dashboard', 'detection', 'live_monitoring', 'alerts_reports', 'analytics',
    'settings', 'profile', 'admin', 'manage_cameras', 'manage_alerts',
    'manage_incidents', 'manage_users', 'upload_detection',
  ],
  admin: [
    'dashboard', 'detection', 'live_monitoring', 'alerts_reports', 'analytics',
    'settings', 'profile', 'admin', 'manage_cameras', 'manage_alerts',
    'manage_incidents', 'manage_users', 'upload_detection',
  ],
  operator: [
    'dashboard', 'detection', 'live_monitoring', 'alerts_reports', 'analytics',
    'settings', 'profile', 'manage_cameras', 'manage_alerts', 'manage_incidents',
    'upload_detection',
  ],
  viewer: [
    'dashboard', 'alerts_reports', 'analytics', 'profile',
  ],
};

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  const normalized = normalizeRole(role);
  return ROLE_PERMISSIONS[normalized]?.includes(permission) ?? false;
}

export function canAccessRoute(role: string | null | undefined, path: string): boolean {
  const routeMap: Record<string, Permission> = {
    '/dashboard': 'dashboard',
    '/detection': 'detection',
    '/live-monitoring': 'live_monitoring',
    '/alerts-reports': 'alerts_reports',
    '/analytics': 'analytics',
    '/settings': 'settings',
    '/profile': 'profile',
    '/admin': 'admin',
  };
  const permission = routeMap[path];
  if (!permission) return true;
  return hasPermission(role, permission);
}

export const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', permission: 'dashboard' as Permission },
  { path: '/detection', label: 'Detection', permission: 'detection' as Permission },
  { path: '/live-monitoring', label: 'Live Monitoring', permission: 'live_monitoring' as Permission },
  { path: '/alerts-reports', label: 'Alerts & Reports', permission: 'alerts_reports' as Permission },
  { path: '/analytics', label: 'Analytics', permission: 'analytics' as Permission },
  { path: '/settings', label: 'Settings', permission: 'settings' as Permission },
  { path: '/admin', label: 'Admin Panel', permission: 'admin' as Permission },
  { path: '/profile', label: 'Profile', permission: 'profile' as Permission },
];
