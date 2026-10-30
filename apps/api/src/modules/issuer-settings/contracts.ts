import type {
  AdminIssuerSettingsResponse,
  UpdateAdminIssuerSettingsRequest,
} from "@kobito/shared";
import type { Principal } from "../../platform/types.js";

export interface IssuerSettingsModule {
  get(principal: Principal): Promise<AdminIssuerSettingsResponse>;
  update(
    principal: Principal,
    request: UpdateAdminIssuerSettingsRequest,
  ): Promise<AdminIssuerSettingsResponse>;
}
