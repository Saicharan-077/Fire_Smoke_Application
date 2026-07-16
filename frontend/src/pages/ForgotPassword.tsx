import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, ArrowLeft, RefreshCw, Send } from 'lucide-react';
import { forgotPasswordApi } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { motion } from 'framer-motion';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      setError(null);
      await forgotPasswordApi({ email });
      setIsSuccess(true);
      toast('Mock reset link generated successfully.', 'success');
    } catch (err: any) {
      setError(err.message || 'Forgot password request failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-alt)] flex items-center justify-center p-6 text-[var(--text)] select-none font-sans">
      <motion.div 
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-sm p-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm"
      >
        <div className="text-center mb-8">
          <div 
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-[var(--primary)] font-bold text-lg cursor-pointer hover:scale-[1.02] transition-transform"
          >
            <Shield size={18} className="fill-current" />
            <span className="text-sm font-bold text-[var(--text)]">SentinelOS</span>
          </div>
          <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wider mt-1">Recover account access</p>
        </div>

        {isSuccess ? (
          <div className="space-y-4 text-center animate-slide-up">
            <div className="p-3 bg-green-100 dark:bg-green-950/20 border border-green-200 dark:border-green-900/30 text-green-700 dark:text-green-400 rounded-md text-xs font-semibold leading-relaxed">
              Recovery link generated! In a mock database environment, a reset token is dispatched for email: <strong className="text-[var(--text)] select-all">{email}</strong>.
            </div>
            <p className="text-[10px] text-[var(--muted)] font-medium">Please review your inbox or junk/spam folders for reset instructions.</p>
            <button
              onClick={() => navigate('/login')}
              className="w-full py-2 btn-ghost text-xs uppercase font-bold tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            >
              <ArrowLeft size={13} /> Back to Sign In
            </button>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-xs font-semibold">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider">Registered Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full input"
                  placeholder="operator@sentinelos.ai"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2 btn-primary text-xs uppercase tracking-wider font-bold mt-4 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isLoading ? <RefreshCw className="animate-spin" size={13} /> : 'Send Recovery Instructions'}
                {!isLoading && <Send size={13} />}
              </button>
            </form>

            <div className="text-center mt-6 text-xs text-[var(--muted)] font-bold uppercase tracking-wider">
              <Link to="/login" className="hover:text-[var(--text)] transition-colors flex items-center justify-center gap-1">
                <ArrowLeft size={12} /> Back to Sign In
              </Link>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
};

export default ForgotPassword;
