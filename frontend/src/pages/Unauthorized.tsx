import { useNavigate } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { Button } from '../components/Common/Button';

const Unauthorized = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center select-none animate-fade-in">
      <div className="p-4 bg-red-500/10 rounded-full mb-6">
        <ShieldOff size={48} className="text-red-500" />
      </div>
      <h1 className="text-5xl font-black text-gray-900 dark:text-white mb-2">401</h1>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Authentication Required</h2>
      <p className="text-sm text-slate-400 max-w-md mb-8">
        Your session has expired or you are not authenticated. Please sign in with valid credentials to access this resource.
      </p>
      <Button variant="primary" size="sm" onClick={() => navigate('/login')}>
        Return to Login
      </Button>
    </div>
  );
};

export default Unauthorized;
