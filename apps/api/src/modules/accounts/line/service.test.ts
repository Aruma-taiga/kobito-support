import { describe, expect, it, vi } from "vitest";
import { LineService } from "./service.js";

describe("LineService sign-in", () => {
  it("mints only for an existing customer account linked by the verified LINE subject", async () => {
    const repository = {
      findLinkedAccount: vi.fn(async () => ({
        authUserId: "existing-customer-uid",
      })),
      link: vi.fn(),
      status: vi.fn(),
    };
    const tokens = {
      createCustomToken: vi.fn(async (uid: string) => `custom:${uid}`),
    };
    const verifier = {
      verify: vi.fn(async () => ({ sub: "verified-line-sub" })),
    };
    const line = new LineService(repository, verifier, tokens);
    await expect(line.signIn("id-token")).resolves.toEqual({
      customToken: "custom:existing-customer-uid",
      authUserId: "existing-customer-uid",
    });
    expect(repository.findLinkedAccount).toHaveBeenCalledWith(
      "verified-line-sub",
    );
    expect(tokens.createCustomToken).toHaveBeenCalledExactlyOnceWith(
      "existing-customer-uid",
    );
  });

  it("does not mint when verification fails or the LINE identity has no customer link", async () => {
    const repository = {
      findLinkedAccount: vi.fn(async () => undefined),
      link: vi.fn(),
      status: vi.fn(),
    };
    const tokens = { createCustomToken: vi.fn(async () => "unused") };
    const invalid = new LineService(
      repository,
      {
        verify: vi.fn(async () => {
          throw new Error("invalid");
        }),
      },
      tokens,
    );
    await expect(invalid.signIn("bad-token")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    const unlinked = new LineService(
      repository,
      { verify: vi.fn(async () => ({ sub: "unknown" })) },
      tokens,
    );
    await expect(unlinked.signIn("valid-token")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    expect(tokens.createCustomToken).not.toHaveBeenCalled();
  });

  it("fails closed when LINE login is not configured", async () => {
    const tokens = { createCustomToken: vi.fn(async () => "unused") };
    const line = new LineService(
      { findLinkedAccount: vi.fn(), link: vi.fn(), status: vi.fn() },
      undefined,
      tokens,
    );
    await expect(line.signIn("token")).rejects.toMatchObject({
      status: 503,
      code: "service_unavailable",
    });
    await expect(
      line.status({ customerId: "customer-a" } as never),
    ).rejects.toMatchObject({ status: 503, code: "service_unavailable" });
    expect(tokens.createCustomToken).not.toHaveBeenCalled();
  });
});
