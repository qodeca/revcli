import { consola, type ConsolaInstance } from "consola";

let logger: ConsolaInstance = consola;

export function setVerbose(verbose: boolean): void {
  logger.level = verbose ? 5 : 3;
}

export { logger };
