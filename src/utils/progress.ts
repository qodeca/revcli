import { logger } from "./logger.js";

export class BatchProgress {
  private total: number;
  private completed = 0;
  private failed = 0;
  private startTime = Date.now();

  constructor(total: number) {
    this.total = total;
  }

  success(name: string, reviewCount: number): void {
    this.completed++;
    logger.success(
      `[${this.completed + this.failed}/${this.total}] ${name}: ${reviewCount} reviews`,
    );
  }

  failure(name: string, error: string): void {
    this.failed++;
    logger.error(
      `[${this.completed + this.failed}/${this.total}] ${name}: ${error}`,
    );
  }

  summary(): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    logger.info(
      `Batch complete: ${this.completed} succeeded, ${this.failed} failed in ${elapsed}s`,
    );
  }
}
