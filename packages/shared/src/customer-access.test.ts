import { describe, expect, it } from "vitest";
import { customerAccessFor, customerAccessSchema } from "./customer-access.js";

describe("customer lifecycle access decisions", () => {
  const base = {
    welcomeShownAt: null,
    endedOnTokyoDate: null,
    todayTokyoDate: "2026-10-27",
  };

  it.each([
    ["under_review", true],
    ["quoting", true],
    ["awaiting_payment", true],
  ] as const)("sends %s to waiting with lifecycle-appropriate invoice access", (status, invoiceAccess) => {
    expect(customerAccessFor({ ...base, status })).toMatchObject({
      landingPath: "/me/waiting",
      access: "pending",
      invoiceAccess,
      welcomeRequired: false,
    });
  });

  it("routes an individual quote to its quote screen without invoice access", () => {
    expect(
      customerAccessFor({ ...base, status: "awaiting_quote_approval" }),
    ).toMatchObject({
      landingPath: "/me/plan-quote",
      access: "pending",
      invoiceAccess: false,
    });
  });

  it("shows welcome once for active and cancel-scheduled contracts", () => {
    expect(customerAccessFor({ ...base, status: "active" })).toMatchObject({
      landingPath: "/me/welcome",
      welcomeRequired: true,
      access: "active",
    });
    expect(
      customerAccessFor({
        ...base,
        status: "cancel_scheduled",
        welcomeShownAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      landingPath: "/me",
      welcomeRequired: false,
      access: "active",
    });
  });

  it("retains ended invoice access until the Tokyo calendar anniversary", () => {
    expect(
      customerAccessFor({
        ...base,
        status: "ended",
        endedOnTokyoDate: "2024-02-29",
        todayTokyoDate: "2025-02-27",
      }),
    ).toMatchObject({
      landingPath: "/me/invoices",
      access: "ended",
      invoiceAccess: true,
      invoiceAccessUntil: "2025-02-27",
    });
    expect(
      customerAccessFor({
        ...base,
        status: "ended",
        endedOnTokyoDate: "2024-02-29",
        todayTokyoDate: "2025-03-01",
      }),
    ).toMatchObject({
      landingPath: "/me/finished",
      access: "finished",
      invoiceAccess: false,
    });
  });

  it("ends invoice access on the same anniversary date used for anonymization", () => {
    expect(
      customerAccessFor({
        ...base,
        status: "ended",
        endedOnTokyoDate: "2024-02-29",
        todayTokyoDate: "2025-02-28",
      }),
    ).toMatchObject({ access: "finished", invoiceAccess: false });
  });

  it.each(["declined", "lapsed"] as const)("hides %s records", (status) => {
    expect(customerAccessFor({ ...base, status })).toMatchObject({
      landingPath: "/me/finished",
      access: "finished",
      invoiceAccess: false,
      welcomeRequired: false,
    });
  });

  it("supports a legacy customer without a contract and validates the shared body", () => {
    const access = customerAccessFor({ ...base, status: null });
    expect(access).toMatchObject({
      landingPath: "/me",
      access: "none",
      invoiceAccess: false,
    });
    expect(customerAccessSchema.parse(access)).toEqual(access);
    expect(
      customerAccessSchema.safeParse({
        ...access,
        privateEmail: "x@example.test",
      }).success,
    ).toBe(false);
  });
});
