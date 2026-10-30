import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export function loadRootEnvironment(): void {
  dotenv.config({ path: resolve(repositoryRoot, ".env") });
}
