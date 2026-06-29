import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Flame, User, Mail, Lock, ShieldCheck, ArrowRight, RefreshCw } from 'lucide-react';
import { registerApi } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { motion } from 'framer-motion';

const Register = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('operator');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="min-h-screen bg-[#06060a] flex items-center justify-center p-6 relative overflow-hidden text-gray-200 select-none">
      {/* Background blobs */}
      <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-red-600/10 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/3 w-96 h-96 bg-orange-600/5 rounded-full blur-[120px] pointer-events-none"></div>

      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-md p-8 rounded-3xl bg-[#0d0d14]/80 border border-white/5 shadow-2xl backdrop-blur-md relative z-10"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-red-500 font-bold text-2xl tracking-tight mb-2">
            <Flame className="w-8 h-8 fill-current" />
            <span>FireGuard<span className="text-white font-black ml-1">AI</span></span>
          </div>
          <p className="text-gray-400 text-sm">Register new security operations operator account</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-xs font-semibold">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Username</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500"><User size={16} /></span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/5 focus:border-red-500/30 focus:ring-1 focus:ring-red-500/30 text-white outline-none transition-all text-sm font-semibold"
                placeholder="operator_johndoe"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Email Address</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500"><Mail size={16} /></span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/5 focus:border-red-500/30 focus:ring-1 focus:ring-red-500/30 text-white outline-none transition-all text-sm font-semibold"
                placeholder="operator@fireguard.ai"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Password</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500"><Lock size={16} /></span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/5 focus:border-red-500/30 focus:ring-1 focus:ring-red-500/30 text-white outline-none transition-all text-sm font-semibold"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Confirm</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500"><Lock size={16} /></span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/5 focus:border-red-500/30 focus:ring-1 focus:ring-red-500/30 text-white outline-none transition-all text-sm font-semibold"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">System Access Role</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500"><ShieldCheck size={16} /></span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#141420] border border-white/5 focus:border-red-500/30 text-white outline-none transition-all text-sm font-semibold appearance-none"
              >
                <option value="operator">Operator (Standard)</option>
                <option value="viewer">Viewer (Read-Only)</option>
                <option value="administrator">Administrator (Full Control)</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-6 py-3.5 rounded-xl bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 font-bold text-white text-sm transition-all shadow-[0_0_15px_rgba(239,68,68,0.2)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? <RefreshCw className="animate-spin" size={16} /> : 'Complete Registration'}
            {!isLoading && <ArrowRight size={16} />}
          </button>
        </form>

        <div className="text-center mt-6 text-xs font-semibold text-gray-500">
          Already registered?{' '}
          <Link to="/login" className="text-red-500 hover:text-red-400 transition-colors">
            Sign In here
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default Register;
