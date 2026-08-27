import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '../components/Common/Button';

const Forbidden = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center select-none animate-fade-in">
      <div className="p-4 bg-orange-500/10 rounded-full mb-6">
        <Lock size={48} className="text-orange-500" />
      </div>
      <h1 className="text-5xl font-black text-gray-900 dark:text-white mb-2">403</h1>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Access Forbidden</h2>
      <p className="text-sm text-slate-400 max-w-md mb-8">
        Your current role does not have sufficient permissions to access this resource. Contact your administrator to request elevated privileges.
      </p>
      <Button variant="primary" size="sm" onClick={() => navigate('/dashboard')}>
        Return to Dashboard
      </Button>
    </div>
  );
};

export default Forbidden;
