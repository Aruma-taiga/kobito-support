import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { PublicSettingsRepository } from "./settings.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

afterAll(async () => pool.end());

describe("public settings repository", () => {
  it("reads only the service name from the authoritative settings table", async () => {
    const settings = new PublicSettingsRepository(pool);
    await expect(settings.getServiceName()).resolves.toBe(
      "コビトサポート（kobITo Support）",
    );
  });
});
