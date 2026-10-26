import {
  completeRequestSchema,
  createEstimateSchema,
  createRequestSchema,
} from "@kobito/shared";
import { z } from "zod";
import type { CustomerScope } from "../../platform/scope.js";
import { ApiError, type Principal } from "../../platform/types.js";
import type { RequestModule } from "./contracts.js";
import type { RequestRepository } from "./repository.js";

const uuid = z.uuid();
export class RequestService implements RequestModule {
  constructor(private readonly repository: RequestRepository) {}
  eligibleContracts() {
    return this.repository.eligibleContracts();
  }
  listAdmin() {
    return this.repository.listAdmin();
  }
  getAdmin(id: string) {
    if (!uuid.safeParse(id).success) throw new ApiError(404, "not_found");
    return this.repository.getAdmin(id);
  }
  createAdmin(principal: Principal, key: string, body: unknown) {
    const parsed = createRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(422, "validation_error");
    if (!uuid.safeParse(key).success)
      throw new ApiError(400, "invalid_request");
    return this.repository.createAdmin(principal, key, parsed.data);
  }
  createEstimate(principal: Principal, key: string, id: string, body: unknown) {
    if (!uuid.safeParse(id).success) throw new ApiError(404, "not_found");
    if (!uuid.safeParse(key).success)
      throw new ApiError(400, "invalid_request");
    const parsed = createEstimateSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(422, "validation_error");
    return this.repository.createEstimate(principal, key, id, parsed.data);
  }
  listCustomer(scope: CustomerScope, openOnly: boolean) {
    return this.repository.listCustomer(scope, openOnly);
  }
  getCustomer(scope: CustomerScope, id: string) {
    if (!uuid.safeParse(id).success) throw new ApiError(404, "not_found");
    return this.repository.getCustomer(scope, id);
  }
  approveEstimate(scope: CustomerScope, principal: Principal, id: string) {
    if (!uuid.safeParse(id).success) throw new ApiError(404, "not_found");
    return this.repository.approveEstimate(scope, principal, id);
  }
  completeRequest(principal: Principal, id: string, body: unknown) {
    if (!uuid.safeParse(id).success) throw new ApiError(404, "not_found");
    const parsed = completeRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(422, "validation_error");
    return this.repository.completeRequest(principal, id, parsed.data);
  }
}
