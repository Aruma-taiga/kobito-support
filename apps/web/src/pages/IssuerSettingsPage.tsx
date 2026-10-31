import {
  type AdminIssuerSettings,
  type AdminIssuerSettingsResponse,
  adminIssuerSettingsSchema,
  webMessages,
} from "@kobito/shared";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type AdminApiClient,
  AdminApiError,
} from "../platform/admin-api-client.js";
import {
  ActionBar,
  AdminColumns,
  AdminHeading,
  Button,
  Card,
  Field,
  Hint,
  Notice,
} from "../ui/index.js";

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
    <Field label={label} key={id}>
      <input
        id={id}
        maxLength={maxLength}
        onChange={(event) => onChange(event.currentTarget.value)}
        pattern={pattern}
        required={required}
        value={value}
      />
    </Field>
  );

  return (
    <>
      <AdminHeading
        id="issuer-settings-title"
        title={webMessages.adminIssuerSettingsTitle}
      />
      {loading ? (
        <output className="ui-admin__lead">
          {webMessages.adminIssuerSettingsLoading}
        </output>
      ) : null}
      {loadError ? (
        <>
          <Notice tone="warn">
            {webMessages.adminIssuerSettingsLoadError}
          </Notice>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            {webMessages.retry}
          </Button>
        </>
      ) : null}
      {!loading && !loadError ? (
        <>
          <p className="ui-admin__lead">
            {webMessages.adminIssuerSettingsSnapshot}
          </p>
          <Notice
            live={Boolean(loaded?.issuanceReady)}
            tone={loaded?.issuanceReady ? "info" : "yellow"}
          >
            {loaded?.issuanceReady
              ? webMessages.adminIssuerSettingsReady
              : webMessages.adminIssuerSettingsNotReady}
          </Notice>
          {hasUnsavedChanges ? (
            <Hint>{webMessages.adminIssuerSettingsUnsaved}</Hint>
          ) : null}
          <form onSubmit={(event) => void save(event)}>
            <AdminColumns>
              <div>
                <Card title={webMessages.invoiceIssuerHeading}>
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
                </Card>
              </div>
              <div>
                <Card title={webMessages.invoiceBankHeading}>
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
                </Card>
              </div>
            </AdminColumns>
            {error ? <Notice tone="warn">{error}</Notice> : null}
            {saved ? (
              <Notice live>{webMessages.adminIssuerSettingsSaved}</Notice>
            ) : null}
            <ActionBar>
              <Button size="sm" disabled={saving} type="submit">
                {saving
                  ? webMessages.adminIssuerSettingsSaving
                  : webMessages.adminIssuerSettingsSave}
              </Button>
              {error === webMessages.adminIssuerSettingsConflict ? (
                <Button variant="ghost" size="sm" onClick={() => void load()}>
                  {webMessages.adminIssuerSettingsReload}
                </Button>
              ) : null}
            </ActionBar>
          </form>
        </>
      ) : null}
    </>
  );
}
