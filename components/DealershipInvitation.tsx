import React, { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { Button } from "./ui/Button";
import { toUiMessage } from "../utils/errorMessages";
import {
  acceptDealershipInvitation,
  type InvitedDealer,
} from "../services/dealershipInvitations";

export function DealershipInvitation({ token }: { token: string }) {
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const [dealer, setDealer] = useState<InvitedDealer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = /^[a-f0-9]{64}$/.test(token);
  const accept = async () => {
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await acceptDealershipInvitation(token, controller.signal);
      if (controller.signal.aborted) return;
      history.replaceState(null, "", "/join");
      setDealer(result);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(toUiMessage(reason, "The invitation could not be opened."));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <main className="min-h-dvh bg-canvas px-5 py-12 text-ink">
      <section className="mx-auto max-w-md space-y-5 rounded-lg border border-strong bg-panel p-6">
        <div className="flex items-center gap-3">
          <Logo markOnly size={36} className="shrink-0" />
          <span className="text-sm font-semibold">Dealer Social Post AI</span>
        </div>
        <h1 className="text-2xl font-semibold">
          {dealer ? dealer.name : "Your dealership invitation"}
        </h1>
        <p className="text-sm leading-6 text-ink-2">
          {dealer
            ? "This device is ready. Use your personal four-digit code to open your workspace."
            : "Set up this device with the private link from your manager. Then sign in with your personal code."}
        </p>
        {!dealer && (
          <p className="text-sm text-ink-2">
            This switches the dealership on this device and ends any current sign-in.
          </p>
        )}
        {!valid && !dealer && (
          <p role="alert" className="text-error-ink">
            Ask your manager for a current private invitation.
          </p>
        )}
        {error && (
          <p role="alert" className="text-error-ink">
            {error}
          </p>
        )}
        {dealer ? (
          <Button className="w-full" onClick={() => location.replace("/")}>
            Continue to sign in
          </Button>
        ) : (
          <Button
            className="w-full"
            disabled={!valid || busy}
            loading={busy}
            onClick={() => void accept()}
          >
            Set up this device
          </Button>
        )}
        <a className="block text-center text-sm text-ink-2 underline" href="/">
          Back to the app
        </a>
      </section>
    </main>
  );
}
