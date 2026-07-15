import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { loginApi } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Flame, Eye, EyeOff, ShieldAlert, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

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

  const validate = () => {
    if (!usernameOrEmail.trim()) {
      return 'Username or Email is required';
    }
    if (!password) {
      return 'Password is required';
    }
    return null;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await loginApi({
        username_or_email: usernameOrEmail,
        password,
        remember_me: rememberMe,
      });

      login(res.token, res.user);
      toast('Login successful', 'success');
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--text)] px-4 font-sans select-none">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-sm border border-[var(--border)] bg-[var(--surface)] p-8 rounded-lg shadow-sm"
      >
        <div className="flex flex-col items-center mb-8">
          <div 
            onClick={() => navigate('/')}
            className="w-10 h-10 bg-red-500/10 border border-red-500/15 rounded-md flex items-center justify-center text-red-500 mb-3 cursor-pointer hover:scale-[1.02] transition-transform"
          >
            <Flame size={18} className="fill-current" />
          </div>
          <h2 className="text-base font-bold text-[var(--text)] tracking-tight">Log in to FireGuard AI</h2>
          <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wider mt-1">SOC security console</p>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-semibold rounded-md flex items-start gap-2 leading-relaxed"
          >
            <ShieldAlert size={14} className="shrink-0 mt-0.5" />
            <div>{error}</div>
          </motion.div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider">Username or Email</label>
            <input
              type="text"
              placeholder="e.g. operator@fireguard.ai"
              value={usernameOrEmail}
              onChange={(e) => setUsernameOrEmail(e.target.value)}
              disabled={isLoading}
              className="w-full input"
              required
            />
          </div>

          <div className="space-y-1 relative">
            <div className="flex justify-between items-center">
              <label className="block text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider">Password</label>
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="text-[10px] text-zinc-500 hover:text-blue-500 font-semibold cursor-pointer"
              >
                Forgot key?
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="w-full input pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="remember"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={isLoading}
              className="w-3.5 h-3.5 rounded border-[var(--border)] text-blue-500 focus:ring-blue-500/20"
            />
            <label htmlFor="remember" className="text-xs text-[var(--text-2)] font-semibold cursor-pointer select-none">
              Remember my session
            </label>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full btn-primary py-2 mt-4 text-xs tracking-wider uppercase font-bold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            Authenticate <ArrowRight size={13} />
          </button>
        </form>

        <div className="text-center mt-6 text-xs text-[var(--muted)] font-medium">
          New operator account?{' '}
          <button 
            onClick={() => navigate('/register')} 
            className="text-blue-500 hover:underline ml-1 cursor-pointer font-bold"
          >
            Register operator
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
