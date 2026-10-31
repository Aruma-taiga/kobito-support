import { configDefaults, defineConfig } from "vitest/config";

const exclude = [...configDefaults.exclude, "**/*.db.test.ts"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: [
            "apps/**/*.test.ts",
            "packages/**/*.test.ts",
            "db/**/*.test.ts",
          ],
          exclude,
          environment: "node",
        },
      },
      {
        // 画面テスト（jsdom）のみ、負荷時でも安定するよう待ち時間を延ばす。
        test: {
          name: "web",
          include: ["apps/web/**/*.test.tsx"],
          exclude,
          environment: "node",
          setupFiles: ["apps/web/src/test-setup.ts"],
          testTimeout: 15000,
          hookTimeout: 15000,
        },
      },
    ],
  },
});
