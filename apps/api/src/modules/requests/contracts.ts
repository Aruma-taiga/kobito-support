import type {
  AdminRequestDetail,
  AdminRequestSummary,
  ApproveEstimateResponse,
  CompleteRequest,
  CompleteRequestResponse,
  CreateEstimate,
  CreateRequest,
  CustomerRequestDetail,
  CustomerRequestSummary,
  EligibleRequestContracts,
  RequestStatus,
} from "@kobito/shared";
import type { CustomerScope } from "../../platform/scope.js";
import type { Principal } from "../../platform/types.js";

export interface RequestModule {
  eligibleContracts(): Promise<EligibleRequestContracts>;
  listAdmin(): Promise<{ items: AdminRequestSummary[] }>;
  getAdmin(id: string): Promise<AdminRequestDetail>;
  createAdmin(
    principal: Principal,
    key: string,
    body: CreateRequest,
  ): Promise<{
    id: string;
    contractId: string;
    receivedOn: string;
    summary: string;
    urgent: boolean;
    status: RequestStatus;
    createdAt: string;
    replayed: boolean;
  }>;
  createEstimate(
    principal: Principal,
    key: string,
    requestId: string,
    body: CreateEstimate,
  ): Promise<{
    id: string;
    requestId: string;
    version: number;
    credits: number;
    dueOn: string;
    workItems: string[];
    doneCriteria: string;
    exclusions: string | null;
    customerPrep: string | null;
    sentAt: string;
    replayed: boolean;
  }>;
  listCustomer(
    scope: CustomerScope,
    openOnly: boolean,
  ): Promise<{ items: CustomerRequestSummary[] }>;
  getCustomer(scope: CustomerScope, id: string): Promise<CustomerRequestDetail>;
  approveEstimate(
    scope: CustomerScope,
    principal: Principal,
    id: string,
  ): Promise<ApproveEstimateResponse>;
  completeRequest(
    principal: Principal,
    id: string,
    body: CompleteRequest,
  ): Promise<CompleteRequestResponse>;
}
