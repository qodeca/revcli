import { Command, InvalidArgumentError } from "commander";
import pkg from "../package.json" with { type: "json" };
import { scrapeCommand } from "./commands/scrape.js";
import { batchCommand } from "./commands/batch.js";
import { validateCommand } from "./commands/validate.js";
import {
  authLoginCommand,
  authStatusCommand,
  authLogoutCommand,
} from "./commands/auth.js";
import { setVerbose } from "./utils/logger.js";
import { SORT_ORDERS, OUTPUT_FORMATS } from "./core/schema.js";
import type { SortOrder, OutputFormat } from "./core/schema.js";

function parsePositiveInt(value: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return n;
}

const program = new Command();

program
  .name("revcli")
  .description("Scrape Google Maps location reviews")
  .version(pkg.version);

program
  .command("scrape")
  .description("Scrape reviews from a Google Maps location")
  .argument("<url>", "Google Maps URL or Place ID")
  .option("-m, --max-reviews <n>", "maximum reviews to collect", parsePositiveInt)
  .option(
    "-s, --sort <order>",
    `sort order: ${SORT_ORDERS.join(", ")}`,
    "newest",
  )
  .option("-o, --output <path>", "output file path (default: stdout)")
  .option(
    "-f, --format <type>",
    `output format: ${OUTPUT_FORMATS.join(", ")}`,
    "json",
  )
  .option("--headless", "run browser without UI", false)
  .option(
    "--delay <ms>",
    "delay between scroll actions in ms",
    parsePositiveInt,
    3000,
  )
  .option("-v, --verbose", "verbose logging", false)
  .action(async (url: string, opts) => {
    if (!(SORT_ORDERS as readonly string[]).includes(opts.sort)) {
      program.error(`invalid sort order "${opts.sort}" (choose: ${SORT_ORDERS.join(", ")})`);
    }
    if (!(OUTPUT_FORMATS as readonly string[]).includes(opts.format)) {
      program.error(`invalid format "${opts.format}" (choose: ${OUTPUT_FORMATS.join(", ")})`);
    }
    setVerbose(opts.verbose);
    await scrapeCommand(url, {
      maxReviews: opts.maxReviews,
      sort: opts.sort as SortOrder,
      output: opts.output,
      format: opts.format as OutputFormat,
      headless: opts.headless,
      delay: opts.delay,
    });
  });

program
  .command("batch")
  .description("Scrape reviews from multiple locations listed in a file")
  .argument("<file>", "file with Google Maps URLs (one per line or JSON array)")
  .option("-d, --output-dir <path>", "output directory", "./output")
  .option(
    "-m, --max-reviews <n>",
    "maximum reviews per location",
    parsePositiveInt,
  )
  .option(
    "-s, --sort <order>",
    `sort order: ${SORT_ORDERS.join(", ")}`,
    "newest",
  )
  .option(
    "-f, --format <type>",
    `output format: ${OUTPUT_FORMATS.join(", ")}`,
    "json",
  )
  .option("--headless", "run browser without UI", false)
  .option(
    "--delay <ms>",
    "delay between scroll actions in ms",
    parsePositiveInt,
    3000,
  )
  .option(
    "--location-delay <ms>",
    "delay between locations in ms",
    parsePositiveInt,
    10000,
  )
  .option(
    "--location-timeout <ms>",
    "timeout per location in ms",
    parsePositiveInt,
    300000,
  )
  .option("--resume", "skip already-scraped locations", false)
  .option("-v, --verbose", "verbose logging", false)
  .action(async (file: string, opts) => {
    if (!(SORT_ORDERS as readonly string[]).includes(opts.sort)) {
      program.error(`invalid sort order "${opts.sort}" (choose: ${SORT_ORDERS.join(", ")})`);
    }
    if (!(OUTPUT_FORMATS as readonly string[]).includes(opts.format)) {
      program.error(`invalid format "${opts.format}" (choose: ${OUTPUT_FORMATS.join(", ")})`);
    }
    setVerbose(opts.verbose);
    await batchCommand(file, {
      outputDir: opts.outputDir,
      maxReviews: opts.maxReviews,
      sort: opts.sort as SortOrder,
      format: opts.format as OutputFormat,
      headless: opts.headless,
      delay: opts.delay,
      locationDelay: opts.locationDelay,
      locationTimeout: opts.locationTimeout,
      resume: opts.resume,
    });
  });

program
  .command("validate")
  .description("Validate a review JSON file against the schema")
  .argument("<file>", "JSON file to validate")
  .action(async (file: string) => {
    await validateCommand(file);
  });

const auth = program
  .command("auth")
  .description("Manage Google account authentication")
  .option("-v, --verbose", "verbose logging", false)
  .action(async (opts) => {
    setVerbose(opts.verbose);
    await authLoginCommand();
  });

auth
  .command("status")
  .description("Check if signed in to Google")
  .action(async () => {
    setVerbose(auth.opts().verbose);
    await authStatusCommand();
  });

auth
  .command("logout")
  .description("Clear saved browser session")
  .action(async () => {
    setVerbose(auth.opts().verbose);
    await authLogoutCommand();
  });

program.parse();
