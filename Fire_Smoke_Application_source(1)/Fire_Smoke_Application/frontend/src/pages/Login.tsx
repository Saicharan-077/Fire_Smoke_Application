import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { loginApi } from '../services/api';
import { Button } from '../components/Common/Button';
import { Input } from '../components/Common/Input';
import { useToast } from '../components/ui/Toast';
import { Flame, Eye, EyeOff, ShieldAlert } from 'lucide-react';
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
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] text-gray-100 font-sans relative overflow-hidden px-4">
      {/* Background Gradients & Effects */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-red-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 80, delay: 0.1 }}
        className="w-full max-w-md bg-[#11111a] border border-gray-800/80 rounded-3xl p-8 z-10 shadow-2xl relative"
      >
        <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-red-500 via-orange-500 to-indigo-500 rounded-t-3xl" />

        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center text-red-500 mb-3 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
            <Flame className="w-7 h-7 fill-current" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Security Command Login</h2>
          <p className="text-gray-400 text-sm mt-1">FIREGUARD AI • INDUSTRIAL SOC MONITORING</p>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl flex items-start gap-2.5"
          >
            <ShieldAlert size={18} className="shrink-0 mt-0.5" />
            <div>{error}</div>
          </motion.div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <Input
            label="Username or Email"
            type="text"
            placeholder="admin@fireguard.ai"
            value={usernameOrEmail}
            onChange={(e) => setUsernameOrEmail(e.target.value)}
            disabled={isLoading}
            className="bg-[#0f0f15] border-gray-800 focus:border-red-500 text-white rounded-xl"
          />

          <div className="relative">
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              className="bg-[#0f0f15] border-gray-800 focus:border-red-500 text-white rounded-xl pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-[38px] text-gray-500 hover:text-gray-300 transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={isLoading}
                className="w-4.5 h-4.5 rounded border-gray-800 bg-[#0f0f15] text-red-500 focus:ring-red-500/20 focus:ring-offset-0"
              />
              Remember session
            </label>
            <button
              type="button"
              onClick={() => navigate('/forgot-password')}
              className="text-xs text-red-500 hover:text-red-400 font-medium hover:underline transition-all"
            >
              Forgot Password?
            </button>
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full bg-red-600 hover:bg-red-500 active:bg-red-700 text-white py-3 rounded-xl font-semibold border-none shadow-[0_4px_20px_rgba(220,38,38,0.25)] transition-all hover:translate-y-[-1px]"
            isLoading={isLoading}
          >
            Authenticate Command Session
          </Button>
        </form>
      </motion.div>
    </div>
  );
};

export default Login;
