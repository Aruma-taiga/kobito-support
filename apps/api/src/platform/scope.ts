import { ApiError, type Principal } from "./types.js";

const customerScopeBrand: unique symbol = Symbol("customer-scope");

export interface CustomerScope {
  readonly customerId: string;
  readonly [customerScopeBrand]: true;
}

/** Derive database access scope only from the principal created by verified auth. */
export function customerScopeFor(principal: Principal): CustomerScope {
  if (principal.role !== "customer") throw new ApiError(404, "not_found");
  if (!principal.customerId) throw new ApiError(401, "unauthorized");
  return {
    customerId: principal.customerId,
    [customerScopeBrand]: true,
  };
}
