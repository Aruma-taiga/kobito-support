import type { KomojuInboxEvent } from "./komoju-contracts.js";

const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const eventType = /^[a-z][a-z0-9_.-]{0,127}$/;
const statusValue = /^[a-z][a-z0-9_-]{0,63}$/;
const invoiceNumber =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?-\d{4}-\d{5,10}$/;

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
      !invoiceNumber.test(value.data.external_order_num)
    )
      return;
    data.external_order_num = value.data.external_order_num;
  }
  return { id: value.id, type: value.type, data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
