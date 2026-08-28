import { useNavigate } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { Button } from '../components/Common/Button';

const NotFound = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center select-none animate-fade-in">
      <div className="p-4 bg-indigo-500/10 rounded-full mb-6">
        <SearchX size={48} className="text-indigo-500" />
      </div>
      <h1 className="text-5xl font-black text-gray-900 dark:text-white mb-2">404</h1>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Page Not Found</h2>
      <p className="text-sm text-slate-400 max-w-md mb-8">
        The resource you are looking for does not exist or has been relocated. Verify the URL and try again.
      </p>
      <Button variant="primary" size="sm" onClick={() => navigate('/dashboard')}>
        Return to Dashboard
      </Button>
    </div>
  );
};

export default NotFound;
