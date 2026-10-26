import { webMessages } from "@kobito/shared";
import { useState } from "react";
import { useAuthSession } from "./session.js";

export function SignOutAction() {
  const { signOut } = useAuthSession();
  const [error, setError] = useState(false);

  async function handleSignOut() {
    setError(false);
    try {
      await signOut();
    } catch {
      setError(true);
    }
  }

  return (
    <div className="sign-out-action">
      {error ? (
        <p className="error-message" role="alert">
          {webMessages.logoutError}
        </p>
      ) : null}
      <button
        className="secondary-button"
        onClick={() => void handleSignOut()}
        type="button"
      >
        {webMessages.logout}
      </button>
    </div>
  );
}
