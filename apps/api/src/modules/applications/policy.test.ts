import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../platform/config.js";
import { buildPublicCatalog } from "./policy.js";

const localConfig: RuntimeConfig = {
  nodeEnv: "development",
  databaseUrl: "postgres://kobito:kobito@127.0.0.1:55433/kobito_support",
  firebaseProjectId: "demo-kobito-support",
  authEmulatorHost: "127.0.0.1:9099",
  webOrigin: "http://localhost:5173",
  port: 3000,
  invoicePrefix: "KS",
};

const plan = {
  id: "00000000-0000-4000-8000-000000000001",
  code: "light",
  name: "ライト",
  priceExclTax: 5000,
  credits: 1,
  isCustom: false,
} as const;

const draftDocuments = {
  status: "draft",
  terms: { url: "https://legal.example.test/terms", version: "案v2" },
  privacy: { url: "https://legal.example.test/privacy", version: "案v1" },
  disclosure: {
    url: "https://legal.example.test/disclosure",
    version: "案v1",
  },
} as const;

describe("application preview/live policy gates", () => {
  it("publishes a preview offer only for the local demo project and hashes its full displayed terms", () => {
    const catalog = buildPublicCatalog([plan], draftDocuments, localConfig);
    expect(catalog.application).toMatchObject({
      mode: "preview",
      terms: draftDocuments.terms,
      privacy: draftDocuments.privacy,
      disclosure: draftDocuments.disclosure,
      availablePaymentMethods: ["bank_transfer"],
      konbiniFeeYen: null,
    });
    expect(catalog.application?.displayVersion).toBe(catalog.displayVersion);
    expect(catalog.application?.conditions).toEqual({
      initialDueDays: 7,
      extraCreditExclYen: 4000,
      monthlyPrepaid: true,
      periodBasis: "contract_anchor",
      rollover: false,
      cancellation: "period_end_no_proration",
    });
    expect(
      buildPublicCatalog(
        [{ ...plan, priceExclTax: 5100 }],
        draftDocuments,
        localConfig,
      ).displayVersion,
    ).not.toBe(catalog.displayVersion);
    expect(
      buildPublicCatalog(
        [plan],
        {
          ...draftDocuments,
          terms: { ...draftDocuments.terms, version: "案v3" },
        },
        localConfig,
      ).displayVersion,
    ).not.toBe(catalog.displayVersion);
  });

  it.each([
    {
      ...localConfig,
      databaseUrl: "postgres://user:pass@database.example.test/kobito_support",
    },
    {
      ...localConfig,
      databaseUrl:
        "postgres://user:pass@127.0.0.1/kobito_support?host=database.example.test",
    },
    { ...localConfig, authEmulatorHost: "auth.example.test:9099" },
    { ...localConfig, firebaseProjectId: "production-project" },
  ])("fails closed for an unsafe local-preview runtime", (config) => {
    expect(buildPublicCatalog([plan], draftDocuments, config).application).toBe(
      null,
    );
  });

  it("fails closed in production for draft or invalid legal documents", () => {
    const productionConfig: RuntimeConfig = {
      nodeEnv: "production",
      databaseUrl: "postgres://service@db.example.test/kobito_support",
      firebaseProjectId: "production-project",
      webOrigin: "https://service.example.test",
      port: 8080,
      invoicePrefix: "KS",
    };
    expect(
      buildPublicCatalog([plan], draftDocuments, productionConfig).application,
    ).toBeNull();
    expect(
      buildPublicCatalog(
        [plan],
        {
          ...draftDocuments,
          status: "published",
          terms: {
            url: "https://user:secret@legal.example.test/terms",
            version: "v1",
          },
        },
        productionConfig,
      ).application,
    ).toBeNull();
  });

  it("publishes only approved HTTPS references as live in production", () => {
    const productionConfig: RuntimeConfig = {
      nodeEnv: "production",
      databaseUrl: "postgres://service@db.example.test/kobito_support",
      firebaseProjectId: "production-project",
      webOrigin: "https://service.example.test",
      port: 8080,
      invoicePrefix: "KS",
    };
    const published = {
      ...draftDocuments,
      status: "published",
      terms: { ...draftDocuments.terms, version: "v1" },
      privacy: { ...draftDocuments.privacy, version: "v1" },
      disclosure: { ...draftDocuments.disclosure, version: "v1" },
    } as const;
    expect(
      buildPublicCatalog([plan], published, productionConfig).application,
    ).toMatchObject({ mode: "live", terms: published.terms });
  });
});
