import { useEffect, useState } from 'react';
import { Card, CardContent } from '../components/Common/Card';
import { Button } from '../components/Common/Button';
import { Input } from '../components/Common/Input';
import { useToast } from '../components/ui/Toast';
import { useAuthStore } from '../store/authStore';
import { getAuditLogs, updateProfileApi } from '../services/api';
import { User, Shield, Key, LogOut, RefreshCw, Activity } from 'lucide-react';

const ProfileMerged = () => {
  const { toast } = useToast();
  const { currentUser, logout } = useAuthStore();
  
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [updating, setUpdating] = useState(false);

  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [changingPassword, setChangingPassword] = useState(false);

  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

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
      await updateProfileApi({ username, email });
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
    setChangingPassword(true);
    // Simulate API call
    await new Promise((r) => setTimeout(r, 1000));
    setChangingPassword(false);
    toast('Password changed successfully.', 'success');
    setPasswordForm({ current: '', new: '', confirm: '' });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 select-none">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Account Profile</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage credentials, review active roles, and audit security log histories.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* User Info & Password */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <CardContent className="p-6">
              <h3 className="font-bold text-sm text-white flex items-center gap-2 mb-4">
                <User size={16} className="text-red-500" /> Account Details
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
                <div>
                  <label className="block text-xs font-bold text-slate-450 uppercase tracking-wider mb-2">Access Role</label>
                  <input 
                    type="text" 
                    value={role} 
                    disabled 
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-850 border border-slate-800 text-xs font-bold text-slate-450 cursor-not-allowed capitalize"
                  />
                </div>
                <div className="flex justify-end">
                  <Button variant="primary" size="sm" type="submit" isLoading={updating}>Save Changes</Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <CardContent className="p-6">
              <h3 className="font-bold text-sm text-white flex items-center gap-2 mb-4">
                <Key size={16} className="text-red-500" /> Change Password
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
          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f17]">
            <CardContent className="p-5 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-sm text-white flex items-center gap-2">
                  <Activity size={16} className="text-red-500" /> Audit Log
                </h3>
                <button onClick={loadAuditTrail} className="text-slate-400 hover:text-white">
                  <RefreshCw size={12} />
                </button>
              </div>

              {loadingLogs ? (
                <div className="py-8 text-center text-xs text-slate-500">Loading logs...</div>
              ) : auditLogs.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">No logs captured.</div>
              ) : (
                <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {auditLogs.slice(0, 10).map((log) => (
                    <div key={log.id} className="p-2.5 rounded-lg border border-slate-850 bg-slate-900/30 text-[11px]">
                      <div className="flex justify-between text-slate-500 font-mono">
                        <span className="font-bold text-slate-400">{log.action}</span>
                        <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="text-slate-350 mt-1">{log.details}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-red-500/20 bg-red-500/5">
            <CardContent className="p-5 space-y-3 text-center">
              <Shield className="text-red-500 w-10 h-10 mx-auto animate-pulse" />
              <h4 className="font-bold text-xs text-white">Log Out Session</h4>
              <p className="text-[10px] text-slate-400">Terminate current session keys and return to landing portal.</p>
              <Button variant="destructive" size="sm" className="w-full flex items-center justify-center gap-1" onClick={() => { logout(); toast('Logged out.', 'success'); }}>
                <LogOut size={12} /> Sign Out
              </Button>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
};

export default ProfileMerged;
