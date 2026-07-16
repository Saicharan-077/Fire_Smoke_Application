import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, ArrowRight, RefreshCw } from 'lucide-react';
import { registerApi, googleAuthApi } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { motion } from 'framer-motion';
import { Modal } from '../components/Common/Modal';
import { useAuthStore } from '../store/authStore';

const Register = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const login = useAuthStore((s) => s.login);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('operator');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [googleModalOpen, setGoogleModalOpen] = useState(false);
  const [customEmail, setCustomEmail] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleAuth = async (email: string, name: string, googleId: string) => {
    setGoogleLoading(true);
    try {
      const res = await googleAuthApi({
        email,
        google_id: googleId,
        username: name.split(' ')[0].toLowerCase() + '_' + Math.floor(Math.random() * 100),
        action: 'register',
      });
      localStorage.setItem('fg-token', res.token);
      login(res.token, res.user);
      toast(`Registration successful! Logged in as ${res.user.username}.`, 'success');
      navigate('/dashboard');
    } catch (err: any) {
      toast(err.message || 'Google registration failed', 'error');
    } finally {
      setGoogleLoading(false);
      setGoogleModalOpen(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username || !email || !password || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setIsLoading(true);
    try {
      await registerApi({
        username,
        email,
        password,
        role,
      });
      toast('Registration successful! Please sign in.', 'success');
      navigate('/login');
    } catch (err: any) {
      setError(err.message || 'Failed to complete registration.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6 text-[var(--text)] font-sans select-none">
      <motion.div 
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-sm p-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm"
      >
        <div className="text-center mb-8">
          <div 
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-red-500 font-bold text-lg cursor-pointer hover:scale-[1.02] transition-transform"
          >
            <Shield size={18} className="fill-current" />
            <span className="text-sm font-bold text-[var(--text)]">SentinelOS</span>
          </div>
          <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wider mt-1">Create operator credentials</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-md text-xs font-semibold">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full input"
              placeholder="e.g. operator_johndoe"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full input"
              placeholder="operator@sentinelos.ai"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full input"
                placeholder="••••••••"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider">Confirm</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full input"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider">Access clearance role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full input cursor-pointer"
            >
              <option value="operator">Operator (Standard)</option>
              <option value="viewer">Viewer (Read-Only)</option>
              <option value="administrator">Administrator (Full Control)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 btn-primary text-xs uppercase tracking-wider font-bold mt-4 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {isLoading ? <RefreshCw className="animate-spin" size={13} /> : 'Complete Registration'}
            {!isLoading && <ArrowRight size={13} />}
          </button>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-[var(--border)]"></div>
            <span className="flex-shrink mx-3 text-[10px] text-[var(--text-3)] font-bold uppercase">Or</span>
            <div className="flex-grow border-t border-[var(--border)]"></div>
          </div>

          <button
            type="button"
            onClick={() => setGoogleModalOpen(true)}
            className="w-full py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] text-xs font-bold text-[var(--text)] transition-all shadow-sm cursor-pointer flex items-center justify-center gap-2"
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
              <path fill="#EA4335" d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.2-5.142 4.2A5.86 5.86 0 0 1 8 12.743a5.86 5.86 0 0 1 5.985-5.86 5.72 5.72 0 0 1 4.028 1.637l3.1-3.1A10.15 10.15 0 0 0 13.985 2 10.24 10.24 0 0 0 4 12.243a10.24 10.24 0 0 0 9.985 10.243c5.686 0 9.77-3.924 9.77-9.742a9 9 0 0 0-.153-1.959z"/>
            </svg>
            Register with Google
          </button>
        </form>

        <div className="text-center mt-6 text-xs text-[var(--muted)] font-medium">
          Already registered?{' '}
          <Link to="/login" className="text-blue-500 hover:underline ml-1 font-bold">
            Sign In here
          </Link>
        </div>
      </motion.div>

      {/* Google Account Simulator Modal */}
      <Modal isOpen={googleModalOpen} onClose={() => setGoogleModalOpen(false)} title="Google Account Simulator">
        <div className="space-y-4 text-xs font-semibold text-[var(--text-2)] font-sans">
          <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
            Select a mock Google identity to register/link via Google OAuth simulation:
          </p>
          <div className="space-y-2">
            {[
              { name: 'John Doe', email: 'johndoe@gmail.com', id: 'google_john_123', desc: 'Viewer Access (Auto-Creates Account)' },
              { name: 'Jane Smith', email: 'janesmith@gmail.com', id: 'google_jane_456', desc: 'Operator Access (Auto-Creates Account)' },
              { name: 'Admin Demo', email: 'admin@sentinelos.ai', id: 'google_admin_789', desc: 'Auto-Links & Bypasses Password' }
            ].map((acc) => (
              <button
                key={acc.id}
                type="button"
                disabled={googleLoading}
                onClick={() => handleGoogleAuth(acc.email, acc.name, acc.id)}
                className="w-full text-left p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)] transition-all cursor-pointer flex justify-between items-center"
              >
                <div>
                  <p className="text-[12px] font-bold text-[var(--text)]">{acc.name}</p>
                  <p className="text-[10px] text-[var(--text-3)] font-mono">{acc.email}</p>
                </div>
                <span className="text-[9px] font-black uppercase text-[var(--primary)] bg-[var(--primary-light)] px-2 py-0.5 rounded-md border border-[var(--primary-ring)]">
                  {acc.desc.split(' ')[0]}
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
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--primary)] text-xs outline-none transition-all placeholder-[var(--text-3)] font-semibold"
            />
            <button
              type="button"
              disabled={googleLoading || !customEmail}
              onClick={() => handleGoogleAuth(customEmail, customEmail.split('@')[0], `google_custom_${customEmail.replace(/[^a-zA-Z0-9]/g, '')}`)}
              className="w-full py-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-xs font-bold text-white transition-all shadow-sm cursor-pointer disabled:opacity-50"
            >
              Register Custom Simulated Account
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Register;
