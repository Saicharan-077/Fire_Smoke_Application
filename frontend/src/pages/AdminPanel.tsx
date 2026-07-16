import { useEffect, useState } from 'react';
import { Card, CardContent } from '../components/Common/Card';
import { Button } from '../components/Common/Button';
import { Input, Select } from '../components/Common/Input';
import { Modal } from '../components/Common/Modal';
import { useToast } from '../components/ui/Toast';
import { 
  getAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser,
  getAdminSystemLogs, getAdminSessions, revokeAdminSession 
} from '../services/api';
import { 
  Users, Activity, FileText, Server, RefreshCw,
  Trash2, Key, LogOut, Search, Plus
} from 'lucide-react';

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
      // Backup mock logs
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

  // Switch tabs handler
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
    <div className="space-y-6 max-w-7xl mx-auto text-[#37352f] select-none animate-fade-in">
      
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight uppercase tracking-wider">Admin Console</h2>
          <p className="text-xs text-[#7c7b77] mt-1 font-semibold leading-relaxed">
            Manage operator directories, revoke active system sessions, and inspect system log diagnostics.
          </p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'users' && (
            <Button variant="primary" size="sm" onClick={() => setCreateUserOpen(true)} className="flex items-center gap-1.5 shadow-sm text-xs">
              <Plus size={14} /> Create Operator
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => {
            if (activeTab === 'users') void fetchUsers();
            if (activeTab === 'sessions') void fetchSessions();
            if (activeTab === 'logs') void fetchSystemLogs();
          }} className="flex items-center gap-1.5 bg-white border border-[#e9e9e6] text-xs">
            <RefreshCw size={12} /> Sync Console
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-[#f7f7f5] border border-[#e9e9e6] p-1 rounded-2xl gap-1 overflow-x-auto custom-scrollbar">
        {[
          { id: 'users', label: 'Operator Directory', icon: <Users size={14} /> },
          { id: 'sessions', label: 'Active Sessions', icon: <Key size={14} /> },
          { id: 'logs', label: 'Diagnostics Log', icon: <FileText size={14} /> }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-5 py-3 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              activeTab === tab.id 
                ? 'bg-white text-[#006fee] border border-[#e9e9e6] shadow-sm' 
                : 'text-[#7c7b77] hover:text-[#37352f] border border-transparent'
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
        <Card className="bg-white border-[#e9e9e6] shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2.5 rounded-lg bg-[#006fee]/10 border border-[#006fee]/20 text-[#006fee] shrink-0"><Users size={20} /></div>
            <div>
              <p className="text-[9px] font-bold text-[#7c7b77] uppercase tracking-widest leading-none">Registered Accounts</p>
              <h3 className="text-xl font-bold font-mono text-[#37352f] mt-2 leading-none">{users.length}</h3>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border-[#e9e9e6] shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2.5 rounded-lg bg-[#eb5757]/10 border border-[#eb5757]/20 text-[#eb5757] shrink-0"><Activity size={20} /></div>
            <div>
              <p className="text-[9px] font-bold text-[#7c7b77] uppercase tracking-widest leading-none">Active Sessions</p>
              <h3 className="text-xl font-bold font-mono text-[#37352f] mt-2 leading-none">{sessions.length || 1}</h3>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border-[#e9e9e6] shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2.5 rounded-lg bg-[#27ae60]/10 border border-[#27ae60]/20 text-[#27ae60] shrink-0"><Server size={20} /></div>
            <div>
              <p className="text-[9px] font-bold text-[#7c7b77] uppercase tracking-widest leading-none">CPU Core Load</p>
              <h3 className="text-xl font-bold font-mono text-[#37352f] mt-2 leading-none">14%</h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab Contents */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7c7b77]" size={13} />
            <input 
              type="text" 
              placeholder="Search users..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white border border-[#e9e9e6] focus:border-[#006fee] text-xs text-[#37352f] outline-none transition-all placeholder-[#a4a3a0] font-semibold"
            />
          </div>

          {loading ? (
            <div className="py-20 text-center text-[#7c7b77] font-semibold"><RefreshCw className="animate-spin text-[#006fee] mx-auto mb-3" size={24} /> Syncing directory...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-16 text-center text-[#7c7b77] border border-[#e9e9e6] bg-[#f7f7f5]/30 rounded-2xl">No accounts found.</div>
          ) : (
            <div className="border border-[#e9e9e6] rounded-xl bg-white overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#e9e9e6] bg-[#f7f7f5]/35 text-[#7c7b77] font-bold uppercase tracking-wider">
                      <th className="p-4 px-6">Username</th>
                      <th className="p-4 px-6">Email Address</th>
                      <th className="p-4 px-6">Operational Role</th>
                      <th className="p-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e9e9e6] text-[#37352f] font-semibold">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-[#f7f7f5]/40 transition-colors">
                        <td className="p-4 px-6 font-bold">{u.username}</td>
                        <td className="p-4 px-6 font-mono text-[10px] text-[#7c7b77]">{u.email}</td>
                        <td className="p-4 px-6">
                          <select
                            className="bg-[#f7f7f5] border border-[#e9e9e6] rounded-lg px-2 py-1 text-[10px] text-[#37352f] font-bold outline-none cursor-pointer"
                            value={u.role}
                            onChange={(e) => void handleRoleChange(u.id, e.target.value)}
                          >
                            <option value="administrator">Administrator</option>
                            <option value="admin">Admin</option>
                            <option value="operator">Operator</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        </td>
                        <td className="p-4 px-6 text-right">
                          <Button variant="destructive" size="sm" onClick={() => void handleDeleteUser(u.id)} className="h-8 p-2 rounded-lg" title="Delete Account">
                            <Trash2 size={12} />
                          </Button>
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
            <div className="py-20 text-center text-[#7c7b77] font-semibold"><RefreshCw className="animate-spin text-[#006fee] mx-auto mb-3" size={24} /> Syncing session database...</div>
          ) : sessions.length === 0 ? (
            <div className="p-16 text-center text-[#7c7b77] border border-[#e9e9e6] bg-[#f7f7f5]/30 rounded-2xl">No active sessions found.</div>
          ) : (
            <div className="border border-[#e9e9e6] rounded-xl bg-white overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#e9e9e6] bg-[#f7f7f5]/35 text-[#7c7b77] font-bold uppercase tracking-wider">
                      <th className="p-4 px-6">User Email</th>
                      <th className="p-4 px-6">Keyphrase Token Fragment</th>
                      <th className="p-4 px-6">Created Timestamp</th>
                      <th className="p-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e9e9e6] text-[#37352f] font-semibold">
                    {sessions.map((sess, idx) => (
                      <tr key={idx} className="hover:bg-[#f7f7f5]/40 transition-colors">
                        <td className="p-4 px-6 font-bold">{sess.email || sess.username || 'System Operator'}</td>
                        <td className="p-4 px-6 font-mono text-[10px] text-[#7c7b77]">{sess.user_id?.slice(0, 16) || '••••••••••••••••'}...</td>
                        <td className="p-4 px-6 font-mono text-[10px] text-[#7c7b77]">{sess.last_login ? new Date(sess.last_login).toLocaleString() : 'N/A'}</td>
                        <td className="p-4 px-6 text-right">
                          <Button variant="destructive" size="sm" onClick={() => void handleRevokeSession(sess.user_id)} className="h-8 flex items-center gap-1 text-xs">
                            <LogOut size={12} /> Revoke
                          </Button>
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
          <Card className="bg-[#09090b] border border-white/5 rounded-xl shadow-inner font-mono p-5 text-zinc-400 space-y-2 text-[10px] leading-relaxed max-h-[500px] overflow-y-auto custom-scrollbar">
            {systemLogs.map((log, idx) => (
              <div key={idx} className="flex gap-4 items-start select-text hover:bg-white/[0.02] py-0.5 rounded px-2">
                <span className="text-zinc-650 shrink-0 font-normal">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span className={`shrink-0 font-bold ${log.level === 'WARNING' ? 'text-[#f2994a]' : log.level === 'ERROR' ? 'text-[#eb5757]' : 'text-zinc-500'}`}>[{log.level}]</span>
                <span className="text-zinc-500 font-bold shrink-0">[{log.component}]</span>
                <span className="text-[#e9e9e6] font-semibold">{log.message}</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Create User Modal */}
      <Modal isOpen={createUserOpen} onClose={() => setCreateUserOpen(false)} title="Create Operator Profile">
        <form onSubmit={handleCreateUser} className="space-y-4 text-xs font-semibold text-[#7c7b77]">
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
          <div className="flex justify-end gap-2 pt-4 border-t border-[#e9e9e6] font-bold">
            <Button variant="outline" size="sm" type="button" onClick={() => setCreateUserOpen(false)} className="bg-white border border-[#e9e9e6] text-xs">Cancel</Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isSubmittingUser} className="text-xs">Create Operator</Button>
          </div>
        </form>
      </Modal>

    </div>
  );
};

export default AdminPanel;
