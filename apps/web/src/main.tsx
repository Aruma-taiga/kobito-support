import { webMessages } from "@kobito/shared";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createFirebaseAdminAuthClient } from "./auth/firebase-admin-client.js";
import { createFirebaseAuthClient } from "./auth/firebase-client.js";
import { createAdminApiClient } from "./platform/admin-api-client.js";
import { createApiClient } from "./platform/api-client.js";
import { loadWebConfig } from "./platform/config.js";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Application root is missing");
const root = createRoot(rootElement);

try {
  const config = loadWebConfig(import.meta.env, import.meta.env.MODE);
  const authClient = createFirebaseAuthClient(config);
  const adminAuthClient = createFirebaseAdminAuthClient(config);
  const apiClient = createApiClient({
    baseUrl: config.apiBaseUrl,
    getCurrentUser: () => authClient.currentUser(),
    signOut: () => authClient.signOut(),
  });
  const adminApiClient = createAdminApiClient({
    baseUrl: config.apiBaseUrl,
    getCurrentUser: () => adminAuthClient.currentUser(),
  });
  root.render(
    <StrictMode>
      <App
        adminApiClient={adminApiClient}
        adminAuthClient={adminAuthClient}
        apiClient={apiClient}
        authClient={authClient}
        lineLiffId={config.lineLiffId}
      />
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
