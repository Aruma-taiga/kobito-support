import type {
  AdminApplicationQueueQuery,
  AdminApplicationQueueResponse,
  AdminCustomerDetail,
  DeclineApplicationRequest,
  DeclineApplicationResponse,
} from "@kobito/shared";
import type { Principal } from "../../platform/types.js";

export interface AdminModule {
  listApplications(
    query: AdminApplicationQueueQuery,
  ): Promise<AdminApplicationQueueResponse>;
  getCustomerDetail(customerId: string): Promise<AdminCustomerDetail>;
  declineApplication(
    principal: Principal,
    applicationId: string,
    request: DeclineApplicationRequest,
  ): Promise<DeclineApplicationResponse>;
}
