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
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6 text-[var(--text)] select-none font-sans relative overflow-hidden">
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
            <h2 className="text-base font-bold tracking-tight text-[var(--text)]">Recover Access</h2>
            <p className="text-[11px] text-[var(--text-3)] mt-1 font-semibold">Enter your registered email address to receive reset instructions</p>
          </div>
        </div>

        {isSuccess ? (
          <div className="space-y-4 text-center animate-slide-up">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-xl text-xs font-semibold leading-relaxed">
              Recovery link generated! In a mock database environment, a reset token is dispatched for email: <strong className="text-[var(--text)] select-all">{email}</strong>.
            </div>
            <p className="text-[10px] text-[var(--text-3)] font-semibold">Please review your inbox or junk/spam folders for reset instructions.</p>
            <button
              onClick={() => navigate('/login')}
              className="w-full py-2 border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] text-xs font-bold text-[var(--text)] rounded-xl transition-all duration-200 shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
            >
              <ArrowLeft size={13} /> Back to Sign In
            </button>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-3 bg-[var(--fire-bg)] border border-[var(--fire-border)] text-[var(--fire-text)] rounded-xl text-xs font-semibold">
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
                  className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)]/30 border border-[var(--border)] focus:ring-2 focus:ring-sky-100 focus:border-sky-500 text-xs text-[var(--text)] outline-none transition-all placeholder-[var(--text-3)] font-semibold"
                  placeholder="operator@sentinelos.ai"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2 bg-sky-600 hover:bg-sky-700 text-xs font-bold text-white rounded-xl transition-all duration-200 shadow-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 hover:-translate-y-0.5 active:translate-y-0"
              >
                {isLoading ? <RefreshCw className="animate-spin" size={13} /> : 'Send Recovery Instructions'}
                {!isLoading && <Send size={13} />}
              </button>
            </form>

            <div className="text-center mt-6 text-xs font-bold border-t border-[var(--border)] pt-4">
              <Link to="/login" className="text-sky-600 hover:underline transition-colors flex items-center justify-center gap-1 font-bold">
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
