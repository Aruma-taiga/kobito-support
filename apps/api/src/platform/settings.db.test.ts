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

  it("reads the contact email only when it is a configured valid address", async () => {
    const settings = new PublicSettingsRepository(pool);
    await pool.query("delete from settings where key = 'contact_email'");
    await expect(settings.getContactEmail()).resolves.toBeNull();
    await pool.query(
      "insert into settings (key, value) values ('contact_email', to_jsonb($1::text))",
      ["hello@contact.example"],
    );
    await expect(settings.getContactEmail()).resolves.toBe(
      "hello@contact.example",
    );
    await pool.query("delete from settings where key = 'contact_email'");
  });
});
