import './popup.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

class ErrorBoundary extends React.Component<{ children?: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') console.error('[Popup ErrorBoundary] Uncaught error:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center justify-center p-4">
          <div className="text-4xl mb-4">⚠</div>
          <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm text-gray-400 mb-4 text-center max-w-sm">
            An unexpected error occurred while loading Nest. Refresh the popup to try again.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-medium"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => window.open('https://help.nestapp.com', '_blank')}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm text-gray-200"
            >
              Get help
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}
