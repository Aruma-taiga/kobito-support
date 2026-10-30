import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { loadWebConfig } from "./src/platform/config.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, repositoryRoot, "VITE_");
  loadWebConfig(environment, mode);
  return {
    root: fileURLToPath(new URL("./", import.meta.url)),
    envDir: repositoryRoot,
    envPrefix: "VITE_",
    plugins: [react()],
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    build: { outDir: "dist", emptyOutDir: true },
  };
});
