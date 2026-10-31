import type { KomojuInboxEvent } from "./komoju-contracts.js";

const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const eventType = /^[a-z][a-z0-9_.-]{0,127}$/;
const statusValue = /^[a-z][a-z0-9_-]{0,63}$/;
const externalOrderNumber =
  /^(?<invoice>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?-\d{4}-\d{5,10})(?:-[a-z0-9]{6})?$/;

export function invoiceNumberFromExternalOrderNum(
  value: string,
): string | undefined {
  return externalOrderNumber.exec(value)?.groups?.invoice;
}

export function parseKomojuInboxEvent(
  value: unknown,
): KomojuInboxEvent | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !identifier.test(value.id)
  )
    return;
  if (typeof value.type !== "string" || !eventType.test(value.type)) return;
  if (!isRecord(value.data)) return;
  // KOMOJU は、当方が作っていない支払い（定期課金など）で external_order_num などを null で送る。
  // null は「ない」として扱い、通知は保存して「請求番号なし」の要確認として処理する（captured_at は従来どおり null を保持）。
  const source: Record<string, unknown> = { ...value.data };
  for (const key of [
    "id",
    "status",
    "amount",
    "total",
    "tax",
    "currency",
    "external_order_num",
  ]) {
    if (source[key] === null) delete source[key];
  }
  const data: KomojuInboxEvent["data"] = {};
  if (source.id !== undefined) {
    if (typeof source.id !== "string" || !identifier.test(source.id)) return;
    data.id = source.id;
  }
  if (source.status !== undefined) {
    if (typeof source.status !== "string" || !statusValue.test(source.status))
      return;
    data.status = source.status;
  }
  if (source.amount !== undefined) {
    if (
      typeof source.amount !== "number" ||
      !Number.isSafeInteger(source.amount) ||
      source.amount < 0
    )
      return;
    data.amount = source.amount;
  }
  if (source.total !== undefined) {
    if (
      typeof source.total !== "number" ||
      !Number.isSafeInteger(source.total) ||
      source.total < 0
    )
      return;
    data.total = source.total;
  }
  if (source.tax !== undefined) {
    if (
      typeof source.tax !== "number" ||
      !Number.isSafeInteger(source.tax) ||
      source.tax < 0
    )
      return;
    data.tax = source.tax;
  }
  if (source.currency !== undefined) {
    if (
      typeof source.currency !== "string" ||
      !/^[A-Z]{3}$/.test(source.currency)
    )
      return;
    data.currency = source.currency;
  }
  if (source.external_order_num !== undefined) {
    if (
      typeof source.external_order_num !== "string" ||
      !invoiceNumberFromExternalOrderNum(source.external_order_num)
    )
      return;
    data.external_order_num = source.external_order_num;
  }
  if (source.captured_at !== undefined) {
    if (source.captured_at === null) {
      data.captured_at = null;
    } else {
      if (
        typeof source.captured_at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
          source.captured_at,
        ) ||
        !Number.isFinite(Date.parse(source.captured_at))
      )
        return;
      data.captured_at = source.captured_at;
    }
  }
  return { id: value.id, type: value.type, data };
}

/**
 * 通知の骨組み（id と type）が正しいか。署名が正しく骨組みも正しいが、項目の値が許可リストに合わない通知
 * （他のサービスの請求番号など、当方が作っていない支払い）は、再送しても直らないので受け取って無視する。
 */
export function hasKomojuEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    identifier.test(value.id) &&
    typeof value.type === "string" &&
    eventType.test(value.type) &&
    isRecord(value.data)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
