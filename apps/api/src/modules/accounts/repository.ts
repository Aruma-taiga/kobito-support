import type { Pool } from "pg";
import type { CustomerScope } from "../../platform/scope.js";

export interface CustomerSummary {
  id: string;
  shopName: string;
  contactName: string;
}

export interface AccountsDataRepository {
  findByAuthUserId(authUserId: string): Promise<
    | {
        authUserId: string;
        role: "customer" | "admin";
        customerId: string | null;
      }
    | undefined
  >;
  findCustomer(
    scope: CustomerScope,
    requestedCustomerId: string,
  ): Promise<CustomerSummary | undefined>;
}

export class AccountsRepository implements AccountsDataRepository {
  constructor(private readonly pool: Pool) {}

  async findByAuthUserId(authUserId: string): Promise<
    | {
        authUserId: string;
        role: "customer" | "admin";
        customerId: string | null;
      }
    | undefined
  > {
    const result = await this.pool.query<{
      auth_user_id: string;
      role: "customer" | "admin";
      customer_id: string | null;
    }>(
      `select auth_user_id, role, customer_id
       from user_accounts where auth_user_id = $1`,
      [authUserId],
    );
    const account = result.rows[0];
    return account
      ? {
          authUserId: account.auth_user_id,
          role: account.role,
          customerId: account.customer_id,
        }
      : undefined;
  }

  async findCustomer(
    scope: CustomerScope,
    requestedCustomerId: string,
  ): Promise<CustomerSummary | undefined> {
    const result = await this.pool.query<{
      id: string;
      shop_name: string;
      contact_name: string;
    }>(
      `select id, shop_name, contact_name from customers
       where id = $1 and id = $2 and anonymized_at is null`,
      [scope.customerId, requestedCustomerId],
    );
    const customer = result.rows[0];
    return customer
      ? {
          id: customer.id,
          shopName: customer.shop_name,
          contactName: customer.contact_name,
        }
      : undefined;
  }
}
