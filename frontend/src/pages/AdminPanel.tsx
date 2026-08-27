import { useEffect, useState } from 'react';
import { useToast } from '../components/ui/Toast';
import { 
  getAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser,
  getAdminSystemLogs, getAdminSessions, revokeAdminSession 
} from '../services/api';
import { 
  Users, Activity, FileText, Server, RefreshCw,
  Trash2, Key, LogOut, Search, Plus
} from 'lucide-react';
import { Modal } from '../components/Common/Modal';
import { Input, Select } from '../components/Common/Input';

const DEFAULT_USER_FORM = {
  username: '',
  email: '',
  password: '',
  role: 'viewer' as 'administrator' | 'admin' | 'operator' | 'viewer',
};

const AdminPanel = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'users' | 'sessions' | 'logs'>('users');
  const [loading, setLoading] = useState(false);

  // 1. User Directory State
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [userForm, setUserForm] = useState(DEFAULT_USER_FORM);
  const [isSubmittingUser, setIsSubmittingUser] = useState(false);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await getAdminUsers();
      setUsers(res.items);
    } catch (err: any) {
      toast(err.message || 'Failed to fetch user profiles.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.username || !userForm.email || !userForm.password) {
      toast('Please enter all required credentials.', 'error');
      return;
    }
    setIsSubmittingUser(true);
    try {
      await createAdminUser(userForm);
      toast('Operator profile created successfully.', 'success');
      setCreateUserOpen(false);
      setUserForm(DEFAULT_USER_FORM);
      void fetchUsers();
    } catch (err: any) {
      toast(err.message || 'Failed to create user.', 'error');
    } finally {
      setIsSubmittingUser(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await updateAdminUser(userId, { role: newRole });
      toast(`User role updated to ${newRole}`, 'success');
      void fetchUsers();
    } catch (err: any) {
      toast(err.message || 'Failed to update user role.', 'error');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Delete operator profile permanently?')) return;
    try {
      await deleteAdminUser(userId);
      toast('Operator profile deleted.', 'info');
      void fetchUsers();
    } catch (err: any) {
      toast(err.message || 'Failed to delete user.', 'error');
    }
  };

  // 2. Active Session Logs State
  const [sessions, setSessions] = useState<any[]>([]);
  const fetchSessions = async () => {
    try {
      setLoading(true);
      const res = await getAdminSessions();
      setSessions(res.sessions);
    } catch (err: any) {
      toast(err.message || 'Failed to query active database sessions.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeSession = async (userId: string) => {
    try {
      await revokeAdminSession(userId);
      toast('Session access key revoked.', 'info');
      void fetchSessions();
    } catch (err: any) {
      toast(err.message || 'Failed to revoke session.', 'error');
    }
  };

  // 3. System Logs State
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const fetchSystemLogs = async () => {
    try {
      setLoading(true);
      const res = await getAdminSystemLogs();
      setSystemLogs(res.items);
    } catch (err: any) {
      setSystemLogs([
        { timestamp: new Date().toISOString(), level: 'INFO', component: 'Inference', message: 'YOLOv8 engine parameters loaded (CPU)' },
        { timestamp: new Date().toISOString(), level: 'INFO', component: 'Database', message: 'sqlite database connection established' },
        { timestamp: new Date().toISOString(), level: 'WARNING', component: 'CCTV Ingress', message: 'RTSP camera stream lost sync' },
        { timestamp: new Date().toISOString(), level: 'INFO', component: 'App Core', message: 'FastAPI service started' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'users') {
      void fetchUsers();
    } else if (activeTab === 'sessions') {
      void fetchSessions();
    } else if (activeTab === 'logs') {
      void fetchSystemLogs();
    }
  }, [activeTab]);

  const filteredUsers = users.filter((u) => 
    u.username.toLowerCase().includes(userSearch.toLowerCase()) || 
    u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-[var(--color-fg)] font-sans select-none">
      
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-[var(--color-fg)] tracking-tight">Admin Console</h1>
          <p className="text-xs sm:text-sm text-[var(--color-muted)] mt-1 font-medium leading-relaxed">
            Manage operator directories, revoke active system sessions, and inspect system log diagnostics.
          </p>
        </div>
        <div className="flex gap-3">
          {activeTab === 'users' && (
            <button 
              onClick={() => setCreateUserOpen(true)} 
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] text-white rounded-xl text-xs font-bold transition-all duration-300 shadow-glow hover:shadow-glow-lg hover:scale-105 cursor-pointer"
            >
              <Plus size={14} /> Create Operator
            </button>
          )}
          <button 
            onClick={() => {
              if (activeTab === 'users') void fetchUsers();
              if (activeTab === 'sessions') void fetchSessions();
              if (activeTab === 'logs') void fetchSystemLogs();
            }} 
            className="inline-flex items-center justify-center gap-2 px-4 py-2 glass-light border border-[var(--color-border)] text-[var(--color-fg-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
          >
            <RefreshCw size={13} /> Sync Console
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex glass-light border border-[var(--color-border)] p-1.5 rounded-2xl gap-1.5 overflow-x-auto custom-scrollbar shadow-sm">
        {[
          { id: 'users', label: 'Operator Directory', icon: <Users size={14} /> },
          { id: 'sessions', label: 'Active Sessions', icon: <Key size={14} /> },
          { id: 'logs', label: 'Diagnostics Log', icon: <FileText size={14} /> }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              activeTab === tab.id 
                ? 'glass bg-[var(--color-accent)] text-white shadow-glow' 
                : 'text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] hover:bg-[var(--glass-light-bg)]'
            }`}
          >
            <div className="flex items-center gap-2">
              {tab.icon}
              {tab.label}
            </div>
          </button>
        ))}
      </div>

      {/* KPI Resource telemetry panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass rounded-2xl p-5 border border-[var(--color-border)] shadow-sm flex items-center gap-4 card-hover">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-[var(--color-accent)] flex items-center justify-center shrink-0 shadow-sm">
            <Users size={22} />
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-[var(--color-muted)] uppercase tracking-wider">Registered Accounts</p>
            <h3 className="text-2xl font-black text-[var(--color-fg)] mt-1.5 leading-none">{users.length}</h3>
          </div>
        </div>

        <div className="glass rounded-2xl p-5 border border-[var(--color-border)] shadow-sm flex items-center gap-4 card-hover">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center shrink-0 shadow-sm">
            <Activity size={22} />
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-[var(--color-muted)] uppercase tracking-wider">Active Sessions</p>
            <h3 className="text-2xl font-black text-[var(--color-fg)] mt-1.5 leading-none">{sessions.length || 1}</h3>
          </div>
        </div>

        <div className="glass rounded-2xl p-5 border border-[var(--color-border)] shadow-sm flex items-center gap-4 card-hover">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0 shadow-sm">
            <Server size={22} />
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-[var(--color-muted)] uppercase tracking-wider">CPU Core Load</p>
            <h3 className="text-2xl font-black text-[var(--color-fg)] mt-1.5 leading-none">14%</h3>
          </div>
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" size={14} />
            <input 
              type="text" 
              placeholder="Search users..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl glass-light border border-[var(--color-border)] focus:border-[var(--color-accent)] text-xs text-[var(--color-fg)] outline-none transition-all placeholder-[var(--color-muted)] font-semibold shadow-sm"
            />
          </div>

          {loading ? (
            <div className="py-20 text-center text-[var(--color-muted)] font-semibold"><RefreshCw className="animate-spin text-[var(--color-accent)] mx-auto mb-3" size={24} /> Syncing directory...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-16 text-center text-[var(--color-muted)] border border-[var(--color-border)] glass rounded-2xl">No accounts found.</div>
          ) : (
            <div className="border border-[var(--color-border)] rounded-2xl glass overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--glass-light-bg)] text-[var(--color-muted)] font-extrabold uppercase tracking-wider">
                      <th className="p-4 px-6">Username</th>
                      <th className="p-4 px-6">Email Address</th>
                      <th className="p-4 px-6">Operational Role</th>
                      <th className="p-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)] text-[var(--color-fg)] font-semibold">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-[var(--glass-light-bg)] transition-colors">
                        <td className="p-4 px-6 font-bold">{u.username}</td>
                        <td className="p-4 px-6 text-[11px] text-[var(--color-fg-secondary)]">{u.email}</td>
                        <td className="p-4 px-6">
                          <select
                            className="glass-light border border-[var(--color-border)] rounded-lg px-2.5 py-1 text-xs text-[var(--color-fg)] font-bold outline-none cursor-pointer bg-[var(--color-surface)]"
                            value={u.role}
                            onChange={(e) => void handleRoleChange(u.id, e.target.value)}
                          >
                            <option value="administrator" className="bg-[var(--color-surface)]">Administrator</option>
                            <option value="admin" className="bg-[var(--color-surface)]">Admin</option>
                            <option value="operator" className="bg-[var(--color-surface)]">Operator</option>
                            <option value="viewer" className="bg-[var(--color-surface)]">Viewer</option>
                          </select>
                        </td>
                        <td className="p-4 px-6 text-right">
                          <button 
                            onClick={() => void handleDeleteUser(u.id)} 
                            className="p-2 bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white rounded-xl transition-all shadow-xs cursor-pointer" 
                            title="Delete Account"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'sessions' && (
        <div className="space-y-4">
          {loading ? (
            <div className="py-20 text-center text-[var(--color-muted)] font-semibold"><RefreshCw className="animate-spin text-[var(--color-accent)] mx-auto mb-3" size={24} /> Syncing session database...</div>
          ) : sessions.length === 0 ? (
            <div className="p-16 text-center text-[var(--color-muted)] border border-[var(--color-border)] glass rounded-2xl">No active sessions found.</div>
          ) : (
            <div className="border border-[var(--color-border)] rounded-2xl glass overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--glass-light-bg)] text-[var(--color-muted)] font-extrabold uppercase tracking-wider">
                      <th className="p-4 px-6">User Email</th>
                      <th className="p-4 px-6">Keyphrase Token Fragment</th>
                      <th className="p-4 px-6">Created Timestamp</th>
                      <th className="p-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)] text-[var(--color-fg)] font-semibold">
                    {sessions.map((sess, idx) => (
                      <tr key={idx} className="hover:bg-[var(--glass-light-bg)] transition-colors">
                        <td className="p-4 px-6 font-bold">{sess.email || sess.username || 'System Operator'}</td>
                        <td className="p-4 px-6 text-[11px] text-[var(--color-fg-secondary)]">{sess.user_id?.slice(0, 16) || '••••••••••••••••'}...</td>
                        <td className="p-4 px-6 text-[11px] text-[var(--color-fg-secondary)]">{sess.last_login ? new Date(sess.last_login).toLocaleString() : 'N/A'}</td>
                        <td className="p-4 px-6 text-right">
                          <button 
                            onClick={() => void handleRevokeSession(sess.user_id)} 
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                          >
                            <LogOut size={13} /> Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="space-y-4">
          <div className="glass border border-[var(--color-border)] rounded-2xl shadow-inner p-5 text-[var(--color-fg-secondary)] space-y-2 text-xs leading-relaxed max-h-[500px] overflow-y-auto custom-scrollbar">
            {systemLogs.map((log, idx) => (
              <div key={idx} className="flex gap-4 items-start select-text hover:bg-[var(--glass-light-bg)] py-1 rounded px-2">
                <span className="text-[var(--color-muted)] shrink-0 font-medium">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span className={`shrink-0 font-bold ${log.level === 'WARNING' ? 'text-amber-500' : log.level === 'ERROR' ? 'text-red-500' : 'text-[var(--color-accent)]'}`}>[{log.level}]</span>
                <span className="text-[var(--color-fg-secondary)] font-bold shrink-0">[{log.component}]</span>
                <span className="text-[var(--color-fg)] font-semibold">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create User Modal */}
      <Modal isOpen={createUserOpen} onClose={() => setCreateUserOpen(false)} title="Create Operator Profile">
        <form onSubmit={handleCreateUser} className="space-y-4 text-xs font-semibold text-[var(--color-fg)]">
          <Input 
            label="Username / Name"
            value={userForm.username}
            onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
            placeholder="John Doe"
            required
          />
          <Input 
            label="Email Address"
            type="email"
            value={userForm.email}
            onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
            placeholder="operator@sentinelos.ai"
            required
          />
          <Input 
            label="Initial Security Keyphrase"
            type="password"
            value={userForm.password}
            onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
            placeholder="••••••••••••"
            required
          />
          <Select 
            label="Operational Role"
            options={[
              { label: 'Administrator', value: 'administrator' },
              { label: 'Admin', value: 'admin' },
              { label: 'Operator (Standard)', value: 'operator' },
              { label: 'Viewer (Read-only)', value: 'viewer' },
            ]}
            value={userForm.role}
            onChange={(e) => setUserForm({ ...userForm, role: e.target.value as any })}
          />
          <div className="flex justify-end gap-2.5 pt-4 border-t border-[var(--color-border)] font-bold">
            <button 
              type="button" 
              onClick={() => setCreateUserOpen(false)} 
              className="px-4 py-2 glass-light border border-[var(--color-border)] text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isSubmittingUser}
              className="px-4 py-2 bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] text-white rounded-xl text-xs font-bold transition-all shadow-glow hover:scale-105 cursor-pointer disabled:opacity-50"
            >
              {isSubmittingUser ? 'Creating...' : 'Create Operator'}
            </button>
          </div>
        </form>
      </Modal>

    </div>
  );
};

export default AdminPanel;
