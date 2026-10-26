import { createHash } from "node:crypto";
import type {
  ApproveEstimateResponse,
  CompleteRequest,
  CompleteRequestResponse,
  CreateEstimate,
  CreateRequest,
  RequestCompletion,
  RequestEstimate,
  RequestStatus,
} from "@kobito/shared";
import {
  canApprove,
  canTransitionRequest,
  completionEntriesForPeriod,
  toTokyoDate,
} from "@kobito/shared";
import type { Pool, PoolClient } from "pg";
import { safePgInteger } from "../../platform/db/integers.js";
import { withTransaction } from "../../platform/db/transaction.js";
import type { CustomerScope } from "../../platform/scope.js";
import { ApiError, type Principal } from "../../platform/types.js";
import type { RequestModule } from "./contracts.js";

interface EstimateRow {
  id: string;
  request_id: string;
  version: number;
  credits: number;
  due_on: string;
  work_items: string[];
  done_criteria: string;
  exclusions: string | null;
  customer_prep: string | null;
  sent_at: Date | string | null;
  approved_at: Date | string | null;
  superseded_at: Date | string | null;
}
interface RequestRow {
  id: string;
  contract_id: string;
  customer_id?: string;
  shop_name?: string;
  contact_name?: string;
  received_on: string;
  summary: string;
  urgent: boolean;
  status: RequestStatus;
  approved_estimate_id: string | null;
  completed_on?: string | null;
  actual_minutes?: number | null;
  actual_credits?: number | null;
  reserved_period_id?: string | null;
  reserved_credits?: number | null;
  reserved_period_starts_on?: string | null;
  reserved_period_ends_on?: string | null;
  created_at: Date | string;
  latest_id?: string | null;
  latest_version?: number | null;
  latest_credits?: number | null;
  latest_due_on?: string | null;
  latest_work_items?: string[] | null;
  latest_done_criteria?: string | null;
  latest_exclusions?: string | null;
  latest_customer_prep?: string | null;
  latest_sent_at?: Date | string | null;
  latest_approved_at?: Date | string | null;
  latest_superseded_at?: Date | string | null;
}
function iso(value: Date | string | null | undefined) {
  return value == null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
}
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("Required database value is missing");
  }
  return value;
}
function requiredIso(value: Date | string | null | undefined): string {
  return required(iso(value));
}
function estimate(row: EstimateRow): RequestEstimate {
  if (!row.sent_at)
    throw new Error("Unsent estimate selected as current version");
  return {
    id: row.id,
    requestId: row.request_id,
    version: row.version,
    credits: row.credits,
    dueOn: row.due_on,
    workItems: Array.isArray(row.work_items) ? row.work_items : [],
    doneCriteria: row.done_criteria,
    exclusions: row.exclusions,
    customerPrep: row.customer_prep,
    sentAt: requiredIso(row.sent_at),
    approvedAt: iso(row.approved_at),
    supersededAt: iso(row.superseded_at),
  };
}
function summary(row: RequestRow) {
  let latestEstimate: RequestEstimate | null = null;
  if (row.latest_id) {
    latestEstimate = {
      id: row.latest_id,
      requestId: row.id,
      version: required(row.latest_version),
      credits: required(row.latest_credits),
      dueOn: required(row.latest_due_on),
      workItems: Array.isArray(row.latest_work_items)
        ? row.latest_work_items
        : [],
      doneCriteria: required(row.latest_done_criteria),
      exclusions: row.latest_exclusions ?? null,
      customerPrep: row.latest_customer_prep ?? null,
      sentAt: requiredIso(row.latest_sent_at),
      approvedAt: iso(row.latest_approved_at),
      supersededAt: iso(row.latest_superseded_at),
    };
  }
  let completion: RequestCompletion | null = null;
  if (row.status === "done") {
    completion = {
      completedOn: required(row.completed_on),
      actualMinutes: required(row.actual_minutes),
      actualCredits: required(row.actual_credits),
      reservedCredits: required(row.reserved_credits),
      periodId: required(row.reserved_period_id),
      reservedPeriod: {
        startsOn: required(row.reserved_period_starts_on),
        endsOn: required(row.reserved_period_ends_on),
      },
    };
  }
  return {
    id: row.id,
    contractId: row.contract_id,
    receivedOn: row.received_on,
    summary: row.summary,
    urgent: row.urgent,
    status: row.status,
    createdAt: requiredIso(row.created_at),
    latestEstimate,
    completion,
  };
}
const selectRequest = `select r.id,r.contract_id,r.received_on::text,r.summary,r.urgent,r.status,r.approved_estimate_id,r.created_at,
 r.completed_on::text as completed_on,r.actual_minutes,r.actual_credits,
 e.id as latest_id,e.version as latest_version,e.credits as latest_credits,e.due_on::text as latest_due_on,e.work_items as latest_work_items,e.done_criteria as latest_done_criteria,e.exclusions as latest_exclusions,e.customer_prep as latest_customer_prep,e.sent_at as latest_sent_at,e.approved_at as latest_approved_at,e.superseded_at as latest_superseded_at
 ,reservation.period_id as reserved_period_id,reservation.reserved_credits,
 reservation.starts_on::text as reserved_period_starts_on,reservation.ends_on::text as reserved_period_ends_on
 from service_requests r left join lateral (select * from estimates where request_id=r.id and sent_at is not null order by version desc limit 1) e on true
 left join lateral (select ce.period_id,-ce.amount as reserved_credits,p.starts_on,p.ends_on from credit_entries ce join billing_periods p on p.id=ce.period_id where ce.request_id=r.id and ce.kind='reserve' order by ce.occurred_at limit 1) reservation on true`;
function hash(command: unknown) {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}
async function saveAudit(
  client: PoolClient,
  principal: Principal,
  action: string,
  type: string,
  id: string,
) {
  await client.query(
    "insert into audit_logs(actor,action,target_type,target_id,detail) values($1,$2,$3,$4,'{}'::jsonb)",
    [principal.authUserId, action, type, id],
  );
}
async function lockKey(client: PoolClient, key: string) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    `request-command:${key}`,
  ]);
}
function requireAdmin(principal: Principal) {
  if (principal.role !== "admin") throw new ApiError(404, "not_found");
  if (!principal.secondFactor) throw new ApiError(403, "forbidden");
}
async function queueNotification(
  client: PoolClient,
  customerId: string,
  requestId: string,
  kind: "NT-06" | "NT-07",
  lineUserId: string | null,
  version: number | null = null,
  event: "approved" | "completed" = "approved",
) {
  const preview = await client.query<{ preview: boolean }>(
    `select coalesce((i.issuer_snapshot->>'preview')::boolean,false) preview from contracts c left join lateral (select issuer_snapshot from invoices where contract_id=c.id and kind='initial' order by created_at desc limit 1) i on true join service_requests r on r.contract_id=c.id where r.id=$1`,
    [requestId],
  );
  if (preview.rows[0]?.preview) return;
  const channel = lineUserId ? "line" : "email";
  await client.query(
    `insert into notifications(customer_id,kind,channel,dedupe_key,scheduled_at,payload) values($1,$2,$3,$4,now(),$5::jsonb) on conflict(dedupe_key) do nothing`,
    [
      customerId,
      kind,
      channel,
      `${kind}:${requestId}:${kind === "NT-06" ? `estimate:${version}` : event}`,
      JSON.stringify({
        requestId,
        ...(version === null ? {} : { estimateVersion: version }),
        ...(kind === "NT-07"
          ? { status: event === "approved" ? "in_progress" : "done" }
          : {}),
      }),
    ],
  );
}

export class RequestRepository implements RequestModule {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async eligibleContracts() {
    const result = await this.pool.query<{
      contract_id: string;
      customer_id: string;
      shop_name: string;
      contact_name: string;
      status: "active" | "cancel_scheduled";
    }>(
      `select c.id contract_id,c.customer_id,cu.shop_name,cu.contact_name,c.status from contracts c join customers cu on cu.id=c.customer_id where c.status in ('active','cancel_scheduled') and cu.anonymized_at is null order by cu.shop_name,cu.contact_name`,
    );
    return {
      items: result.rows.map((r) => ({
        contractId: r.contract_id,
        customerId: r.customer_id,
        shopName: r.shop_name,
        contactName: r.contact_name,
        status: r.status,
      })),
    };
  }
  async listAdmin() {
    const res = await this.pool.query<RequestRow>(
      `${selectRequest} order by r.received_on desc,r.created_at desc`,
    );
    return { items: res.rows.map(summary) };
  }
  async getAdmin(id: string) {
    const query = selectRequest.replace(
      "select r.id,",
      "select c.customer_id as customer_id,cu.shop_name,cu.contact_name,r.id,",
    );
    const result = await this.pool.query<
      RequestRow & { shop_name: string; contact_name: string }
    >(
      `${query} join contracts c on c.id=r.contract_id join customers cu on cu.id=c.customer_id where r.id=$1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");
    const estimates = await this.pool.query<EstimateRow>(
      "select id,request_id,version,credits,due_on::text as due_on,work_items,done_criteria,exclusions,customer_prep,sent_at,approved_at,superseded_at from estimates where request_id=$1 and sent_at is not null order by version desc",
      [id],
    );
    return {
      ...summary(row),
      customer: {
        customerId: row.customer_id ?? "",
        shopName: row.shop_name,
        contactName: row.contact_name,
      },
      estimates: estimates.rows.map(estimate),
    };
  }
  async createAdmin(principal: Principal, key: string, body: CreateRequest) {
    requireAdmin(principal);
    const bodyHash = hash(body);
    return withTransaction(this.pool, async (client) => {
      await lockKey(client, key);
      const prior = await client.query<{
        actor: string;
        command: string;
        request_hash: string;
        target_id: string;
      }>(
        "select actor,command,request_hash,target_id from request_command_keys where request_key=$1",
        [key],
      );
      if (prior.rows[0]) {
        const old = prior.rows[0];
        if (
          old.actor !== principal.authUserId ||
          old.command !== "create" ||
          old.request_hash !== bodyHash
        )
          throw new ApiError(409, "request_conflict");
        const replay = await client.query<{
          id: string;
          contractId: string;
          receivedOn: string;
          summary: string;
          urgent: boolean;
          status: RequestStatus;
          created_at: Date | string;
        }>(
          'select id,contract_id as "contractId",received_on::text as "receivedOn",summary,urgent,status,created_at from service_requests where id=$1',
          [old.target_id],
        );
        const row = replay.rows[0];
        if (!row) throw new ApiError(409, "request_conflict");
        return {
          id: row.id,
          contractId: row.contractId,
          receivedOn: row.receivedOn,
          summary: row.summary,
          urgent: row.urgent,
          status: row.status,
          createdAt: requiredIso(row.created_at),
          replayed: true,
        };
      }
      const contract = await client.query(
        "select id from contracts where id=$1 and status in ('active','cancel_scheduled') for update",
        [body.contractId],
      );
      if (!contract.rows[0]) throw new ApiError(404, "not_found");
      const result = await client.query<{
        id: string;
        contractId: string;
        receivedOn: string;
        summary: string;
        urgent: boolean;
        status: RequestStatus;
        created_at: Date | string;
      }>(
        'insert into service_requests(contract_id,received_on,summary,urgent) values($1,$2,$3,$4) returning id,contract_id as "contractId",received_on::text as "receivedOn",summary,urgent,status,created_at',
        [body.contractId, body.receivedOn, body.summary, body.urgent],
      );
      const row = required(result.rows[0]);
      await client.query(
        "insert into request_command_keys(request_key,actor,command,request_hash,target_id) values($1,$2,'create',$3,$4)",
        [key, principal.authUserId, bodyHash, row.id],
      );
      await saveAudit(
        client,
        principal,
        "request.created",
        "service_request",
        row.id,
      );
      return {
        id: row.id,
        contractId: row.contractId,
        receivedOn: row.receivedOn,
        summary: row.summary,
        urgent: row.urgent,
        status: row.status,
        createdAt: requiredIso(row.created_at),
        replayed: false,
      };
    });
  }
  async createEstimate(
    principal: Principal,
    key: string,
    requestId: string,
    body: CreateEstimate,
  ) {
    requireAdmin(principal);
    const bodyHash = hash({ requestId, body });
    return withTransaction(this.pool, async (client) => {
      await lockKey(client, key);
      const prior = await client.query<{
        actor: string;
        command: string;
        request_hash: string;
        target_id: string;
      }>(
        "select actor,command,request_hash,target_id from request_command_keys where request_key=$1",
        [key],
      );
      if (prior.rows[0]) {
        const old = prior.rows[0];
        if (
          old.actor !== principal.authUserId ||
          old.command !== "estimate" ||
          old.request_hash !== bodyHash
        )
          throw new ApiError(409, "estimate_conflict");
        const replay = await client.query<EstimateRow>(
          "select id,request_id,version,credits,due_on::text as due_on,work_items,done_criteria,exclusions,customer_prep,sent_at,approved_at,superseded_at from estimates where id=$1",
          [old.target_id],
        );
        if (!replay.rows[0]) throw new ApiError(409, "estimate_conflict");
        return { ...estimate(replay.rows[0]), replayed: true };
      }
      const base = await client.query<{
        contract_id: string;
        customer_id: string;
        line_user_id: string | null;
        status: RequestStatus;
      }>(
        "select c.id contract_id,c.customer_id,cu.line_user_id,r.status from service_requests r join contracts c on c.id=r.contract_id join customers cu on cu.id=c.customer_id where r.id=$1 and c.status in ('active','cancel_scheduled')",
        [requestId],
      );
      const initial = base.rows[0];
      if (!initial) throw new ApiError(404, "not_found");
      const lockedContract = await client.query<{ status: string }>(
        "select status from contracts where id=$1 for update",
        [initial.contract_id],
      );
      if (!lockedContract.rows[0]) throw new ApiError(404, "not_found");
      if (
        !["active", "cancel_scheduled"].includes(lockedContract.rows[0].status)
      )
        throw new ApiError(409, "request_conflict");
      const locked = await client.query<{ status: RequestStatus }>(
        "select status from service_requests where id=$1 for update",
        [requestId],
      );
      if (
        !locked.rows[0] ||
        (locked.rows[0].status !== "awaiting_approval" &&
          !canTransitionRequest(locked.rows[0].status, "awaiting_approval"))
      )
        throw new ApiError(409, "request_conflict");
      const latest = await client.query<{ version: number }>(
        "select version from estimates where request_id=$1 order by version desc limit 1 for update",
        [requestId],
      );
      const version = (latest.rows[0]?.version ?? 0) + 1;
      await client.query(
        "update estimates set superseded_at=now() where request_id=$1 and sent_at is not null and superseded_at is null",
        [requestId],
      );
      const inserted = await client.query<EstimateRow>(
        `insert into estimates(request_id,version,credits,due_on,work_items,done_criteria,exclusions,customer_prep,sent_at) values($1,$2,$3,$4,$5::jsonb,$6,$7,$8,now()) returning id,request_id,version,credits,due_on::text as due_on,work_items,done_criteria,exclusions,customer_prep,sent_at,approved_at,superseded_at`,
        [
          requestId,
          version,
          body.credits,
          body.dueOn,
          JSON.stringify(body.workItems),
          body.doneCriteria,
          body.exclusions ?? null,
          body.customerPrep ?? null,
        ],
      );
      await client.query(
        "update service_requests set status='awaiting_approval' where id=$1",
        [requestId],
      );
      await client.query(
        "insert into request_command_keys(request_key,actor,command,request_hash,target_id) values($1,$2,'estimate',$3,$4)",
        [key, principal.authUserId, bodyHash, required(inserted.rows[0]).id],
      );
      await queueNotification(
        client,
        initial.customer_id,
        requestId,
        "NT-06",
        initial.line_user_id,
        version,
      );
      await saveAudit(
        client,
        principal,
        "estimate.sent",
        "service_request",
        requestId,
      );
      return { ...estimate(required(inserted.rows[0])), replayed: false };
    });
  }
  async listCustomer(scope: CustomerScope, openOnly: boolean) {
    const result = await this.pool.query<
      RequestRow & { approved_estimate_id: string | null }
    >(
      `${selectRequest} join contracts c on c.id=r.contract_id where c.customer_id=$1 and c.status in ('active','cancel_scheduled') and ($2::boolean=false or r.status in ('received','awaiting_approval','in_progress')) order by r.received_on desc,r.created_at desc`,
      [scope.customerId, openOnly],
    );
    return {
      items: result.rows.map((row) => ({
        ...summary(row),
        approvedEstimateId: row.approved_estimate_id,
      })),
    };
  }
  async getCustomer(scope: CustomerScope, id: string) {
    const currentDate = toTokyoDate(this.now());
    const customerRequestQuery = selectRequest.replace(
      " from service_requests r",
      ", current_period.period_id,current_period.available_credits from service_requests r",
    );
    const result = await this.pool.query<
      RequestRow & {
        approved_estimate_id: string | null;
        period_id: string | null;
        available_credits: string | null;
      }
    >(
      `${customerRequestQuery} join contracts c on c.id=r.contract_id left join lateral (select p.id as period_id,(select coalesce(sum(ce.amount),0)::text from credit_entries ce where ce.period_id=p.id) available_credits from billing_periods p where p.contract_id=c.id and $3::date between p.starts_on and p.ends_on order by p.seq desc limit 1) current_period on true where r.id=$2 and c.customer_id=$1 and c.status in ('active','cancel_scheduled')`,
      [scope.customerId, id, currentDate],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");
    const currentPeriodId = row.period_id;
    const availableCredits = safePgInteger(row.available_credits ?? "0");
    const latest = summary(row).latestEstimate;
    const approvalReady = Boolean(
      latest &&
        !row.approved_estimate_id &&
        row.status === "awaiting_approval" &&
        currentPeriodId &&
        canApprove(latest.credits, availableCredits),
    );
    return {
      request: {
        ...summary(row),
        approvedEstimateId: row.approved_estimate_id,
      },
      latestEstimate: latest,
      currentPeriodId,
      availableCredits,
      canApprove: approvalReady,
    };
  }
  async approveEstimate(
    scope: CustomerScope,
    principal: Principal,
    id: string,
  ): Promise<ApproveEstimateResponse> {
    return withTransaction(this.pool, async (client) => {
      const approvalDate = toTokyoDate(this.now());
      const estimateHead = await client.query<{ request_id: string }>(
        "select request_id from estimates where id=$1 and sent_at is not null",
        [id],
      );
      if (!estimateHead.rows[0]) throw new ApiError(404, "not_found");
      const req = await client.query<{ contract_id: string }>(
        "select contract_id from service_requests where id=$1 and contract_id in(select id from contracts where customer_id=$2)",
        [estimateHead.rows[0].request_id, scope.customerId],
      );
      if (!req.rows[0]) throw new ApiError(404, "not_found");
      const contract = await client.query<{ status: string }>(
        "select status from contracts where id=$1 for update",
        [req.rows[0].contract_id],
      );
      if (!contract.rows[0]) throw new ApiError(404, "not_found");
      const request = await client.query<{
        status: RequestStatus;
        approved_estimate_id: string | null;
        customer_id: string;
        line_user_id: string | null;
      }>(
        "select r.status,r.approved_estimate_id,c.customer_id,cu.line_user_id from service_requests r join contracts c on c.id=r.contract_id join customers cu on cu.id=c.customer_id where r.id=$1 for update of r",
        [estimateHead.rows[0].request_id],
      );
      const r = request.rows[0];
      if (!r) throw new ApiError(404, "not_found");
      const selected = await client.query<EstimateRow>(
        "select * from estimates where id=$1 for update",
        [id],
      );
      const e = required(selected.rows[0]);
      if (r.approved_estimate_id === id && e.approved_at)
        return {
          requestId: e.request_id,
          estimateId: e.id,
          status: "in_progress",
          approvedAt: requiredIso(e.approved_at),
          reservedCredits: e.credits,
          replayed: true,
        };
      if (!["active", "cancel_scheduled"].includes(contract.rows[0].status))
        throw new ApiError(409, "request_conflict");
      const latest = await client.query<{
        id: string;
        superseded_at: Date | null;
      }>(
        "select id,superseded_at from estimates where request_id=$1 and sent_at is not null order by version desc limit 1",
        [e.request_id],
      );
      if (
        latest.rows[0]?.id !== id ||
        latest.rows[0]?.superseded_at ||
        !canTransitionRequest(r.status, "in_progress") ||
        r.approved_estimate_id
      )
        throw new ApiError(409, "estimate_conflict");
      const period = await client.query<{ id: string }>(
        "select id from billing_periods where contract_id=$1 and $2::date between starts_on and ends_on order by seq desc limit 1 for update",
        [req.rows[0].contract_id, approvalDate],
      );
      if (!period.rows[0]) throw new ApiError(409, "request_conflict");
      const balance = await client.query<{ balance: string }>(
        "select coalesce(sum(amount),0)::text balance from credit_entries where contract_id=$1 and period_id=$2",
        [req.rows[0].contract_id, period.rows[0].id],
      );
      if (
        !canApprove(e.credits, safePgInteger(balance.rows[0]?.balance ?? "0"))
      )
        throw new ApiError(409, "insufficient_credits");
      const update = await client.query<{ approved_at: Date }>(
        "update estimates set approved_at=now(),approved_by=$2 where id=$1 and approved_at is null returning approved_at",
        [id, principal.authUserId],
      );
      if (!update.rows[0]) throw new ApiError(409, "estimate_conflict");
      await client.query(
        "update service_requests set status='in_progress',approved_estimate_id=$2 where id=$1",
        [e.request_id, id],
      );
      await client.query(
        "insert into credit_entries(contract_id,period_id,kind,amount,request_id,note) values($1,$2,'reserve',$3,$4,'Estimate approval')",
        [req.rows[0].contract_id, period.rows[0].id, -e.credits, e.request_id],
      );
      await queueNotification(
        client,
        r.customer_id,
        e.request_id,
        "NT-07",
        r.line_user_id,
      );
      await client.query(
        "insert into audit_logs(actor,action,target_type,target_id,detail) values($1,'estimate.approved','service_request',$2,'{}'::jsonb)",
        [principal.authUserId, e.request_id],
      );
      return {
        requestId: e.request_id,
        estimateId: id,
        status: "in_progress",
        approvedAt: requiredIso(update.rows[0].approved_at),
        reservedCredits: e.credits,
        replayed: false,
      };
    });
  }

  async completeRequest(
    principal: Principal,
    id: string,
    body: CompleteRequest,
  ): Promise<CompleteRequestResponse> {
    requireAdmin(principal);
    const today = toTokyoDate(this.now());
    if (body.completedOn > today) throw new ApiError(422, "validation_error");

    return withTransaction(this.pool, async (client) => {
      const requestHead = await client.query<{ contract_id: string }>(
        "select contract_id from service_requests where id=$1",
        [id],
      );
      const contractId = requestHead.rows[0]?.contract_id;
      if (!contractId) throw new ApiError(404, "not_found");

      // Every request mutation locks contract first, then request, to serialize
      // settlement with approval and other work on this contract.
      const contract = await client.query<{ id: string }>(
        "select id from contracts where id=$1 for update",
        [contractId],
      );
      if (!contract.rows[0]) throw new ApiError(404, "not_found");
      const selectedRequest = await client.query<{
        contract_id: string;
        customer_id: string;
        line_user_id: string | null;
        received_on: string;
        status: RequestStatus;
        approved_estimate_id: string | null;
        completed_on: string | null;
        actual_minutes: number | null;
        actual_credits: number | null;
      }>(
        `select r.contract_id,r.received_on::text,r.status,r.approved_estimate_id,
                r.completed_on::text,r.actual_minutes,r.actual_credits,
                c.customer_id,cu.line_user_id
           from service_requests r join contracts c on c.id=r.contract_id
           join customers cu on cu.id=c.customer_id
          where r.id=$1 for update of r`,
        [id],
      );
      const request = selectedRequest.rows[0];
      if (!request) throw new ApiError(404, "not_found");
      if (request.contract_id !== contractId)
        throw new ApiError(409, "request_conflict");
      if (
        body.completedOn < request.received_on ||
        (request.status !== "done" &&
          (!canTransitionRequest(request.status, "done") ||
            request.status !== "in_progress" ||
            !request.approved_estimate_id))
      )
        throw new ApiError(409, "request_conflict");

      const reservationResult = await client.query<{
        period_id: string;
        reserved_credits: number;
        estimate_credits: number;
        estimate_id: string;
        estimate_approved_at: Date | string | null;
        starts_on: string;
        ends_on: string;
      }>(
        `select ce.period_id,-ce.amount as reserved_credits,e.credits as estimate_credits,
                e.id as estimate_id,e.approved_at as estimate_approved_at,
                p.starts_on::text,p.ends_on::text
           from credit_entries ce join billing_periods p on p.id=ce.period_id
           join estimates e on e.id=$2 and e.request_id=ce.request_id
          where ce.request_id=$1 and ce.kind='reserve' and ce.contract_id=$3
            and p.contract_id=$3 and ce.amount < 0`,
        [id, request.approved_estimate_id, contractId],
      );
      if (reservationResult.rows.length !== 1)
        throw new ApiError(409, "request_conflict");
      const reservation = required(reservationResult.rows[0]);
      if (
        reservation.estimate_id !== request.approved_estimate_id ||
        !reservation.estimate_approved_at ||
        reservation.reserved_credits !== reservation.estimate_credits
      )
        throw new ApiError(409, "request_conflict");

      if (request.status === "done") {
        if (
          request.completed_on !== body.completedOn ||
          request.actual_minutes !== body.actualMinutes ||
          request.actual_credits !== body.actualCredits
        )
          throw new ApiError(409, "request_conflict");
        const existingSettlement = await client.query<{
          kind: string;
          amount: number;
        }>(
          "select kind,amount from credit_entries where request_id=$1 and kind in ('release','consume','expire') order by kind",
          [id],
        );
        const expected: Array<{ kind: string; amount: number }> = [
          { kind: "consume", amount: -body.actualCredits },
          { kind: "release", amount: reservation.reserved_credits },
        ];
        const expiryRows = existingSettlement.rows.filter(
          (entry) => entry.kind === "expire",
        );
        const expectedExpiryAmount =
          body.actualCredits < reservation.reserved_credits
            ? -(reservation.reserved_credits - body.actualCredits)
            : null;
        if (
          expiryRows.length > 1 ||
          (expiryRows.length === 1 &&
            (expectedExpiryAmount === null ||
              expiryRows[0]?.amount !== expectedExpiryAmount))
        )
          throw new ApiError(409, "request_conflict");
        expected.push(...expiryRows);
        expected.sort((left, right) => left.kind.localeCompare(right.kind));
        if (
          existingSettlement.rows.length !== expected.length ||
          existingSettlement.rows.some(
            (entry, index) =>
              entry.kind !== expected[index]?.kind ||
              entry.amount !== expected[index]?.amount,
          )
        )
          throw new ApiError(409, "request_conflict");
        return {
          requestId: id,
          status: "done",
          completedOn: body.completedOn,
          actualMinutes: body.actualMinutes,
          actualCredits: body.actualCredits,
          reservedCredits: reservation.reserved_credits,
          periodId: reservation.period_id,
          reservedPeriod: {
            startsOn: reservation.starts_on,
            endsOn: reservation.ends_on,
          },
          replayed: true,
        };
      }

      const [release, consume] = completionEntriesForPeriod(
        reservation.period_id,
        reservation.reserved_credits,
        body.actualCredits,
      );
      await client.query(
        `insert into credit_entries(contract_id,period_id,kind,amount,request_id,note)
         values($1,$2,$3,$4,$5,'Request completion settlement'),($1,$2,$6,$7,$5,'Request completion settlement')`,
        [
          contractId,
          release.periodId,
          release.kind,
          release.amount,
          id,
          consume.kind,
          consume.amount,
        ],
      );
      if (
        reservation.ends_on < today &&
        body.actualCredits < reservation.reserved_credits
      ) {
        await client.query(
          `insert into credit_entries(contract_id,period_id,kind,amount,request_id,note)
           values($1,$2,'expire',$3,$4,'Unused request reservation after period expiry')`,
          [
            contractId,
            reservation.period_id,
            -(reservation.reserved_credits - body.actualCredits),
            id,
          ],
        );
      }
      const update = await client.query(
        `update service_requests
            set status='done',completed_on=$2,actual_minutes=$3,actual_credits=$4
          where id=$1 and status='in_progress' returning id`,
        [id, body.completedOn, body.actualMinutes, body.actualCredits],
      );
      if (!update.rows[0]) throw new ApiError(409, "request_conflict");
      await queueNotification(
        client,
        request.customer_id,
        id,
        "NT-07",
        request.line_user_id,
        null,
        "completed",
      );
      await client.query(
        "insert into audit_logs(actor,action,target_type,target_id,detail) values($1,'request.completed','service_request',$2,$3::jsonb)",
        [
          principal.authUserId,
          id,
          JSON.stringify({
            completedOn: body.completedOn,
            actualMinutes: body.actualMinutes,
            actualCredits: body.actualCredits,
            reservedCredits: reservation.reserved_credits,
            periodId: reservation.period_id,
          }),
        ],
      );
      return {
        requestId: id,
        status: "done",
        completedOn: body.completedOn,
        actualMinutes: body.actualMinutes,
        actualCredits: body.actualCredits,
        reservedCredits: reservation.reserved_credits,
        periodId: reservation.period_id,
        reservedPeriod: {
          startsOn: reservation.starts_on,
          endsOn: reservation.ends_on,
        },
        replayed: false,
      };
    });
  }
}
