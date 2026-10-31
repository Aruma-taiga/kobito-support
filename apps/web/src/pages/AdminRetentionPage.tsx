import {
  contractStatusLabels,
  type RetentionItem,
  webMessages,
} from "@kobito/shared";
import { useEffect, useState } from "react";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import { formatDate } from "../platform/format.js";
import { AdminHeading, Button, Hint, Notice, Table } from "../ui/index.js";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: RetentionItem[] };

export function AdminRetentionPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries the request
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    apiClient.getRetention().then(
      (items) => {
        if (current) setState({ status: "ready", items });
      },
      () => {
        if (current) setState({ status: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [apiClient, attempt]);
  return (
    <>
      <AdminHeading
        id="retention-title"
        title={webMessages.adminRetentionTitle}
      />
      {state.status === "loading" ? (
        <output>{webMessages.adminRetentionLoading}</output>
      ) : null}
      {state.status === "error" ? (
        <>
          <Notice tone="warn">{webMessages.adminRetentionError}</Notice>
          <Button
            variant="ghost"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {webMessages.invoiceRetry}
          </Button>
        </>
      ) : null}
      {state.status === "ready" ? (
        state.items.length === 0 ? (
          <Hint>{webMessages.adminRetentionEmpty}</Hint>
        ) : (
          <Table
            caption={webMessages.adminRetentionTitle}
            columns={[
              { key: "shop", header: webMessages.adminRetentionShop },
              { key: "status", header: webMessages.adminRetentionStatus },
              { key: "base", header: webMessages.adminRetentionBaseDate },
              { key: "due", header: webMessages.adminRetentionDueDate },
              {
                key: "days",
                header: webMessages.adminRetentionDays,
                numeric: true,
              },
            ]}
            rows={state.items.map((item) => ({
              shop: item.shopName,
              status: contractStatusLabels[item.status],
              base: formatDate(item.baseDate),
              due: formatDate(item.dueDate),
              days: webMessages.adminRetentionDaysValue.replace(
                "{days}",
                String(item.daysRemaining),
              ),
            }))}
          />
        )
      ) : null}
    </>
  );
}
