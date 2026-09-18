import { defineConfig } from "vitest/config";

// Scope the suite to tests/ explicitly. The default glob also matches
// tests copied into Xezar peer-task worktrees under .local/, which made
// `npm test` run other tasks' work-in-progress files.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
