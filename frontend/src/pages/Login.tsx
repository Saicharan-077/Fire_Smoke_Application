import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { loginApi, googleAuthApi } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Flame, Eye, EyeOff, ShieldAlert, ArrowRight, Lock, User as UserIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { Modal } from '../components/Common/Modal';

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const login = useAuthStore((s) => s.login);

  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
        action: 'login',
      });
      localStorage.setItem('fg-token', res.token);
      login(res.token, res.user);
      toast(`Access Granted. Welcome, ${res.user.username}!`, 'success');
      navigate('/dashboard');
    } catch (err: any) {
      toast(err.message || 'Google authentication failed', 'error');
    } finally {
      setGoogleLoading(false);
      setGoogleModalOpen(false);
    }
  };

  const validate = () => {
    if (!usernameOrEmail.trim()) {
      return 'Username or Email is required';
    }
    if (!password) {
      return 'Password is required';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      toast(validationError, 'error');
      return;
    }

    setIsLoading(true);
    try {
      const res = await loginApi({
        username_or_email: usernameOrEmail,
        password: password,
      });

      // Save token
      localStorage.setItem('fg-token', res.token);
      
      // Update store
      login(res.token, res.user);
      
      toast(`Access Granted. Welcome, ${res.user.username}!`, 'success');
      navigate('/dashboard');
    } catch (err: any) {
      const msg = err.message || 'Authentication failed. Verify credentials.';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6 relative overflow-hidden font-sans text-[var(--text)] selection:bg-[var(--primary-light)] selection:text-[var(--primary)]">
      {/* Decorative Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(128,128,128,0.015)_1px,transparent_1px)] bg-[size:100%_40px] pointer-events-none opacity-50" />

      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-sm bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 shadow-lg relative z-10"
      >
        <div className="flex flex-col items-center text-center space-y-3 mb-6">
          <div 
            onClick={() => navigate('/')}
            className="p-2 rounded-lg bg-[var(--fire-bg)] text-[var(--fire-text)] border border-[var(--fire-border)] flex items-center justify-center cursor-pointer hover:scale-105 transition-all"
          >
            <Flame size={16} className="fill-current" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-[var(--text)]">System Login</h2>
            <p className="text-[11px] text-[var(--text-3)] mt-1 font-semibold">Access the FireGuard AI SOC Workspace</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-3 rounded-lg bg-[var(--fire-bg)] border border-[var(--fire-border)] flex items-start gap-2 text-xs text-[var(--fire-text)] font-semibold"
            >
              <ShieldAlert size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-2)] block">Operator Email</label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" size={13} />
              <input
                type="text"
                placeholder="Username or email address"
                value={usernameOrEmail}
                onChange={(e) => setUsernameOrEmail(e.target.value)}
                disabled={isLoading}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--primary)] text-xs text-[var(--text)] outline-none transition-all placeholder-[var(--text-3)] font-semibold"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-2)]">Keyphrase Code</label>
              <span 
                onClick={() => navigate('/forgot-password')}
                className="text-[10px] text-[var(--text-3)] hover:text-[var(--text)] hover:underline cursor-pointer font-bold transition-all"
              >
                Reset
              </span>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" size={13} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Security keyphrase"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="w-full pl-9 pr-9 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--primary)] text-xs text-[var(--text)] outline-none transition-all placeholder-[var(--text-3)] font-semibold"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-[var(--text-2)] font-semibold pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={isLoading}
                className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--bg)] accent-[var(--primary)] outline-none"
              />
              <span>Remember Device</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-xs font-bold text-white transition-all shadow-sm cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {isLoading ? 'Decrypting profile...' : 'Authenticate'} <ArrowRight size={13} />
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
            Continue with Google
          </button>

          <p className="text-center text-[10px] text-[var(--text-3)] font-bold pt-2 border-t border-[var(--border)]">
            No credentials?{' '}
            <span 
              onClick={() => navigate('/register')}
              className="text-[var(--primary)] hover:underline cursor-pointer transition-all"
            >
              Request Access
            </span>
          </p>
        </form>
      </motion.div>

      {/* Google Account Simulator Modal */}
      <Modal isOpen={googleModalOpen} onClose={() => setGoogleModalOpen(false)} title="Google Account Simulator">
        <div className="space-y-4 text-xs font-semibold text-[var(--text-2)] font-sans">
          <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
            Select a mock Google identity to simulate OAuth single sign-on authentication:
          </p>
          <div className="space-y-2">
            {[
              { name: 'John Doe', email: 'johndoe@gmail.com', id: 'google_john_123', desc: 'Viewer Access (Auto-Creates Account)' },
              { name: 'Jane Smith', email: 'janesmith@gmail.com', id: 'google_jane_456', desc: 'Operator Access (Auto-Creates Account)' },
              { name: 'Admin Demo', email: 'admin@fireguard.ai', id: 'google_admin_789', desc: 'Auto-Links & Bypasses Password' }
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
              Sign In Custom Simulated Account
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Login;
