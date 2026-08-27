import { useAuthStore } from '../store/authStore';
import { canAccessRoute, hasPermission, type Permission } from '../utils/permissions';

export function usePermissions() {
  const role = useAuthStore((s) => s.currentUser?.role);
  return {
    role,
    hasPermission: (p: Permission) => hasPermission(role, p),
    canAccessRoute: (path: string) => canAccessRoute(role, path),
    isAdmin: hasPermission(role, 'admin'),
    isOperator: hasPermission(role, 'upload_detection'),
    isViewer: !hasPermission(role, 'upload_detection') && hasPermission(role, 'dashboard'),
  };
}
