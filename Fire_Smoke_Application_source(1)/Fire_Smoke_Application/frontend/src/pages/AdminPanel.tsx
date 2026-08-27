import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Shield, Activity, FileText, Server, RefreshCw,
  UserPlus, Trash2, Key, UserCheck, UserX, LogOut, Search,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/Common/Card';
import { Button } from '../components/Common/Button';
import { Input } from '../components/Common/Input';
import { Badge } from '../components/Common/Badge';
import { Modal } from '../components/Common/Modal';
import { useToast } from '../components/ui/Toast';
import {
  getAdminUsers, createAdminUser, deleteAdminUser,
  resetAdminUserPassword, activateAdminUser, deactivateAdminUser,
  getAdminAuditLogs, getAdminSystemLogs, getAdminSessions, revokeAdminSession,
  getAdminHealth, getAdminStats, type AdminUser,
} from '../services/api';
import { normalizeRole } from '../utils/permissions';

type Tab = 'overview' | 'users' | 'audit' | 'system' | 'sessions';

const ROLE_OPTIONS = [
  { value: 'administrator', label: 'Administrator' },
  { value: 'operator', label: 'Operator' },
  { value: 'viewer', label: 'Viewer' },
];

const AdminPanel = () => {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', role: 'viewer' });

  const loadOverview = useCallback(async () => {
    const [h, s] = await Promise.all([getAdminHealth(), getAdminStats()]);
    setHealth(h);
    setStats(s);
  }, []);

  const loadUsers = useCallback(async () => {
    const data = await getAdminUsers({ q: search || undefined, limit: 50 });
    setUsers(data.items);
    setUserTotal(data.total);
  }, [search]);

  const loadAudit = useCallback(async () => {
    const data = await getAdminAuditLogs({ limit: 50 });
    setAuditLogs(data.items);
  }, []);

  const loadSystem = useCallback(async () => {
    const data = await getAdminSystemLogs({ limit: 50 });
    setSystemLogs(data.items);
  }, []);

  const loadSessions = useCallback(async () => {
    const data = await getAdminSessions();
    setSessions(data.sessions);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'overview') await loadOverview();
      else if (tab === 'users') await loadUsers();
      else if (tab === 'audit') await loadAudit();
      else if (tab === 'system') await loadSystem();
      else if (tab === 'sessions') await loadSessions();
    } catch (e: any) {
      toast(e.message || 'Failed to load admin data', 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, loadOverview, loadUsers, loadAudit, loadSystem, loadSessions, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleCreateUser = async () => {
    try {
      await createAdminUser(newUser);
      toast('User created successfully', 'success');
      setShowCreateModal(false);
      setNewUser({ username: '', email: '', password: '', role: 'viewer' });
      await loadUsers();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Activity size={16} /> },
    { id: 'users', label: 'Users', icon: <Users size={16} /> },
    { id: 'audit', label: 'Audit Logs', icon: <FileText size={16} /> },
    { id: 'system', label: 'System Logs', icon: <Server size={16} /> },
    { id: 'sessions', label: 'Sessions', icon: <Shield size={16} /> },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Admin Control Center</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage users, security, logs, and system health</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} isLoading={loading}>
          <RefreshCw size={16} className="mr-2" /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-800 pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-sm font-semibold transition-all ${
              tab === t.id
                ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-b-2 border-red-500'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && health && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {[
            { label: 'System Status', value: health.status, color: health.status === 'healthy' ? 'text-green-500' : 'text-amber-500' },
            { label: 'AI Model', value: health.model_ready ? 'Ready' : 'Offline', color: health.model_ready ? 'text-green-500' : 'text-red-500' },
            { label: 'Users', value: `${health.users.active}/${health.users.total}`, color: 'text-blue-500' },
            { label: 'Cameras Online', value: `${health.cameras.online}/${health.cameras.total}`, color: 'text-purple-500' },
            { label: 'Active Alerts', value: health.alerts.active, color: 'text-red-500' },
            { label: 'Live Sessions', value: health.sessions, color: 'text-cyan-500' },
          ].map((kpi) => (
            <Card key={kpi.label} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{kpi.label}</p>
                <p className={`text-2xl font-bold mt-2 ${kpi.color}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === 'overview' && stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle>Users by Role</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(stats.users_by_role).map(([role, count]) => (
                <div key={role} className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <span className="capitalize font-medium">{role}</span>
                  <Badge variant="default">{count as number}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Platform Metrics</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between"><span>Active Incidents</span><Badge variant="danger">{stats.incidents.active}</Badge></div>
              <div className="flex justify-between"><span>Total Incidents</span><Badge>{stats.incidents.total}</Badge></div>
              <div className="flex justify-between"><span>Audit Log Entries</span><Badge>{stats.audit_log_count}</Badge></div>
              <div className="flex justify-between"><span>System Log Entries</span><Badge>{stats.system_log_count}</Badge></div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'users' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>User Management ({userTotal})</CardTitle>
            <div className="flex gap-2">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input className="pl-9 w-48" placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void loadUsers()} />
              </div>
              <Button onClick={() => setShowCreateModal(true)}><UserPlus size={16} className="mr-2" />Create User</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-900/50 text-left">
                  <tr>
                    <th className="px-6 py-3 font-semibold text-gray-500">User</th>
                    <th className="px-6 py-3 font-semibold text-gray-500">Role</th>
                    <th className="px-6 py-3 font-semibold text-gray-500">Status</th>
                    <th className="px-6 py-3 font-semibold text-gray-500">Last Login</th>
                    <th className="px-6 py-3 font-semibold text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                      <td className="px-6 py-4">
                        <p className="font-semibold">{u.username}</p>
                        <p className="text-xs text-gray-500">{u.email}</p>
                      </td>
                      <td className="px-6 py-4 capitalize">{normalizeRole(u.role)}</td>
                      <td className="px-6 py-4">
                        <Badge variant={u.is_active !== 'false' ? 'success' : 'danger'}>
                          {u.is_active !== 'false' ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500">
                        {u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" title="Reset Password" onClick={async () => {
                            const pw = prompt('Enter new password (min 8 chars):');
                            if (pw && pw.length >= 8) {
                              await resetAdminUserPassword(u.id, pw);
                              toast('Password reset', 'success');
                            }
                          }}><Key size={14} /></Button>
                          {u.is_active !== 'false' ? (
                            <Button size="sm" variant="ghost" title="Deactivate" onClick={async () => { await deactivateAdminUser(u.id); toast('User deactivated', 'success'); void loadUsers(); }}><UserX size={14} /></Button>
                          ) : (
                            <Button size="sm" variant="ghost" title="Activate" onClick={async () => { await activateAdminUser(u.id); toast('User activated', 'success'); void loadUsers(); }}><UserCheck size={14} /></Button>
                          )}
                          <Button size="sm" variant="ghost" title="Delete" onClick={async () => {
                            if (confirm(`Delete ${u.email}?`)) {
                              await deleteAdminUser(u.id);
                              toast('User deleted', 'success');
                              void loadUsers();
                            }
                          }}><Trash2 size={14} className="text-red-500" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'audit' && (
        <Card>
          <CardHeader><CardTitle>Audit Logs</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-slate-900"><tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">Time</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">User</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">Action</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">Details</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="px-6 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                    <td className="px-6 py-3 font-medium">{log.username || '—'}</td>
                    <td className="px-6 py-3"><Badge>{log.action}</Badge></td>
                    <td className="px-6 py-3 text-gray-500 text-xs max-w-md truncate">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === 'system' && (
        <Card>
          <CardHeader><CardTitle>System Logs</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-slate-900"><tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">Time</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">Level</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">Source</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">Message</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {systemLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="px-6 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                    <td className="px-6 py-3"><Badge variant={log.level === 'ERROR' ? 'danger' : log.level === 'WARNING' ? 'warning' : 'default'}>{log.level}</Badge></td>
                    <td className="px-6 py-3 font-mono text-xs">{log.source}</td>
                    <td className="px-6 py-3 text-gray-500 text-xs">{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === 'sessions' && (
        <Card>
          <CardHeader><CardTitle>Active Sessions ({sessions.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">User</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">Role</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">Last Login</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-500">Expires</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-500">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {sessions.map((s) => (
                  <tr key={s.user_id}>
                    <td className="px-6 py-4"><p className="font-semibold">{s.username}</p><p className="text-xs text-gray-500">{s.email}</p></td>
                    <td className="px-6 py-4 capitalize">{s.role}</td>
                    <td className="px-6 py-4 text-xs">{s.last_login ? new Date(s.last_login).toLocaleString() : '—'}</td>
                    <td className="px-6 py-4 text-xs">{s.expires_at ? new Date(s.expires_at).toLocaleString() : '—'}</td>
                    <td className="px-6 py-4 text-right">
                      <Button size="sm" variant="danger" onClick={async () => { await revokeAdminSession(s.user_id); toast('Session revoked', 'success'); void loadSessions(); }}>
                        <LogOut size={14} className="mr-1" />Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
                {sessions.length === 0 && <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-500">No active sessions</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New User">
        <div className="space-y-4">
          <Input label="Username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
          <Input label="Email" type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
          <Input label="Password" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
            <select className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={() => void handleCreateUser()}>Create User</Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
};

export default AdminPanel;
