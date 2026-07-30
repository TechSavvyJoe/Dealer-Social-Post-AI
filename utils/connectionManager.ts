/**
 * Connection State Manager
 * Monitors online/offline status and notifies subscribers
 */

type ConnectionListener = (online: boolean) => void;

class ConnectionManager {
  private listeners = new Set<ConnectionListener>();
  private _isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.setOnline(true));
      window.addEventListener("offline", () => this.setOnline(false));
    }
  }

  get isOnline(): boolean {
    return this._isOnline;
  }

  private setOnline(status: boolean): void {
    if (this._isOnline !== status) {
      this._isOnline = status;
      console.log(`[Connection] Status changed: ${status ? "ONLINE" : "OFFLINE"}`);
      this.notifyListeners();
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this._isOnline));
  }

  /**
   * Subscribe to connection status changes
   */
  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    // Return unsubscribe function
    return () => this.listeners.delete(listener);
  }

  /**
   * Check connection with optional health check
   */
  async checkConnection(healthCheckUrl?: string): Promise<boolean> {
    if (!this._isOnline) return false;

    if (healthCheckUrl) {
      try {
        const response = await fetch(healthCheckUrl, {
          method: "HEAD",
          cache: "no-store",
        });
        return response.ok;
      } catch {
        return false;
      }
    }

    return this._isOnline;
  }

  /**
   * Wait for connection to be restored
   */
  async waitForConnection(timeoutMs: number = 30000): Promise<boolean> {
    if (this._isOnline) return true;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);

      const unsubscribe = this.subscribe((online) => {
        if (online) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }
}

// Singleton instance
export const connectionManager = new ConnectionManager();
