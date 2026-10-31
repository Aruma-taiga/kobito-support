import { describe, expect, it, vi } from "vitest";
import type { Principal } from "../../platform/types.js";
import { ReferralService } from "./service.js";

const admin: Principal = {
  authUserId: "a",
  role: "admin",
  customerId: null,
  secondFactor: "phone",
};
const make = () => {
  const repository = { listRewards: vi.fn(async () => []) };
  const service = new ReferralService(
    repository,
    () => new Date("2026-11-30T16:00:00.000Z"), // 東京では 12/1
  );
  return { repository, service };
};

describe("ReferralService", () => {
  it("returns an empty report for the requested month", async () => {
    const { repository, service } = make();
    const report = await service.getAdmin(admin, { month: "2026-11" });
    expect(repository.listRewards).toHaveBeenCalledWith("2026-11");
    expect(report).toMatchObject({ month: "2026-11", partners: [] });
    expect(report.total.payableAmount).toBe(0);
  });
  it("defaults to the current Tokyo month", async () => {
    const { repository, service } = make();
    await service.getAdmin(admin, {});
    expect(repository.listRewards).toHaveBeenCalledWith("2026-12");
  });
  it.each([
    "2026-13",
    "x",
    "2026-1",
  ])("rejects month %s with 422", async (m) => {
    const { repository, service } = make();
    await expect(service.getAdmin(admin, { month: m })).rejects.toMatchObject({
      status: 422,
      code: "validation_error",
    });
    expect(repository.listRewards).not.toHaveBeenCalled();
  });
  it("requires the second factor and the admin role", async () => {
    const { repository, service } = make();
    await expect(
      service.getAdmin({ ...admin, secondFactor: null }, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.getAdmin({ ...admin, role: "customer" }, {}),
    ).rejects.toMatchObject({ status: 404 });
    expect(repository.listRewards).not.toHaveBeenCalled();
  });
});
