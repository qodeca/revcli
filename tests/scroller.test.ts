import { describe, it, expect } from "vitest";
import {
  calculateStaleDelay,
  shouldContinueScrolling,
} from "../src/scraper/scroller.js";

describe("calculateStaleDelay", () => {
  it("returns baseDelay for staleCount=1 (2^0 = 1)", () => {
    expect(calculateStaleDelay(1, 3000)).toBe(3000);
  });

  it("returns baseDelay*2 for staleCount=2", () => {
    expect(calculateStaleDelay(2, 3000)).toBe(6000);
  });

  it("returns baseDelay*4 for staleCount=3", () => {
    expect(calculateStaleDelay(3, 3000)).toBe(12000);
  });

  it("caps at baseDelay*maxMultiplier for high staleCount values", () => {
    expect(calculateStaleDelay(10, 3000)).toBe(12000);
    expect(calculateStaleDelay(100, 3000)).toBe(12000);
  });

  it("handles staleCount=0 gracefully (returns baseDelay)", () => {
    expect(calculateStaleDelay(0, 3000)).toBe(3000);
  });

  it("works with custom maxMultiplier", () => {
    expect(calculateStaleDelay(5, 1000, 8)).toBe(8000);
    expect(calculateStaleDelay(2, 1000, 2)).toBe(2000);
    expect(calculateStaleDelay(3, 1000, 2)).toBe(2000);
  });

  it("works with different baseDelay values", () => {
    expect(calculateStaleDelay(1, 500)).toBe(500);
    expect(calculateStaleDelay(2, 500)).toBe(1000);
    expect(calculateStaleDelay(3, 500)).toBe(2000);
    expect(calculateStaleDelay(3, 1000)).toBe(4000);
  });
});

describe("shouldContinueScrolling", () => {
  it("returns true when staleCount < maxStaleScrolls", () => {
    expect(shouldContinueScrolling(0)).toBe(true);
    expect(shouldContinueScrolling(3)).toBe(true);
    expect(shouldContinueScrolling(5)).toBe(true);
  });

  it("returns false when staleCount >= maxStaleScrolls", () => {
    expect(shouldContinueScrolling(6)).toBe(false);
    expect(shouldContinueScrolling(10)).toBe(false);
  });

  it("returns false when staleCount === maxStaleScrolls", () => {
    expect(shouldContinueScrolling(6)).toBe(false);
  });

  it("works with custom maxStaleScrolls", () => {
    expect(shouldContinueScrolling(3, 3)).toBe(false);
    expect(shouldContinueScrolling(2, 3)).toBe(true);
    expect(shouldContinueScrolling(10, 10)).toBe(false);
    expect(shouldContinueScrolling(9, 10)).toBe(true);
  });

  it("returns true for staleCount=0", () => {
    expect(shouldContinueScrolling(0)).toBe(true);
  });
});
