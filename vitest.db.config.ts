import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.db.test.ts"],
    exclude: configDefaults.exclude,
    environment: "node",
    setupFiles: ["db/test/setup-db.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
