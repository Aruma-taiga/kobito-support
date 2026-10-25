import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthenticate, requireCustomer } from "../../platform/auth.js";
import { customerScopeFor } from "../../platform/scope.js";
import {
  ApiError,
  type ApiVariables,
  type Principal,
} from "../../platform/types.js";
import { AccountsRepository } from "./repository.js";
import { AccountsService } from "./service.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let customerA: string;
let customerB: string;
const uidA = `api-scope-a-${crypto.randomUUID()}`;
const uidB = `api-scope-b-${crypto.randomUUID()}`;
const principalA = (customerId: string): Principal => ({
  authUserId: uidA,
  role: "customer",
  customerId,
  secondFactor: null,
});

beforeAll(async () => {
  const a = await pool.query<{ id: string }>(
    `insert into customers (shop_name, contact_name, billing_name, billing_address, email)
     values ('Scope A', 'Customer A', 'A', 'A street', $1) returning id`,
    [`${uidA}@example.test`],
  );
  const aId = a.rows[0]?.id;
  if (!aId) throw new Error("Failed to create fixture customer A");
  customerA = aId;
  const b = await pool.query<{ id: string }>(
    `insert into customers (shop_name, contact_name, billing_name, billing_address, email)
     values ('Scope B', 'Customer B', 'B', 'B street', $1) returning id`,
    [`${uidB}@example.test`],
  );
  const bId = b.rows[0]?.id;
  if (!bId) throw new Error("Failed to create fixture customer B");
  customerB = bId;
  await pool.query(
    "insert into user_accounts (auth_user_id, customer_id, role) values ($1, $2, 'customer'), ($3, $4, 'customer')",
    [uidA, customerA, uidB, customerB],
  );
});

afterAll(async () => {
  await pool.query("delete from user_accounts where auth_user_id = any($1)", [
    [uidA, uidB],
  ]);
  await pool.query("delete from customers where id = any($1::uuid[])", [
    [customerA, customerB].filter(Boolean),
  ]);
  await pool.end();
});

describe("customer account repository scope", () => {
  const repository = new AccountsRepository(pool);
  const service = new AccountsService(repository);

  it("resolves a verified UID to the DB role and customer ID", async () => {
    await expect(repository.findByAuthUserId(uidA)).resolves.toEqual({
      authUserId: uidA,
      customerId: customerA,
      role: "customer",
    });
  });

  it("reads only the customer bound to the authenticated scope", async () => {
    const scope = customerScopeFor(principalA(customerA));
    await expect(repository.findCustomer(scope, customerA)).resolves.toEqual({
      id: customerA,
      shopName: "Scope A",
      contactName: "Customer A",
    });
    await expect(
      repository.findCustomer(scope, customerB),
    ).resolves.toBeUndefined();
  });

  it("returns 404 for another customer's ID through verified auth and scoped service", async () => {
    const app = new Hono<{ Variables: ApiVariables }>();
    const verifier = {
      verifyIdToken: async (token: string) => ({ uid: token }),
    };
    app.use("/customers/*", createAuthenticate(verifier, repository));
    app.use("/customers/*", requireCustomer());
    app.get("/customers/:id", async (context) => {
      const scope = customerScopeFor(context.get("principal"));
      return context.json(
        await service.getCustomerForScope(scope, context.req.param("id")),
      );
    });
    app.onError((error, context) =>
      context.json(
        {
          error: {
            code: error instanceof ApiError ? error.code : "internal_error",
          },
        },
        error instanceof ApiError ? error.status : 500,
      ),
    );

    const own = await app.request(`/customers/${customerA}`, {
      headers: { authorization: `Bearer ${uidA}` },
    });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({
      id: customerA,
      shopName: "Scope A",
    });

    const other = await app.request(`/customers/${customerB}`, {
      headers: { authorization: `Bearer ${uidA}` },
    });
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: { code: "not_found" } });
  });
});
