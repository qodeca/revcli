import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/core/rate-limiter.js";

describe("RateLimiter", () => {
  it("enforces minimum delay between calls", async () => {
    const limiter = new RateLimiter(100);
    const start = Date.now();
    await limiter.wait();
    await limiter.wait();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90); // Allow 10ms tolerance
  });

  it("does not delay first call", async () => {
    const limiter = new RateLimiter(1000);
    const start = Date.now();
    await limiter.wait();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
