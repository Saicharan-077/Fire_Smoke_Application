import { useEffect, useState } from 'react';
import { Card, CardContent } from '../components/Common/Card';
import { Button } from '../components/Common/Button';
import { Input } from '../components/Common/Input';
import { useToast } from '../components/ui/Toast';
import { useAuthStore } from '../store/authStore';
import { getAuditLogs, updateProfileApi, changePasswordApi, linkGoogleApi } from '../services/api';
import { User, Shield, Key, LogOut, RefreshCw, Activity, Cpu, ShieldAlert } from 'lucide-react';
import { useAppSettingsStore } from '../store/appSettingsStore';
import { Modal } from '../components/Common/Modal';

const Profile = () => {
  const { toast } = useToast();
  const { currentUser, token, login, logout } = useAuthStore();
  const { theme, setTheme } = useAppSettingsStore();
  
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [updating, setUpdating] = useState(false);

  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [changingPassword, setChangingPassword] = useState(false);

  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [googleModalOpen, setGoogleModalOpen] = useState(false);
  const [customEmail, setCustomEmail] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

  const loadAuditTrail = async () => {
    try {
      setLoadingLogs(true);
      const data = await getAuditLogs();
      setAuditLogs(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      setUsername(currentUser.username || '');
      setEmail(currentUser.email || '');
      setRole(currentUser.role || 'Operator');
    }
    void loadAuditTrail();
  }, [currentUser]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    try {
      const res = await updateProfileApi({ username, email });
      login(token || '', res);
      toast('Profile updated successfully.', 'success');
    } catch (err: any) {
      toast(err.message || 'Profile update failed.', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.new !== passwordForm.confirm) {
      toast('New passwords do not match.', 'error');
      return;
    }
    if (passwordForm.new.length < 8) {
      toast('Password must be at least 8 characters.', 'error');
      return;
    }
    setChangingPassword(true);
    try {
      await changePasswordApi({
        current_password: passwordForm.current,
        new_password: passwordForm.new,
        confirm_password: passwordForm.confirm,
      });
      toast('Password changed successfully.', 'success');
      setPasswordForm({ current: '', new: '', confirm: '' });
    } catch (err: any) {
      toast(err.message || 'Password change failed.', 'error');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleLinkGoogle = async (gEmail: string, googleId: string) => {
    setGoogleLoading(true);
    try {
      const res = await linkGoogleApi({ email: gEmail, google_id: googleId });
      login(res.token || token || '', res.user);
      toast('Google account linked successfully.', 'success');
    } catch (err: any) {
      toast(err.message || 'Google account linking failed.', 'error');
    } finally {
      setGoogleLoading(false);
      setGoogleModalOpen(false);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return 'U';
    return name.split('@')[0].slice(0, 2).toUpperCase();
  };

  const initials = getInitials(currentUser?.username || currentUser?.email || '');

  return (
    <div className="space-y-6 max-w-6xl mx-auto text-[var(--text)] font-sans select-none pb-12">
      {/* Cover Header */}
      <div 
        className="relative h-44 w-full rounded-2xl overflow-hidden border border-[var(--border)] bg-gradient-to-r from-sky-400/20 via-blue-500/10 to-indigo-600/20"
      >
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg)] to-transparent" />
      </div>
 
      {/* Avatar Initials Overlap */}
      <div className="relative -mt-16 ml-6 mb-4 flex items-end justify-between px-2">
        <div className="relative flex">
          <div className="h-24 w-24 rounded-2xl bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-400 border-4 border-[var(--surface)] flex items-center justify-center text-2xl font-black font-mono shadow-md z-10 select-none">
            {initials}
          </div>
        </div>
      </div>
 
      <div>
        <h2 className="text-xl font-bold tracking-tight uppercase px-2 text-[var(--text)]">Account Profile</h2>
        <p className="text-xs text-[var(--text-2)] mt-1 px-2 font-semibold leading-relaxed">Manage credentials, review active roles, and audit security log histories inside FireGuard AI.</p>
      </div>
 
      {/* Platform & Detection Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 px-2">
        {/* Card 1: AI Vision Engine Stats */}
        <div className="border border-[var(--border)] bg-[var(--surface)] p-5 rounded-2xl shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-[var(--text-3)] uppercase tracking-wider">AI Vision Engine Stats</span>
            <Cpu size={14} className="text-sky-500" />
          </div>
          <div className="space-y-2 text-xs font-semibold text-[var(--text-2)]">
            <div className="flex justify-between border-b border-[var(--border)]/50 pb-1.5">
              <span>Total Inference:</span>
              <span className="text-[var(--text)] font-mono">148,290 frames</span>
            </div>
            <div className="flex justify-between border-b border-[var(--border)]/50 pb-1.5">
              <span>Average Speed:</span>
              <span className="text-[var(--text)] font-mono">12.4 ms / frame</span>
            </div>
            <div className="flex justify-between">
              <span>System SLA:</span>
              <span className="text-[var(--text)] font-mono">99.98% uptime</span>
            </div>
          </div>
        </div>
 
        {/* Card 2: Detection Analytics */}
        <div className="border border-[var(--border)] bg-[var(--surface)] p-5 rounded-2xl shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-[var(--text-3)] uppercase tracking-wider">Detection Analytics</span>
            <ShieldAlert size={14} className="text-rose-500" />
          </div>
          <div className="space-y-2 text-xs font-semibold text-[var(--text-2)]">
            <div className="flex justify-between border-b border-[var(--border)]/50 pb-1.5">
              <span>Fires Spotted:</span>
              <span className="text-[var(--text)] font-mono">14 anomalies</span>
            </div>
            <div className="flex justify-between border-b border-[var(--border)]/50 pb-1.5">
              <span>Smokes Spotted:</span>
              <span className="text-[var(--text)] font-mono">22 anomalies</span>
            </div>
            <div className="flex justify-between">
              <span>False Alarms Blocked:</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-mono">3,124 frames</span>
            </div>
          </div>
        </div>
 
        {/* Card 3: Operator Logistics */}
        <div className="border border-[var(--border)] bg-[var(--surface)] p-5 rounded-2xl shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-[var(--text-3)] uppercase tracking-wider">Operator Logistics</span>
            <Activity size={14} className="text-sky-600" />
          </div>
          <div className="space-y-2 text-xs font-semibold text-[var(--text-2)]">
            <div className="flex justify-between border-b border-[var(--border)]/50 pb-1.5">
              <span>Organization:</span>
              <span className="text-[var(--text)] font-mono">Sentinel Security Labs</span>
            </div>
            <div className="flex justify-between border-b border-[var(--border)]/50 pb-1.5">
              <span>Avg Response Time:</span>
              <span className="text-[var(--text)] font-mono">4.2 seconds</span>
            </div>
            <div className="flex justify-between">
              <span>Active Incident Tickets:</span>
              <span className="text-[var(--text)] font-mono">1 pending</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* User Info & Password */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border border-[var(--border)] bg-[var(--surface)] shadow-xs">
            <CardContent className="p-6">
              <h3 className="font-bold text-xs text-[var(--text)] uppercase tracking-wider flex items-center gap-2 mb-4">
                <User size={16} className="text-[var(--primary)]" /> Account Details
              </h3>
              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input 
                    label="Username" 
                    value={username} 
                    onChange={(e) => setUsername(e.target.value)} 
                  />
                  <Input 
                    label="Email Address" 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                  />
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider mb-2">Access Role</label>
                    <input 
                      type="text" 
                      value={role} 
                      disabled 
                      className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface-2)]/55 border border-[var(--border)] text-xs font-bold text-[var(--text-3)] cursor-not-allowed capitalize outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider mb-2">Theme Preference</label>
                    <select 
                      value={theme}
                      onChange={(e) => setTheme(e.target.value as any)}
                      className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs font-bold text-[var(--text)] cursor-pointer outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500 transition-all"
                    >
                      <option value="light">Light Mode</option>
                      <option value="dark">Dark Mode</option>
                    </select>
                  </div>
                </div>

                {/* Google SSO Linking Row */}
                <div className="p-4 border border-[var(--border)] rounded-xl bg-[var(--surface-2)]/30 flex justify-between items-center mt-2">
                  <div>
                    <p className="text-[12px] font-bold text-[var(--text)]">Google SSO Connection</p>
                    <p className="text-[10px] text-[var(--text-3)] font-mono font-bold mt-0.5">
                      {currentUser?.google_linked === 'true'
                        ? `Linked (ID: ${currentUser?.google_id})`
                        : 'Simulate Google Account Connection'}
                    </p>
                  </div>
                  {currentUser?.google_linked === 'true' ? (
                    <span className="text-[9px] font-black uppercase text-green-600 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 px-2 py-0.5 rounded-md">
                      Linked
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setGoogleModalOpen(true)}
                      className="px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] text-[11px] font-bold text-[var(--text)] cursor-pointer transition-all shadow-xs hover:-translate-y-0.5 active:translate-y-0"
                    >
                      Link Google
                    </button>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button variant="primary" size="sm" type="submit" isLoading={updating}>Save Changes</Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="border border-[var(--border)] bg-[var(--surface)] shadow-xs">
            <CardContent className="p-6">
              <h3 className="font-bold text-xs text-[var(--text)] uppercase tracking-wider flex items-center gap-2 mb-4">
                <Key size={16} className="text-[var(--primary)]" /> Change Password
              </h3>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <Input 
                  label="Current Password" 
                  type="password" 
                  value={passwordForm.current} 
                  onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })} 
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input 
                    label="New Password" 
                    type="password" 
                    value={passwordForm.new} 
                    onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })} 
                  />
                  <Input 
                    label="Confirm New Password" 
                    type="password" 
                    value={passwordForm.confirm} 
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })} 
                  />
                </div>
                <div className="flex justify-end">
                  <Button variant="primary" size="sm" type="submit" isLoading={changingPassword}>Change Password</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Audit Logs Sidebar */}
        <div className="space-y-6">
          <Card className="border border-[var(--border)] bg-[var(--surface)] shadow-xs">
            <CardContent className="p-5 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-xs text-[var(--text)] uppercase tracking-wider flex items-center gap-2">
                  <Activity size={16} className="text-[var(--fire)]" /> Audit Log
                </h3>
                <button onClick={loadAuditTrail} className="text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer">
                  <RefreshCw size={12} />
                </button>
              </div>

              {loadingLogs ? (
                <div className="py-8 text-center text-xs text-[var(--text-3)] font-semibold">Loading logs...</div>
              ) : auditLogs.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--text-3)] font-semibold">No logs captured.</div>
              ) : (
                <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {auditLogs.slice(0, 10).map((log) => (
                    <div key={log.id} className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/30 text-[11px]">
                      <div className="flex justify-between text-[var(--text-3)] font-mono font-bold">
                        <span className="text-[var(--text-2)]">{log.action}</span>
                        <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="text-[var(--text-2)] mt-1.5 font-semibold">{log.details}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-[var(--fire-border)] bg-[var(--fire-bg)]/20">
            <CardContent className="p-5 space-y-3 text-center">
              <Shield className="text-[var(--fire)] w-10 h-10 mx-auto animate-pulse" />
              <h4 className="font-bold text-xs text-[var(--text)] uppercase tracking-wider">Log Out Session</h4>
              <p className="text-[10px] text-[var(--text-3)] font-semibold leading-relaxed">Terminate current session keys and return to landing portal.</p>
              <Button variant="destructive" size="sm" className="w-full flex items-center justify-center gap-1" onClick={() => { logout(); toast('Logged out.', 'success'); }}>
                <LogOut size={12} /> Sign Out
              </Button>
            </CardContent>
          </Card>
        </div>

      </div>

      {/* Google Account Linking Modal */}
      <Modal isOpen={googleModalOpen} onClose={() => setGoogleModalOpen(false)} title="Link Google Account">
        <div className="space-y-4 text-xs font-semibold text-[var(--text-2)] font-sans">
          <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
            Link a simulated Google credentials account to your current active profile:
          </p>
          <div className="space-y-2">
            {[
              { name: 'John Doe', email: 'johndoe@gmail.com', id: 'google_john_123' },
              { name: 'Jane Smith', email: 'janesmith@gmail.com', id: 'google_jane_456' },
              { name: 'Admin Demo', email: 'admin@sentinelos.ai', id: 'google_admin_789' }
            ].map((acc) => (
              <button
                key={acc.id}
                type="button"
                disabled={googleLoading}
                onClick={() => handleLinkGoogle(acc.email, acc.id)}
                className="w-full text-left p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)] transition-all cursor-pointer flex justify-between items-center"
              >
                <div>
                  <p className="text-[12px] font-bold text-[var(--text)]">{acc.name}</p>
                  <p className="text-[10px] text-[var(--text-3)] font-mono">{acc.email}</p>
                </div>
                <span className="text-[9px] font-black uppercase text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-2 py-0.5 rounded-xl border border-sky-100 dark:border-sky-900/30">
                  Link Account
                </span>
              </button>
            ))}
          </div>

          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-[var(--border)]"></div>
            <span className="flex-shrink mx-3 text-[10px] text-[var(--text-3)] font-bold uppercase">Or Custom email</span>
            <div className="flex-grow border-t border-[var(--border)]"></div>
          </div>

          <div className="space-y-2">
            <input
              type="email"
              placeholder="operator.custom@gmail.com"
              value={customEmail}
              onChange={(e) => setCustomEmail(e.target.value)}
              disabled={googleLoading}
              className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--border)] focus:ring-2 focus:ring-sky-100 focus:border-sky-500 text-xs outline-none transition-all placeholder-[var(--text-3)] font-semibold"
            />
            <button
              type="button"
              disabled={googleLoading || !customEmail}
              onClick={() => handleLinkGoogle(customEmail, `google_custom_${customEmail.replace(/[^a-zA-Z0-9]/g, '')}`)}
              className="w-full py-2 bg-sky-600 hover:bg-sky-700 text-xs font-bold text-white rounded-xl transition-all duration-200 shadow-xs cursor-pointer hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
            >
              Link Custom Simulated Google Account
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Profile;
