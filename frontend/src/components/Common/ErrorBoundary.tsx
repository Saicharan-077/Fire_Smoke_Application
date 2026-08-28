import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0a0a0f] p-8">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="text-red-500" size={32} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">Something went wrong</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                {this.state.error?.message || 'An unexpected error occurred.'}
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.href = '/dashboard'}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-500 transition-colors"
              >
                Go to Dashboard
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-sm font-semibold flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
              >
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
