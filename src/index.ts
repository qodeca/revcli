import { Command } from "commander";
import { scrapeCommand } from "./commands/scrape.js";
import { batchCommand } from "./commands/batch.js";
import { validateCommand } from "./commands/validate.js";
import { setVerbose } from "./utils/logger.js";

const program = new Command();

program
  .name("revcli")
  .description("Scrape Google Maps location reviews")
  .version("0.1.0");

program
  .command("scrape")
  .description("Scrape reviews from a Google Maps location")
  .argument("<url>", "Google Maps URL or Place ID")
  .option("-m, --max-reviews <n>", "maximum reviews to collect", parseInt)
  .option(
    "-s, --sort <order>",
    "sort order: newest, relevant, highest, lowest",
    "newest",
  )
  .option("-o, --output <path>", "output file path (default: stdout)")
  .option("-f, --format <type>", "output format: json, csv", "json")
  .option("--headed", "show browser window for debugging", false)
  .option(
    "--delay <ms>",
    "delay between scroll actions in ms",
    parseInt,
    3000,
  )
  .option("-v, --verbose", "verbose logging", false)
  .action(async (url: string, opts) => {
    setVerbose(opts.verbose);
    await scrapeCommand(url, {
      maxReviews: opts.maxReviews,
      sort: opts.sort,
      output: opts.output,
      format: opts.format,
      headed: opts.headed,
      delay: opts.delay,
    });
  });

program
  .command("batch")
  .description("Scrape reviews from multiple locations listed in a file")
  .argument("<file>", "file with Google Maps URLs (one per line or JSON array)")
  .option("-d, --output-dir <path>", "output directory", "./output")
  .option("-m, --max-reviews <n>", "maximum reviews per location", parseInt)
  .option(
    "-s, --sort <order>",
    "sort order: newest, relevant, highest, lowest",
    "newest",
  )
  .option("-f, --format <type>", "output format: json, csv", "json")
  .option("--headed", "show browser window for debugging", false)
  .option(
    "--delay <ms>",
    "delay between scroll actions in ms",
    parseInt,
    3000,
  )
  .option(
    "--location-delay <ms>",
    "delay between locations in ms",
    parseInt,
    10000,
  )
  .option("--resume", "skip already-scraped locations", false)
  .option("-v, --verbose", "verbose logging", false)
  .action(async (file: string, opts) => {
    setVerbose(opts.verbose);
    await batchCommand(file, {
      outputDir: opts.outputDir,
      maxReviews: opts.maxReviews,
      sort: opts.sort,
      format: opts.format,
      headed: opts.headed,
      delay: opts.delay,
      locationDelay: opts.locationDelay,
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

program.parse();
