import { webMessages } from "@kobito/shared";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createFirebaseAuthClient } from "./auth/firebase-client.js";
import { createApiClient } from "./platform/api-client.js";
import { loadWebConfig } from "./platform/config.js";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Application root is missing");
const root = createRoot(rootElement);

try {
  const config = loadWebConfig(import.meta.env, import.meta.env.MODE);
  const authClient = createFirebaseAuthClient(config);
  const apiClient = createApiClient({
    baseUrl: config.apiBaseUrl,
    getCurrentUser: () => authClient.currentUser(),
    signOut: () => authClient.signOut(),
  });
  root.render(
    <StrictMode>
      <App apiClient={apiClient} authClient={authClient} />
    </StrictMode>,
  );
} catch {
  document.title = webMessages.genericServiceName;
  root.render(
    <main className="configuration-error" role="alert">
      {webMessages.configurationError}
    </main>,
  );
}
