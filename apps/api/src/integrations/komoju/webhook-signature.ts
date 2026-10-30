import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyKomojuSignature(
  rawBody: Uint8Array,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, "hex");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
