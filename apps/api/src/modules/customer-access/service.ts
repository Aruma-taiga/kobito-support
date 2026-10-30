import { customerAccessFor, toTokyoDate } from "@kobito/shared";
import type { CustomerScope } from "../../platform/scope.js";
import { customerScopeFor } from "../../platform/scope.js";
import type { Principal } from "../../platform/types.js";
import type { CustomerAccessModule } from "./contracts.js";
import type { CustomerAccessRepository } from "./repository.js";

export class CustomerAccessService implements CustomerAccessModule {
  constructor(
    private readonly repository: CustomerAccessRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getAccess(scope: CustomerScope) {
    const lifecycle = await this.repository.findLifecycleState(scope);
    return customerAccessFor({
      ...lifecycle,
      todayTokyoDate: toTokyoDate(this.clock()),
    });
  }

  markWelcomeSeen(scope: CustomerScope) {
    return this.repository
      .markWelcomeSeen(scope)
      .then((seenAt) => ({ seenAt }));
  }

  getAccessForPrincipal(principal: Principal) {
    return this.getAccess(customerScopeFor(principal));
  }

  markWelcomeSeenForPrincipal(principal: Principal) {
    return this.markWelcomeSeen(customerScopeFor(principal));
  }
}
