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
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6 text-[var(--text)] font-sans select-none relative overflow-hidden">
      {/* Decorative Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(128,128,128,0.015)_1px,transparent_1px)] bg-[size:100%_40px] pointer-events-none opacity-50" />

      <motion.div 
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-sm p-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-md relative z-10"
      >
        <div className="flex flex-col items-center text-center space-y-3 mb-6">
          <div 
            onClick={() => navigate('/')}
            className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 border border-sky-100 dark:border-sky-900/30 flex items-center justify-center cursor-pointer hover:scale-105 transition-all shadow-xs"
          >
            <Shield size={16} className="fill-current" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-[var(--text)]">System Registration</h2>
            <p className="text-[11px] text-[var(--text-3)] mt-1 font-semibold">Create operator credentials for FireGuard AI</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-[var(--fire-bg)] border border-[var(--fire-border)] text-[var(--fire-text)] rounded-xl text-xs font-semibold">
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
              className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)]/30 border border-[var(--border)] focus:ring-2 focus:ring-sky-100 focus:border-sky-500 text-xs text-[var(--text)] outline-none transition-all placeholder-[var(--text-3)] font-semibold"
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
              className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)]/30 border border-[var(--border)] focus:ring-2 focus:ring-sky-100 focus:border-sky-500 text-xs text-[var(--text)] outline-none transition-all placeholder-[var(--text-3)] font-semibold"
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
                className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)]/30 border border-[var(--border)] focus:ring-2 focus:ring-sky-100 focus:border-sky-500 text-xs text-[var(--text)] outline-none transition-all placeholder-[var(--text-3)] font-semibold"
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
                className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)]/30 border border-[var(--border)] focus:ring-2 focus:ring-sky-100 focus:border-sky-500 text-xs text-[var(--text)] outline-none transition-all placeholder-[var(--text-3)] font-semibold"
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
              className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)]/30 border border-[var(--border)] focus:ring-2 focus:ring-sky-100 focus:border-sky-500 text-xs text-[var(--text)] outline-none transition-all cursor-pointer font-semibold"
            >
              <option value="operator">Operator (Standard)</option>
              <option value="viewer">Viewer (Read-Only)</option>
              <option value="administrator">Administrator (Full Control)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 bg-sky-600 hover:bg-sky-700 text-xs font-bold text-white rounded-xl transition-all duration-200 shadow-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 hover:-translate-y-0.5 active:translate-y-0"
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
            className="w-full py-2 border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] text-xs font-bold text-[var(--text)] rounded-xl transition-all duration-200 shadow-xs cursor-pointer flex items-center justify-center gap-2 hover:-translate-y-0.5 active:translate-y-0"
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
              <path fill="#EA4335" d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.2-5.142 4.2A5.86 5.86 0 0 1 8 12.743a5.86 5.86 0 0 1 5.985-5.86 5.72 5.72 0 0 1 4.028 1.637l3.1-3.1A10.15 10.15 0 0 0 13.985 2 10.24 10.24 0 0 0 4 12.243a10.24 10.24 0 0 0 9.985 10.243c5.686 0 9.77-3.924 9.77-9.742a9 9 0 0 0-.153-1.959z"/>
            </svg>
            Register with Google
          </button>
        </form>

        <div className="text-center mt-6 text-xs font-medium border-t border-[var(--border)] pt-4 text-[var(--text-3)]">
          Already registered?{' '}
          <Link to="/login" className="text-sky-600 hover:underline ml-1 font-bold">
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
                <span className="text-[9px] font-black uppercase text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-2 py-0.5 rounded-xl border border-sky-100 dark:border-sky-900/30">
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
              className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--border)] focus:ring-2 focus:ring-sky-100 focus:border-sky-500 text-xs outline-none transition-all placeholder-[var(--text-3)] font-semibold"
            />
            <button
              type="button"
              disabled={googleLoading || !customEmail}
              onClick={() => handleGoogleAuth(customEmail, customEmail.split('@')[0], `google_custom_${customEmail.replace(/[^a-zA-Z0-9]/g, '')}`)}
              className="w-full py-2 bg-sky-600 hover:bg-sky-700 text-xs font-bold text-white rounded-xl transition-all duration-200 shadow-xs cursor-pointer disabled:opacity-50 hover:-translate-y-0.5 active:translate-y-0"
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
