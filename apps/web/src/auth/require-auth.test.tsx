// @vitest-environment jsdom

import { webMessages } from "@kobito/shared";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { type AuthClient, AuthProvider, RequireAuth } from "./session.js";

describe("protected session loading", () => {
  it("waits for Firebase's first auth event before redirecting a protected route", async () => {
    let publish: ((user: null) => void) | undefined;
    const authClient: AuthClient = {
      currentUser: () => null,
      subscribe: (listener) => {
        publish = listener;
        return () => undefined;
      },
      signIn: async () => ({
        uid: "customer-test",
        email: null,
        getIdToken: async () => "token",
      }),
      signInWithCustomToken: async () => ({
        uid: "customer-test",
        email: null,
        getIdToken: async () => "token",
      }),
      signUp: async () => ({
        uid: "customer-test",
        email: null,
        getIdToken: async () => "token",
      }),
      signOut: async () => undefined,
    };

    render(
      <AuthProvider client={authClient}>
        <MemoryRouter initialEntries={["/me"]}>
          <Routes>
            <Route path="/login" element={<div>login route</div>} />
            <Route element={<RequireAuth />}>
              <Route path="/me" element={<div>private profile</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(screen.getByRole("status").textContent).toContain(
      webMessages.sessionLoading,
    );
    expect(screen.queryByText("login route")).toBeNull();
    expect(screen.queryByText("private profile")).toBeNull();

    await act(async () => publish?.(null));
    expect(await screen.findByText("login route")).toBeTruthy();
  });
});
