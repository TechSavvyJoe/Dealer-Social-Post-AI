/**
 * Request Cache with TTL (Time To Live)
 * Caches API responses to reduce redundant requests
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class RequestCache {
  private cache = new Map<string, CacheEntry<any>>();
  private pendingRequests = new Map<string, Promise<any>>();
  // Hard cap so a long-lived SPA session keying on dynamic inputs (prompts,
  // image URLs) can't grow this Map unbounded and leak memory. Map preserves
  // insertion order, so the first key is the least-recently-used.
  private maxSize = 200;

  /**
   * Get cached data if valid
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    // LRU touch: move to the end so eviction targets genuinely stale keys.
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data as T;
  }

  /**
   * Set cached data with TTL
   */
  set<T>(key: string, data: T, ttlMs: number = 60000): void {
    // Refresh recency if the key already exists.
    this.cache.delete(key);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    });
    // Evict least-recently-used entries past the cap.
    while (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  /**
   * Delete cached entry
   */
  delete(key: string): void {
    this.cache.delete(key);
    this.pendingRequests.delete(key);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Deduplicate concurrent requests
   * If the same request is in flight, return the pending promise
   */
  async deduplicatedRequest<T>(
    key: string,
    requestFn: () => Promise<T>,
    ttlMs: number = 60000,
  ): Promise<T> {
    // Check cache first
    const cached = this.get<T>(key);
    if (cached !== null) {
      console.log(`[Cache] HIT: ${key}`);
      return cached;
    }

    // Check if request is already in flight
    if (this.pendingRequests.has(key)) {
      console.log(`[Cache] DEDUP: ${key}`);
      return this.pendingRequests.get(key) as Promise<T>;
    }

    // Execute request
    console.log(`[Cache] MISS: ${key}`);
    const promise = requestFn()
      .then((result) => {
        this.set(key, result, ttlMs);
        this.pendingRequests.delete(key);
        return result;
      })
      .catch((error) => {
        this.pendingRequests.delete(key);
        throw error;
      });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  /**
   * Get cache stats for monitoring
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Singleton instance
export const requestCache = new RequestCache();
