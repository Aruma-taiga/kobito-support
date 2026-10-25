// @vitest-environment jsdom

import { webMessages } from "@kobito/shared";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { type AuthClient, AuthProvider, RequireAuth } from "../auth/session.js";
import { createApiClient } from "../platform/api-client.js";
import { MePage } from "./MePage.js";

describe("expired customer session recovery", () => {
  it("shows recovery instead of waiting forever if sign-out does not update auth state", async () => {
    const currentUser = { getIdToken: vi.fn(async () => "stale-token") };
    const authClient: AuthClient = {
      currentUser: () => currentUser,
      subscribe: (listener) => {
        queueMicrotask(() => listener(currentUser));
        return () => undefined;
      },
      signIn: async () => undefined,
      signOut: async () => {
        throw new Error("transient client failure");
      },
    };
    const apiClient = createApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getCurrentUser: () => currentUser,
      signOut: vi.fn(async () => {
        throw new Error("sign-out did not clear local session");
      }),
      fetcher: vi.fn<typeof fetch>(async () =>
        Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
      ),
    });

    render(
      <AuthProvider client={authClient}>
        <MemoryRouter initialEntries={["/me"]}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/me" element={<MePage apiClient={apiClient} />} />
            </Route>
            <Route path="/login" element={<div>login route</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.sessionExpiredError,
    );
    expect(screen.queryByText(webMessages.profileLoading)).toBeNull();
    expect(
      screen.getByRole("button", { name: webMessages.logout }),
    ).toBeTruthy();
  });
});
