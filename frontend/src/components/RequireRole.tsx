import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { canAccessRoute, hasPermission, type Permission } from '../utils/permissions';

interface RequireRoleProps {
  permission?: Permission;
  path?: string;
  children?: React.ReactNode;
}

export function RequireRole({ permission, path, children }: RequireRoleProps) {
  const role = useAuthStore((s) => s.currentUser?.role);

  if (path && !canAccessRoute(role, path)) {
    return <Navigate to="/forbidden" replace />;
  }

  if (permission && !hasPermission(role, permission)) {
    return <Navigate to="/forbidden" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
