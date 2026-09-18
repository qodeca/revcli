import { defineConfig } from "vitest/config";

// Scope the suite to tests/ explicitly. The default glob also matches test files
// under .local/ scratch directories, which made `npm test` run unrelated
// work-in-progress files.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
