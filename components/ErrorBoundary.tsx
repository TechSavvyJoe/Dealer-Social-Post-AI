import React, { Component, ErrorInfo, ReactNode } from "react";
import { logError } from "../utils/telemetry";
import { clearAllCreatives } from "../utils/creativeStorage";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

/**
 * Top-level error boundary. When React unwinds an unrecoverable render error
 * we land here. Actions offered (ordered by destructiveness):
 *   1. Try again         — re-render the boundary (works if the error was transient)
 *   2. Reset session     — clear localStorage / SW caches and reload (works if state is corrupt)
 *   3. Refresh page      — hard reload
 *   4. Copy details      — dumps the stack trace for support
 *
 * Telemetry is best-effort and never re-throws.
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("[ErrorBoundary]", error, errorInfo);

    // Keep crash telemetry inside the same redacted envelope as every other
    // client error. Raw messages, stacks, URLs, and user agents can contain
    // customer or credential data and must never be sent to the persistence
    // endpoint.
    try {
      const errorName = error?.name || "Error";
      const errorCode = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(errorName)
        ? errorName
        : "RENDER_ERROR";
      logError("app.render.crash", {
        errorCode,
        kind: "render_error",
        target: "react_boundary",
      });
    } catch {
      /* swallow */
    }
  }

  private handleTryAgain = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
  };

  private handleResetSession = async () => {
    try {
      // Revoke the server-side cookie when the API is reachable. A client-only
      // reset would immediately restore the same session on the next load.
      try {
        await fetch("/api/app/session", {
          method: "DELETE",
          credentials: "include",
          cache: "no-store",
        });
      } catch {
        /* backend unavailable — local recovery must still continue */
      }
      await clearAllCreatives();
      // Clear app state in localStorage
      try {
        Object.keys(localStorage).forEach((k) => {
          if (
            k.startsWith("dealer-social-post-ai") ||
            k.startsWith("dsp.") ||
            k.startsWith("app.")
          ) {
            localStorage.removeItem(k);
          }
        });
      } catch {
        /* localStorage unavailable */
      }
      // Try to clear caches (only available in secure contexts)
      if ("caches" in window) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        } catch {
          /* ignore */
        }
      }
      // Unregister service workers so a stuck shell doesn't keep crashing
      if ("serviceWorker" in navigator) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        } catch {
          /* ignore */
        }
      }
    } finally {
      window.location.replace("/");
    }
  };

  private handleCopyDetails = async () => {
    if (!this.state.error) return;
    const text = [
      `Error: ${this.state.error.message}`,
      "",
      "Stack:",
      this.state.error.stack || "(no stack)",
      "",
      "Component stack:",
      this.state.errorInfo?.componentStack || "(no component stack)",
      "",
      `URL: ${window.location.href}`,
      `User-Agent: ${navigator.userAgent}`,
      `When: ${new Date().toISOString()}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      /* clipboard failed — fall back to a download */
      try {
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `dealer-social-post-ai-error-${Date.now()}.txt`;
        link.click();
        URL.revokeObjectURL(url);
      } catch {
        /* nothing we can do */
      }
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4">
          <div className="glass-card p-8 max-w-lg w-full text-center border border-red-500/30 rounded-2xl bg-surface-900/80 backdrop-blur-xl">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-8 h-8 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Something went wrong</h1>
            <p className="text-surface-300 mb-6 text-sm">
              The app hit an unexpected error. Try one of these — they go from least to
              most destructive.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={this.handleTryAgain}
                className="px-4 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors text-sm font-semibold"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-lg transition-colors text-sm"
              >
                Refresh page
              </button>
              <button
                onClick={this.handleResetSession}
                className="px-4 py-2.5 bg-warning-600/30 hover:bg-warning-600/50 border border-warning-500/40 text-warning-100 rounded-lg transition-colors text-sm"
                title="Clears local storage, caches, and the service worker, then reloads. Use when the app is stuck after a deploy."
              >
                Reset session
              </button>
              <button
                onClick={this.handleCopyDetails}
                className="px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-lg transition-colors text-sm"
              >
                {this.state.copied ? "Copied" : "Copy error details"}
              </button>
            </div>
            {this.state.error && (
              <details className="mt-6 p-3 bg-black/30 rounded-lg text-left overflow-auto max-h-48">
                <summary className="text-xs text-surface-400 cursor-pointer select-none">
                  Technical details
                </summary>
                <pre className="text-xs font-mono text-red-300 whitespace-pre-wrap mt-2">
                  {this.state.error.toString()}
                  {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
