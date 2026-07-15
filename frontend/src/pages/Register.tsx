import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Flame, ArrowRight, RefreshCw } from 'lucide-react';
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
            <Flame size={18} className="fill-current" />
            <span className="text-sm font-bold text-[var(--text)]">FireGuard AI</span>
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
              placeholder="operator@fireguard.ai"
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
        </form>

        <div className="text-center mt-6 text-xs text-[var(--muted)] font-medium">
          Already registered?{' '}
          <Link to="/login" className="text-blue-500 hover:underline ml-1 font-bold">
            Sign In here
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default Register;
