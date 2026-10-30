import { describe, expect, it, vi } from "vitest";
import { resetDatabase, validateResetTarget } from "./reset.js";

const localDevelopment = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://kobito:kobito@127.0.0.1:55433/kobito_support",
};

describe("development database reset guard", () => {
  it("allows only the named loopback development database", () => {
    expect(validateResetTarget(localDevelopment).databaseName).toBe(
      "kobito_support",
    );
    expect(() =>
      validateResetTarget({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://kobito:kobito@localhost/kobito_support_test",
      }),
    ).not.toThrow();
  });

  it.each([
    ["production mode", { ...localDevelopment, NODE_ENV: "production" }],
    [
      "remote host",
      {
        ...localDevelopment,
        DATABASE_URL: "postgres://kobito:secret@db.example.com/kobito_support",
      },
    ],
    [
      "host override query",
      {
        ...localDevelopment,
        DATABASE_URL:
          "postgres://kobito:kobito@localhost/kobito_support?host=db.example.com",
      },
    ],
    [
      "database override query",
      {
        ...localDevelopment,
        DATABASE_URL:
          "postgres://kobito:kobito@localhost/kobito_support?database=customer_data",
      },
    ],
    [
      "encoded database override",
      {
        ...localDevelopment,
        DATABASE_URL:
          "postgres://kobito:kobito@localhost/kobito_support?%64atabase=customer_data",
      },
    ],
    [
      "URL fragment",
      {
        ...localDevelopment,
        DATABASE_URL:
          "postgres://kobito:kobito@localhost/kobito_support#customer_data",
      },
    ],
    [
      "unknown database",
      {
        ...localDevelopment,
        DATABASE_URL: "postgres://kobito:kobito@localhost/customer_data",
      },
    ],
    [
      "test name in development",
      {
        ...localDevelopment,
        DATABASE_URL: "postgres://kobito:kobito@localhost/kobito_support_test",
      },
    ],
    [
      "development name in test",
      {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://kobito:kobito@localhost/kobito_support",
      },
    ],
  ])("rejects %s before opening a connection", async (_reason, environment) => {
    const connectMaintenance = vi.fn();
    await expect(
      resetDatabase(environment, {
        connectMaintenance,
        migrate: vi.fn(),
        seed: vi.fn(),
      }),
    ).rejects.toThrow();
    expect(connectMaintenance).not.toHaveBeenCalled();
  });

  it("rejects malformed connection URLs without echoing credentials", () => {
    const secret = "private-password";
    expect(() =>
      validateResetTarget({
        NODE_ENV: "development",
        DATABASE_URL: `postgres://kobito:${secret}@remote.example.invalid/customer_data`,
      }),
    ).toThrow();
    try {
      validateResetTarget({
        NODE_ENV: "development",
        DATABASE_URL: `postgres://kobito:${secret}@remote.example.invalid/customer_data`,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("waits for PostgreSQL readiness before dropping the allowed database", async () => {
    const attempts: string[][] = [];
    let connectCount = 0;
    const dependencies = {
      connectMaintenance: vi.fn(async () => {
        connectCount += 1;
        return {
          query: vi.fn(async (sql: string) => {
            attempts.push([String(connectCount), sql]);
            if (connectCount === 1) {
              throw Object.assign(new Error("database is starting"), {
                code: "ECONNREFUSED",
              });
            }
          }),
          end: vi.fn(async () => undefined),
        };
      }),
      migrate: vi.fn(async () => undefined),
      seed: vi.fn(async () => undefined),
    };

    await resetDatabase(localDevelopment, dependencies);

    expect(connectCount).toBe(2);
    expect(attempts.map(([, sql]) => sql)).toEqual([
      "select 1",
      "select 1",
      'drop database if exists "kobito_support" with (force)',
      'create database "kobito_support"',
    ]);
    expect(dependencies.migrate).toHaveBeenCalledOnce();
    expect(dependencies.seed).toHaveBeenCalledOnce();
  });
});
