import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "db/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.db.test.ts"],
    environment: "node",
  },
});
