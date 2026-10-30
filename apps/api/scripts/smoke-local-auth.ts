import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";
import { loadConfig } from "../src/platform/config.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});
const config = loadConfig(process.env);
const email = process.env.DEV_AUTH_EMAIL?.trim();
const password = process.env.DEV_AUTH_PASSWORD;
if (
  config.nodeEnv !== "development" ||
  !config.firebaseProjectId.startsWith("demo-") ||
  !config.authEmulatorHost ||
  !email ||
  !password
) {
  throw new Error(
    "Local auth smoke requires a demo emulator and DEV_AUTH_EMAIL/PASSWORD",
  );
}
const emulatorHost = new URL(`http://${config.authEmulatorHost}`);
if (!["localhost", "127.0.0.1", "[::1]"].includes(emulatorHost.hostname)) {
  throw new Error("Local auth smoke requires a loopback emulator");
}

const signInUrl = new URL(
  "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key",
  `http://${config.authEmulatorHost}`,
);
const signInResponse = await fetch(signInUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
});
if (!signInResponse.ok) {
  throw new Error(
    "Firebase Auth Emulator sign-in failed; response was not logged",
  );
}
const tokenResult = z
  .object({ idToken: z.string().min(1) })
  .safeParse(await signInResponse.json());
if (!tokenResult.success) {
  throw new Error("Firebase Auth Emulator returned an unexpected response");
}
const idToken = tokenResult.data.idToken;
const meResponse = await fetch(`http://127.0.0.1:${config.port}/api/v1/me`, {
  headers: { authorization: `Bearer ${idToken}` },
});
if (!meResponse.ok) {
  throw new Error(
    "Authenticated /api/v1/me request failed; response was not logged",
  );
}
const me = z
  .object({
    customer: z.object({
      id: z.string().uuid(),
      shopName: z.string(),
      contactName: z.string(),
    }),
  })
  .safeParse(await meResponse.json());
if (!me.success) {
  throw new Error("Authenticated /api/v1/me response has an unexpected shape");
}
console.info(
  "Local Firebase Auth verification and /api/v1/me smoke test passed.",
);
