import {
  type CustomerRequestSummary,
  type RequestStatus,
  webMessages,
} from "@kobito/shared";
import { formatSlashDate, tokyoDateOf } from "../platform/format.js";
import type { BadgeTone } from "../ui/index.js";

export function requestStatusLabel(status: RequestStatus): string {
  switch (status) {
    case "received":
      return webMessages.myRequestStatusReceived;
    case "awaiting_approval":
      return webMessages.myRequestStatusAwaitingApproval;
    case "in_progress":
      return webMessages.myRequestStatusInProgress;
    case "done":
      return webMessages.myRequestStatusDone;
    case "withdrawn":
      return webMessages.myRequestStatusWithdrawn;
  }
}

/** 了承待ち＝黄（お客様の操作が必要）、作業中＝緑、受付済み＝灰、完了＝紺。 */
export function requestStatusTone(status: RequestStatus): BadgeTone {
  switch (status) {
    case "awaiting_approval":
      return "yellow";
    case "in_progress":
      return "sage";
    case "done":
      return "dark";
    default:
      return "gray";
  }
}

/** 見積の了承待ちは見積の画面へ、それ以外は依頼の画面へ。 */
export function requestPath(
  item: Pick<CustomerRequestSummary, "id" | "status">,
) {
  const base = `/me/requests/${encodeURIComponent(item.id)}`;
  return item.status === "awaiting_approval" ? `${base}/estimate` : base;
}

/** 一覧の2行目。detailed では受付日と了承日も添える。 */
export function requestMeta(
  item: CustomerRequestSummary,
  detailed = false,
): string {
  const parts: string[] = [];
  if (detailed && item.status !== "done") {
    parts.push(
      webMessages.myRequestMetaReceived.replace(
        "{date}",
        formatSlashDate(item.receivedOn),
      ),
    );
  }
  const estimate = item.latestEstimate;
  if (item.status === "done" && item.completion) {
    parts.push(
      webMessages.myRequestMetaDone.replace(
        "{date}",
        formatSlashDate(item.completion.completedOn),
      ),
    );
  } else if (item.status === "awaiting_approval" && estimate) {
    parts.push(
      webMessages.myRequestMetaEstimate
        .replace("{credits}", String(estimate.credits))
        .replace("{date}", formatSlashDate(estimate.dueOn)),
    );
  } else if (item.status === "in_progress" && estimate) {
    if (detailed && estimate.approvedAt) {
      parts.push(
        webMessages.myRequestMetaApproved.replace(
          "{date}",
          formatSlashDate(tokyoDateOf(estimate.approvedAt)),
        ),
      );
    }
    parts.push(
      webMessages.myRequestMetaTarget.replace(
        "{date}",
        formatSlashDate(estimate.dueOn),
      ),
    );
  } else if (item.status === "received") {
    parts.push(webMessages.myRequestMetaQuoting);
  }
  return parts.join("　");
}
