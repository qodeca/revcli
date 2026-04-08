/**
 * Simple rate limiter with configurable delay between operations.
 * Used to space out requests when scraping multiple locations.
 */
export class RateLimiter {
  private lastCallTime = 0;
  private readonly minDelayMs: number;

  constructor(minDelayMs: number) {
    this.minDelayMs = minDelayMs;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    const remaining = this.minDelayMs - elapsed;

    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }

    this.lastCallTime = Date.now();
  }
}
