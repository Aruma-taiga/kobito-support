import { type CustomerScope, customerScopeFor } from "../../platform/scope.js";
import type { Principal } from "../../platform/types.js";
import { ApiError } from "../../platform/types.js";
import type { AccountsDataRepository } from "./repository.js";

export class AccountsService {
  constructor(private readonly repository: AccountsDataRepository) {}

  async getMe(principal: Principal) {
    const scope = customerScopeFor(principal);
    const customer = await this.repository.findCustomer(
      scope,
      scope.customerId,
    );
    if (!customer) throw new ApiError(404, "not_found");
    return { customer };
  }

  async getCustomerForScope(scope: CustomerScope, requestedCustomerId: string) {
    const customer = await this.repository.findCustomer(
      scope,
      requestedCustomerId,
    );
    if (!customer) throw new ApiError(404, "not_found");
    return customer;
  }
}
