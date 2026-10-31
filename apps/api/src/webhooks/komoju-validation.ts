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
  const data: KomojuInboxEvent["data"] = {};
  if (value.data.id !== undefined) {
    if (typeof value.data.id !== "string" || !identifier.test(value.data.id))
      return;
    data.id = value.data.id;
  }
  if (value.data.status !== undefined) {
    if (
      typeof value.data.status !== "string" ||
      !statusValue.test(value.data.status)
    )
      return;
    data.status = value.data.status;
  }
  if (value.data.amount !== undefined) {
    if (
      typeof value.data.amount !== "number" ||
      !Number.isSafeInteger(value.data.amount) ||
      value.data.amount < 0
    )
      return;
    data.amount = value.data.amount;
  }
  if (value.data.total !== undefined) {
    if (
      typeof value.data.total !== "number" ||
      !Number.isSafeInteger(value.data.total) ||
      value.data.total < 0
    )
      return;
    data.total = value.data.total;
  }
  if (value.data.tax !== undefined) {
    if (
      typeof value.data.tax !== "number" ||
      !Number.isSafeInteger(value.data.tax) ||
      value.data.tax < 0
    )
      return;
    data.tax = value.data.tax;
  }
  if (value.data.currency !== undefined) {
    if (
      typeof value.data.currency !== "string" ||
      !/^[A-Z]{3}$/.test(value.data.currency)
    )
      return;
    data.currency = value.data.currency;
  }
  if (value.data.external_order_num !== undefined) {
    if (
      typeof value.data.external_order_num !== "string" ||
      !invoiceNumberFromExternalOrderNum(value.data.external_order_num)
    )
      return;
    data.external_order_num = value.data.external_order_num;
  }
  if (value.data.captured_at !== undefined) {
    if (value.data.captured_at === null) {
      data.captured_at = null;
    } else {
      if (
        typeof value.data.captured_at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
          value.data.captured_at,
        ) ||
        !Number.isFinite(Date.parse(value.data.captured_at))
      )
        return;
      data.captured_at = value.data.captured_at;
    }
  }
  return { id: value.id, type: value.type, data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
