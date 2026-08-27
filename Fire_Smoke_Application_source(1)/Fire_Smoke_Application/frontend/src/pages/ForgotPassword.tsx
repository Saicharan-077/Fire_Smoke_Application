import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Flame, Mail, ArrowLeft, RefreshCw, Send } from 'lucide-react';
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
    setError(null);
    setIsLoading(true);

    try {
      await forgotPasswordApi({ email });
      setIsSuccess(true);
      toast('Verification instructions sent to email!', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to request recovery link.');
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
          <p className="text-gray-400 text-sm">Recover secure operations account access</p>
        </div>

        {isSuccess ? (
          <div className="space-y-6 text-center">
            <div className="p-4 bg-green-500/10 border border-green-500/20 text-green-400 rounded-2xl text-sm font-semibold">
              Recovery link generated! In a live environment, a password reset payload is transmitted to: <strong className="text-white">{email}</strong>.
            </div>
            <p className="text-xs text-gray-400">Please review your inbox or junk/spam directories for instructions.</p>
            <button
              onClick={() => navigate('/login')}
              className="w-full py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 font-bold text-sm text-center transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <ArrowLeft size={16} /> Back to Sign In
            </button>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-xs font-semibold">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
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

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 font-bold text-white text-sm transition-all shadow-[0_0_15px_rgba(239,68,68,0.2)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isLoading ? <RefreshCw className="animate-spin" size={16} /> : 'Send Recovery Instructions'}
                {!isLoading && <Send size={16} />}
              </button>
            </form>

            <div className="text-center mt-6 text-xs font-semibold text-gray-500">
              <Link to="/login" className="hover:text-gray-300 transition-colors flex items-center justify-center gap-1.5">
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
