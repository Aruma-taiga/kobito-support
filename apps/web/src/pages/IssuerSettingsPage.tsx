import {
  type AdminIssuerSettings,
  type AdminIssuerSettingsResponse,
  adminIssuerSettingsSchema,
  webMessages,
} from "@kobito/shared";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  type AdminApiClient,
  AdminApiError,
} from "../platform/admin-api-client.js";

const emptySettings: AdminIssuerSettings = {
  serviceName: "",
  companyName: "",
  companyAddress: "",
  invoiceRegistrationNo: null,
  invoicePrefix: "",
  bankAccount: {
    bankName: "",
    branchName: "",
    accountType: "",
    accountNumber: "",
    accountHolder: "",
  },
};

export function AdminIssuerSettingsPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const [loaded, setLoaded] = useState<AdminIssuerSettingsResponse | null>(
    null,
  );
  const [settings, setSettings] = useState<AdminIssuerSettings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const hasUnsavedChanges = Boolean(
    loaded && JSON.stringify(settings) !== JSON.stringify(loaded.settings),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setError(null);
    setSaved(false);
    try {
      const response = await apiClient.getIssuerSettings();
      setLoaded(response);
      setSettings(response.settings);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void load();
  }, [load]);

  function change<K extends keyof AdminIssuerSettings>(
    key: K,
    value: AdminIssuerSettings[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || saving) return;
    const normalized = {
      ...settings,
      invoiceRegistrationNo: settings.invoiceRegistrationNo?.trim() || null,
    };
    const parsed = adminIssuerSettingsSchema.safeParse(normalized);
    if (!parsed.success) {
      setError(webMessages.adminIssuerSettingsSaveError);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await apiClient.updateIssuerSettings(
        loaded.revision,
        parsed.data,
      );
      setLoaded(response);
      setSettings(response.settings);
      setSaved(true);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError &&
          caught.code === "issuer_settings_conflict"
          ? webMessages.adminIssuerSettingsConflict
          : webMessages.adminIssuerSettingsSaveError,
      );
    } finally {
      setSaving(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    required = false,
    pattern?: string,
    maxLength = 160,
  ) => (
    <div className="issuer-settings-field" key={id}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        maxLength={maxLength}
        onChange={(event) => onChange(event.currentTarget.value)}
        pattern={pattern}
        required={required}
        value={value}
      />
    </div>
  );

  return (
    <main className="page-main">
      <section
        className="card admin-card issuer-settings-card"
        aria-labelledby="issuer-settings-title"
      >
        <Link className="admin-back-link" to="/admin/customers">
          {webMessages.adminQueueTitle}
        </Link>
        <h1 id="issuer-settings-title">
          {webMessages.adminIssuerSettingsTitle}
        </h1>
        {loading ? (
          <output className="status-message">
            {webMessages.adminIssuerSettingsLoading}
          </output>
        ) : null}
        {loadError ? (
          <div>
            <p className="error-message" role="alert">
              {webMessages.adminIssuerSettingsLoadError}
            </p>
            <button
              className="secondary-button"
              onClick={() => void load()}
              type="button"
            >
              {webMessages.retry}
            </button>
          </div>
        ) : null}
        {!loading && !loadError ? (
          <>
            <p className="muted-text">
              {webMessages.adminIssuerSettingsSnapshot}
            </p>
            <output
              className={
                loaded?.issuanceReady ? "success-message" : "error-message"
              }
            >
              {loaded?.issuanceReady
                ? webMessages.adminIssuerSettingsReady
                : webMessages.adminIssuerSettingsNotReady}
            </output>
            {hasUnsavedChanges ? (
              <p className="muted-text">
                {webMessages.adminIssuerSettingsUnsaved}
              </p>
            ) : null}
            <form onSubmit={(event) => void save(event)}>
              <div className="issuer-settings-grid">
                {field(
                  "serviceName",
                  webMessages.adminIssuerSettingsServiceName,
                  settings.serviceName,
                  (value) => change("serviceName", value),
                  true,
                  undefined,
                  120,
                )}
                {field(
                  "companyName",
                  webMessages.adminIssuerSettingsCompanyName,
                  settings.companyName,
                  (value) => change("companyName", value),
                )}
                {field(
                  "companyAddress",
                  webMessages.adminIssuerSettingsCompanyAddress,
                  settings.companyAddress,
                  (value) => change("companyAddress", value),
                  false,
                  undefined,
                  300,
                )}
                {field(
                  "invoiceRegistrationNo",
                  webMessages.adminIssuerSettingsRegistration,
                  settings.invoiceRegistrationNo ?? "",
                  (value) => change("invoiceRegistrationNo", value || null),
                  false,
                  "(T[0-9]{13})?",
                  14,
                )}
                {field(
                  "invoicePrefix",
                  webMessages.adminIssuerSettingsInvoicePrefix,
                  settings.invoicePrefix,
                  (value) => change("invoicePrefix", value),
                  true,
                  "[A-Za-z0-9]+(-[A-Za-z0-9]+)*",
                  20,
                )}
              </div>
              <h2>{webMessages.invoiceBankHeading}</h2>
              <div className="issuer-settings-grid">
                {field(
                  "bankName",
                  webMessages.adminIssuerSettingsBankName,
                  settings.bankAccount.bankName,
                  (value) =>
                    change("bankAccount", {
                      ...settings.bankAccount,
                      bankName: value,
                    }),
                  false,
                  undefined,
                  100,
                )}
                {field(
                  "branchName",
                  webMessages.adminIssuerSettingsBranchName,
                  settings.bankAccount.branchName,
                  (value) =>
                    change("bankAccount", {
                      ...settings.bankAccount,
                      branchName: value,
                    }),
                  false,
                  undefined,
                  100,
                )}
                {field(
                  "accountType",
                  webMessages.adminIssuerSettingsAccountType,
                  settings.bankAccount.accountType,
                  (value) =>
                    change("bankAccount", {
                      ...settings.bankAccount,
                      accountType: value,
                    }),
                  false,
                  undefined,
                  20,
                )}
                {field(
                  "accountNumber",
                  webMessages.adminIssuerSettingsAccountNumber,
                  settings.bankAccount.accountNumber,
                  (value) =>
                    change("bankAccount", {
                      ...settings.bankAccount,
                      accountNumber: value,
                    }),
                  false,
                  undefined,
                  32,
                )}
                {field(
                  "accountHolder",
                  webMessages.adminIssuerSettingsAccountHolder,
                  settings.bankAccount.accountHolder,
                  (value) =>
                    change("bankAccount", {
                      ...settings.bankAccount,
                      accountHolder: value,
                    }),
                  false,
                  undefined,
                  120,
                )}
              </div>
              {error ? (
                <p className="error-message" role="alert">
                  {error}
                </p>
              ) : null}
              {saved ? (
                <output className="success-message">
                  {webMessages.adminIssuerSettingsSaved}
                </output>
              ) : null}
              <button
                className="primary-button"
                disabled={saving}
                type="submit"
              >
                {saving
                  ? webMessages.adminIssuerSettingsSaving
                  : webMessages.adminIssuerSettingsSave}
              </button>
              {error === webMessages.adminIssuerSettingsConflict ? (
                <button
                  className="secondary-button"
                  onClick={() => void load()}
                  type="button"
                >
                  {webMessages.adminIssuerSettingsReload}
                </button>
              ) : null}
            </form>
          </>
        ) : null}
      </section>
    </main>
  );
}
