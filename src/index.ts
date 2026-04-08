import { Command } from "commander";
import { scrapeCommand } from "./commands/scrape.js";
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
  .option("--delay <ms>", "delay between scroll actions in ms", parseInt, 3000)
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

program.parse();
