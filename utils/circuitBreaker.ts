/**
 * Circuit Breaker Pattern for API Resilience
 * Prevents cascading failures by failing fast when service is degraded
 */

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  /** Failures older than this window stop counting toward the open threshold. */
  failureWindow?: number;
}

interface CircuitStats {
  failures: number;
  successes: number;
  lastFailure: number;
  state: CircuitState;
  /** True while a single HALF_OPEN probe is in flight, so we admit only one. */
  halfOpenInFlight: boolean;
}

class CircuitBreaker {
  private stats = new Map<string, CircuitStats>();
  private defaultOptions: Required<CircuitBreakerOptions> = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000, // 30 seconds before half-open
    failureWindow: 60000, // count failures within a rolling 60s window
  };

  private getStats(service: string): CircuitStats {
    if (!this.stats.has(service)) {
      this.stats.set(service, {
        failures: 0,
        successes: 0,
        lastFailure: 0,
        state: "CLOSED",
        halfOpenInFlight: false,
      });
    }
    return this.stats.get(service)!;
  }

  /**
   * Check if request should be allowed
   */
  canRequest(service: string): boolean {
    const stats = this.getStats(service);

    if (stats.state === "CLOSED") {
      return true;
    }

    if (stats.state === "OPEN") {
      const now = Date.now();
      if (now - stats.lastFailure > this.defaultOptions.timeout) {
        // Transition to half-open and admit exactly one probe.
        stats.state = "HALF_OPEN";
        stats.successes = 0;
        stats.halfOpenInFlight = true;
        console.log(`[CircuitBreaker] ${service}: OPEN -> HALF_OPEN`);
        return true;
      }
      return false;
    }

    // HALF_OPEN — allow only a single probe at a time. Without this guard,
    // every concurrent caller (the common case right after the circuit trips)
    // passes simultaneously and hammers the degraded service.
    if (stats.halfOpenInFlight) {
      return false;
    }
    stats.halfOpenInFlight = true;
    return true;
  }

  /**
   * Record successful request
   */
  recordSuccess(service: string): void {
    const stats = this.getStats(service);
    stats.halfOpenInFlight = false;
    stats.successes++;

    if (stats.state === "HALF_OPEN") {
      if (stats.successes >= this.defaultOptions.successThreshold) {
        stats.state = "CLOSED";
        stats.failures = 0;
        stats.successes = 0;
        console.log(`[CircuitBreaker] ${service}: HALF_OPEN -> CLOSED`);
      }
    }
    // In CLOSED we deliberately do NOT decrement the failure counter per
    // success. The old code did, which meant a service failing ~50% of the
    // time kept `failures` oscillating near 0 and the breaker never opened.
    // Failures now age out via the rolling window in recordFailure instead.
  }

  /**
   * Record failed request
   */
  recordFailure(service: string): void {
    const stats = this.getStats(service);
    const now = Date.now();
    stats.halfOpenInFlight = false;
    // Roll the failure window: if the last failure is older than the window,
    // start counting fresh so `failures` reflects a recent failure *rate*.
    if (
      stats.lastFailure &&
      now - stats.lastFailure > this.defaultOptions.failureWindow
    ) {
      stats.failures = 0;
    }
    stats.failures++;
    stats.lastFailure = now;
    stats.successes = 0;

    if (stats.state === "HALF_OPEN") {
      stats.state = "OPEN";
      console.log(`[CircuitBreaker] ${service}: HALF_OPEN -> OPEN`);
    } else if (stats.failures >= this.defaultOptions.failureThreshold) {
      stats.state = "OPEN";
      console.log(
        `[CircuitBreaker] ${service}: CLOSED -> OPEN (${stats.failures} failures)`,
      );
    }
  }

  /**
   * Get current state for monitoring
   */
  getState(service: string): CircuitState {
    return this.getStats(service).state;
  }

  /**
   * Reset circuit breaker
   */
  reset(service: string): void {
    this.stats.delete(service);
    console.log(`[CircuitBreaker] ${service}: RESET`);
  }
}

// Singleton instance
export const circuitBreaker = new CircuitBreaker();

/**
 * Wrap an async function with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  service: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!circuitBreaker.canRequest(service)) {
    throw new Error(
      `Service ${service} is currently unavailable. Please try again later.`,
    );
  }

  try {
    const result = await operation();
    circuitBreaker.recordSuccess(service);
    return result;
  } catch (error) {
    circuitBreaker.recordFailure(service);
    throw error;
  }
}
