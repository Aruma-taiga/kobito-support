import { webMessages } from "@kobito/shared";
import { useState } from "react";
import { Button, Notice } from "../ui/index.js";
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
    <div className="ui-actions">
      {error ? <Notice tone="warn">{webMessages.logoutError}</Notice> : null}
      <Button variant="ghost" onClick={() => void handleSignOut()}>
        {webMessages.logout}
      </Button>
    </div>
  );
}
