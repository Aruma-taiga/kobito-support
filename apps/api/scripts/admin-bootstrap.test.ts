import { describe, expect, it, vi } from "vitest";
import {
  type AdminBootstrapDependencies,
  bootstrapAdmin,
} from "./admin-bootstrap.js";

function setup(overrides: Partial<AdminBootstrapDependencies> = {}) {
  const firebase = {
    getUserByEmail: vi.fn(async () => {
      throw Object.assign(new Error("missing"), {
        code: "auth/user-not-found",
      });
    }),
    createUser: vi.fn(async () => ({ uid: "uid-new", disabled: false })),
    markEmailVerified: vi.fn(async () => undefined),
    generatePasswordResetLink: vi.fn(
      async () => "https://secret.example/reset",
    ),
  };
  const db = { ensureAdminAccount: vi.fn(async () => "admin" as const) };
  const write = vi.fn();
  const dependencies: AdminBootstrapDependencies = {
    firebase,
    db,
    write,
    randomPassword: () => "throwaway-password",
    emulatorHost: undefined,
    ...overrides,
  };
  return { dependencies, firebase, db, write };
}

describe("bootstrapAdmin", () => {
  it("creates a Firebase user with a discarded random password and links admin", async () => {
    const { dependencies, firebase, db, write } = setup();
    await bootstrapAdmin("root@example.jp", dependencies);
    expect(firebase.createUser).toHaveBeenCalledWith({
      email: "root@example.jp",
      password: "throwaway-password",
    });
    // MFA（TOTP）の登録は、メールアドレスの確認が済んでいないと拒否されるため、確認済みにする。
    expect(firebase.markEmailVerified).toHaveBeenCalledWith("uid-new");
    expect(db.ensureAdminAccount).toHaveBeenCalledWith("uid-new");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toContain("https://secret.example/reset");
    expect(write.mock.calls[0]?.[0]).not.toContain("throwaway-password");
    expect(write.mock.calls[0]?.[0]).toContain("秘密");
  });

  it("reuses an existing user without creating another", async () => {
    const { dependencies } = setup({
      firebase: {
        ...setup().dependencies.firebase,
        getUserByEmail: vi.fn(async () => ({ uid: "uid-1", disabled: false })),
      },
    });
    await bootstrapAdmin("root@example.jp", dependencies);
    expect(dependencies.firebase.getUserByEmail).toHaveBeenCalledWith(
      "root@example.jp",
    );
    expect(dependencies.firebase.createUser).not.toHaveBeenCalled();
  });

  it("marks the email verified for an existing user too, so TOTP enrollment is not rejected", async () => {
    const base = setup();
    const markEmailVerified = vi.fn(async () => undefined);
    const { dependencies } = setup({
      firebase: {
        ...base.dependencies.firebase,
        getUserByEmail: vi.fn(async () => ({ uid: "uid-1", disabled: false })),
        markEmailVerified,
      },
    });
    await bootstrapAdmin("root@example.jp", dependencies);
    expect(markEmailVerified).toHaveBeenCalledWith("uid-1");
  });

  it("does not mark a disabled user or an existing customer's account as verified", async () => {
    const markEmailVerified = vi.fn(async () => undefined);
    const base = setup();
    await expect(
      bootstrapAdmin(
        "root@example.jp",
        setup({
          firebase: {
            ...base.dependencies.firebase,
            getUserByEmail: vi.fn(async () => ({
              uid: "uid-1",
              disabled: true,
            })),
            markEmailVerified,
          },
        }).dependencies,
      ),
    ).rejects.toThrow(/disabled/i);
    await expect(
      bootstrapAdmin(
        "root@example.jp",
        setup({
          firebase: { ...base.dependencies.firebase, markEmailVerified },
          db: { ensureAdminAccount: vi.fn(async () => "customer" as const) },
        }).dependencies,
      ),
    ).rejects.toThrow(/customer/i);
    expect(markEmailVerified).not.toHaveBeenCalled();
  });

  it("refuses disabled users and customer account rows", async () => {
    const disabled = setup({
      firebase: {
        ...setup().dependencies.firebase,
        getUserByEmail: vi.fn(async () => ({ uid: "uid-1", disabled: true })),
      },
    });
    await expect(
      bootstrapAdmin("root@example.jp", disabled.dependencies),
    ).rejects.toThrow(/disabled/i);
    const customer = setup({
      db: { ensureAdminAccount: vi.fn(async () => "customer" as const) },
    });
    await expect(
      bootstrapAdmin("root@example.jp", customer.dependencies),
    ).rejects.toThrow(/customer/i);
    expect(customer.write).not.toHaveBeenCalled();
  });

  it("rejects the Firebase Auth emulator before contacting dependencies", async () => {
    const { dependencies, firebase, db } = setup({
      emulatorHost: "127.0.0.1:9099",
    });
    await expect(
      bootstrapAdmin("root@example.jp", dependencies),
    ).rejects.toThrow(/emulator/i);
    expect(firebase.getUserByEmail).not.toHaveBeenCalled();
    expect(db.ensureAdminAccount).not.toHaveBeenCalled();
  });

  it("is idempotent and emits the reset link only once per successful run", async () => {
    const { dependencies, write } = setup();
    await bootstrapAdmin("root@example.jp", dependencies);
    await bootstrapAdmin("root@example.jp", dependencies);
    expect(write).toHaveBeenCalledTimes(2);
    expect(
      write.mock.calls.every(
        ([line]) =>
          String(line).match(/https:\/\/secret\.example\/reset/g)?.length === 1,
      ),
    ).toBe(true);
  });
});
