import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleRecovery = () => {
    try {
      const sessionStr = localStorage.getItem("dealer_post_session");
      if (sessionStr) {
        const session = JSON.parse(sessionStr);
        // Strip corrupt generation payloads or error state
        delete session.generatedPost;
        delete session.error;
        // Direct back to capture screen
        session.step = 2; // CAPTURE step
        localStorage.setItem("dealer_post_session", JSON.stringify(session));
      }
    } catch (e) {
      localStorage.clear();
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4">
          <div className="glass p-8 max-w-md w-full text-center border-red-500/30 rounded-2xl shadow-2xl">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Something went wrong</h1>
            <p className="text-surface-300 mb-6 text-sm">
              We encountered an unexpected error. Try recovering your session below.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleRecovery}
                className="px-5 py-2.5 bg-gradient-to-r from-primary-500 to-indigo-600 hover:brightness-110 text-white font-semibold rounded-xl transition-all active:scale-[0.98]"
              >
                Fast Recovery
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 bg-white/10 border border-white/10 hover:bg-white/15 text-white font-semibold rounded-xl transition-all active:scale-[0.98]"
              >
                Full Reload
              </button>
            </div>
            {this.state.error && (
              <div className="mt-6 p-4 bg-black/30 rounded-lg text-left overflow-auto max-h-48">
                <p className="text-xs font-mono text-red-300 whitespace-pre-wrap">
                  {this.state.error.toString()}
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
