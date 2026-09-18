import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: ["playwright", "commander", "consola", "zod"],
});
