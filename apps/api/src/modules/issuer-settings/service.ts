import type { UpdateAdminIssuerSettingsRequest } from "@kobito/shared";
import { ApiError, type Principal } from "../../platform/types.js";
import type { IssuerSettingsModule } from "./contracts.js";
import type { IssuerSettingsRepository } from "./repository.js";

export class IssuerSettingsService implements IssuerSettingsModule {
  constructor(private readonly repository: IssuerSettingsRepository) {}

  get(principal: Principal) {
    this.requireAdmin(principal);
    return this.repository.get();
  }

  update(principal: Principal, request: UpdateAdminIssuerSettingsRequest) {
    this.requireAdmin(principal);
    return this.repository.update(principal, request);
  }

  private requireAdmin(principal: Principal): void {
    if (principal.role !== "admin") throw new ApiError(404, "not_found");
    if (!principal.secondFactor) throw new ApiError(403, "forbidden");
  }
}
