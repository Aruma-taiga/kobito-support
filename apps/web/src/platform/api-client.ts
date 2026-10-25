import {
  type MeResponse,
  meResponseSchema,
  type PublicConfig,
  publicConfigSchema,
} from "@kobito/shared";

export interface ApiAuthUser {
  getIdToken(): Promise<string>;
}

export interface ApiClientOptions {
  baseUrl: string;
  getCurrentUser(): ApiAuthUser | null;
  signOut(): Promise<void>;
  fetcher?: typeof fetch;
}

export class ApiClientError extends Error {
  constructor(
    readonly code:
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "network"
      | "server"
      | "invalid_response",
  ) {
    super(code);
  }
}

export function createApiClient(options: ApiClientOptions) {
  const fetcher = options.fetcher ?? fetch;

  async function getJson<T>(
    endpoint: string,
    schema: {
      safeParse(data: unknown): { success: true; data: T } | { success: false };
    },
    authenticated: boolean,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (authenticated) {
      const user = options.getCurrentUser();
      if (!user) throw new ApiClientError("unauthorized");
      let token: string;
      try {
        token = await user.getIdToken();
      } catch {
        await options.signOut().catch(() => undefined);
        throw new ApiClientError("unauthorized");
      }
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetcher(new URL(endpoint, options.baseUrl), {
        method: "GET",
        headers,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new ApiClientError("network");
    }

    if (response.status === 401) {
      if (authenticated) await options.signOut().catch(() => undefined);
      throw new ApiClientError("unauthorized");
    }
    if (!response.ok) {
      if (response.status === 403) throw new ApiClientError("forbidden");
      if (response.status === 404) throw new ApiClientError("not_found");
      throw new ApiClientError("server");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiClientError("invalid_response");
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ApiClientError("invalid_response");
    return parsed.data;
  }

  return {
    getPublicConfig: (): Promise<PublicConfig> =>
      getJson("/api/v1/public/config", publicConfigSchema, false),
    getMe: (): Promise<MeResponse> =>
      getJson("/api/v1/me", meResponseSchema, true),
  };
}

export type ReturnTypeApiClient = ReturnType<typeof createApiClient>;
