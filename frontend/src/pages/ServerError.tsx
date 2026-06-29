import { useNavigate } from 'react-router-dom';
import { ServerCrash } from 'lucide-react';
import { Button } from '../components/Common/Button';

const ServerError = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center select-none animate-fade-in">
      <div className="p-4 bg-rose-500/10 rounded-full mb-6">
        <ServerCrash size={48} className="text-rose-500" />
      </div>
      <h1 className="text-5xl font-black text-gray-900 dark:text-white mb-2">500</h1>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Internal Server Error</h2>
      <p className="text-sm text-slate-400 max-w-md mb-8">
        An unexpected error occurred on the server. Our engineering team has been alerted. Please try again shortly or contact support.
      </p>
      <div className="flex gap-3">
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
        <Button variant="primary" size="sm" onClick={() => navigate('/dashboard')}>
          Return to Dashboard
        </Button>
      </div>
    </div>
  );
};

export default ServerError;
