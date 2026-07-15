import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { loginApi } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Flame, Eye, EyeOff, ShieldAlert, ArrowRight, Lock, User as UserIcon } from 'lucide-react';
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
    <div className="min-h-screen bg-white flex items-center justify-center p-6 relative overflow-hidden font-sans text-[#37352f] selection:bg-[#006fee]/10 selection:text-[#006fee]">
      {/* Decorative Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(55,53,47,0.01)_1px,transparent_1px)] bg-[size:100%_40px] pointer-events-none opacity-50" />

      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-sm bg-white border border-[#e9e9e6] rounded-xl p-8 shadow-lg relative z-10"
      >
        <div className="flex flex-col items-center text-center space-y-3 mb-6">
          <div 
            onClick={() => navigate('/')}
            className="p-2 rounded-lg bg-[#eb5757]/10 text-[#eb5757] border border-[#eb5757]/20 flex items-center justify-center cursor-pointer hover:scale-105 transition-all"
          >
            <Flame size={16} className="fill-current" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-[#37352f]">System Login</h2>
            <p className="text-[11px] text-[#7c7b77] mt-1 font-semibold">Access the FireGuard AI SOC Workspace</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-3 rounded-lg bg-[#fdebeb] border border-[#f8cfcf] flex items-start gap-2 text-xs text-[#eb5757] font-semibold"
            >
              <ShieldAlert size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-[#7c7b77] block">Operator Email</label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7c7b77]" size={13} />
              <input
                type="text"
                placeholder="Username or email address"
                value={usernameOrEmail}
                onChange={(e) => setUsernameOrEmail(e.target.value)}
                disabled={isLoading}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#fbfbfa] border border-[#e9e9e6] focus:border-[#006fee] text-xs text-[#37352f] outline-none transition-all placeholder-[#a4a3a0] font-semibold"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[#7c7b77]">Keyphrase Code</label>
              <span 
                onClick={() => navigate('/forgot-password')}
                className="text-[10px] text-[#7c7b77] hover:text-[#37352f] hover:underline cursor-pointer font-bold transition-all"
              >
                Reset
              </span>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7c7b77]" size={13} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Security keyphrase"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="w-full pl-9 pr-9 py-2 rounded-lg bg-[#fbfbfa] border border-[#e9e9e6] focus:border-[#006fee] text-xs text-[#37352f] outline-none transition-all placeholder-[#a4a3a0] font-semibold"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7c7b77] hover:text-[#37352f] transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-[#7c7b77] font-semibold pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={isLoading}
                className="w-3.5 h-3.5 rounded border-[#e9e9e6] bg-[#fbfbfa] accent-[#006fee] outline-none"
              />
              <span>Remember Device</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 rounded-lg bg-[#006fee] hover:bg-[#005bc5] text-xs font-bold text-white transition-all shadow-sm cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {isLoading ? 'Decrypting profile...' : 'Authenticate'} <ArrowRight size={13} />
          </button>

          <p className="text-center text-[10px] text-[#7c7b77] font-bold pt-2 border-t border-[#e9e9e6]">
            No credentials?{' '}
            <span 
              onClick={() => navigate('/register')}
              className="text-[#006fee] hover:underline cursor-pointer transition-all"
            >
              Request Access
            </span>
          </p>
        </form>
      </motion.div>
    </div>
  );
};

export default Login;
