import { Command, InvalidArgumentError } from "commander";
import { scrapeCommand } from "./commands/scrape.js";
import { batchCommand } from "./commands/batch.js";
import { validateCommand } from "./commands/validate.js";
import { setVerbose } from "./utils/logger.js";

function parsePositiveInt(value: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return n;
}

const SORT_CHOICES = ["newest", "relevant", "highest", "lowest"];
const FORMAT_CHOICES = ["json", "csv"];

const program = new Command();

program
  .name("revcli")
  .description("Scrape Google Maps location reviews")
  .version("0.1.0");

program
  .command("scrape")
  .description("Scrape reviews from a Google Maps location")
  .argument("<url>", "Google Maps URL or Place ID")
  .option("-m, --max-reviews <n>", "maximum reviews to collect", parsePositiveInt)
  .option(
    "-s, --sort <order>",
    `sort order: ${SORT_CHOICES.join(", ")}`,
    "newest",
  )
  .option("-o, --output <path>", "output file path (default: stdout)")
  .option(
    "-f, --format <type>",
    `output format: ${FORMAT_CHOICES.join(", ")}`,
    "json",
  )
  .option("--headed", "show browser window for debugging", false)
  .option(
    "--delay <ms>",
    "delay between scroll actions in ms",
    parsePositiveInt,
    3000,
  )
  .option("-v, --verbose", "verbose logging", false)
  .action(async (url: string, opts) => {
    if (!SORT_CHOICES.includes(opts.sort)) {
      program.error(`invalid sort order "${opts.sort}" (choose: ${SORT_CHOICES.join(", ")})`);
    }
    if (!FORMAT_CHOICES.includes(opts.format)) {
      program.error(`invalid format "${opts.format}" (choose: ${FORMAT_CHOICES.join(", ")})`);
    }
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
  .option(
    "-m, --max-reviews <n>",
    "maximum reviews per location",
    parsePositiveInt,
  )
  .option(
    "-s, --sort <order>",
    `sort order: ${SORT_CHOICES.join(", ")}`,
    "newest",
  )
  .option(
    "-f, --format <type>",
    `output format: ${FORMAT_CHOICES.join(", ")}`,
    "json",
  )
  .option("--headed", "show browser window for debugging", false)
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
  .option("--resume", "skip already-scraped locations", false)
  .option("-v, --verbose", "verbose logging", false)
  .action(async (file: string, opts) => {
    if (!SORT_CHOICES.includes(opts.sort)) {
      program.error(`invalid sort order "${opts.sort}" (choose: ${SORT_CHOICES.join(", ")})`);
    }
    if (!FORMAT_CHOICES.includes(opts.format)) {
      program.error(`invalid format "${opts.format}" (choose: ${FORMAT_CHOICES.join(", ")})`);
    }
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
