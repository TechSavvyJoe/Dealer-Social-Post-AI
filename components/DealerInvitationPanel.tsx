import React, { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "./ui/Button";
import {
  dealershipInvitation,
  dealershipInvitationLink,
  type InvitationStatus,
} from "../services/dealershipInvitations";

export function DealerInvitationPanel({ dealerId }: { dealerId: string }) {
  const queryClient = useQueryClient();
  const mutation = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<InvitationStatus | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"issue" | "require" | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLink("");
    setError("");
    setStatus(null);
    setConfirm(null);
    setNotice("");
    void dealershipInvitation(dealerId, undefined, controller.signal)
      .then(setStatus)
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason.message || "Access settings are unavailable.");
      });
    return () => {
      controller.abort();
      mutation.current?.abort();
    };
  }, [dealerId]);
  const act = async (action: "issue" | "require") => {
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await dealershipInvitation(dealerId, action, controller.signal);
      if (controller.signal.aborted) return;
      setStatus(next);
      if (next.token) setLink(dealershipInvitationLink(next.token));
      void queryClient.invalidateQueries({ queryKey: ["dealers"] });
      setConfirm(null);
      setNotice(
        action === "require"
          ? "Private invitations are now required for personal-code sign-in."
          : "The private invitation is ready. Share it directly with your team.",
      );
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(
        reason instanceof Error ? reason.message : "Access could not be updated.",
      );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <section
      className="space-y-3 rounded-md border border-strong bg-panel p-4"
      aria-label="Private dealership access"
    >
      <h3 className="text-base font-semibold text-ink">Private dealership access</h3>
      <p className="text-sm leading-6 text-ink-2">
        Open the private invitation once on each device, then use a personal code. Keep
        this link inside your team.
      </p>
      {status && (
        <p className="text-sm font-medium text-ink">
          {status.required
            ? "Invitation required for personal codes"
            : "Existing access is still enabled — distribute invitations before switching"}
        </p>
      )}
      {link && (
        <div className="space-y-2">
          <label className="block text-sm text-ink">
            Private invitation link
            <input
              readOnly
              value={link}
              onFocus={(event) => event.target.select()}
              className="mt-1 w-full rounded-sm border border-strong bg-canvas p-3 font-mono text-xs"
            />
          </label>
          <Button
            variant="secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(link)
                .then(() => setNotice("Private invitation copied."))
                .catch(() => setError("Select the link above and copy it."))
            }
          >
            Copy private invitation
          </Button>
          <p className="text-xs text-ink-2">
            Save this link securely now. It is only shown when created.
          </p>
        </div>
      )}
      {confirm ? (
        <div className="space-y-3 border-t border-hairline pt-3">
          <p className="text-sm text-ink">
            {confirm === "issue"
              ? "Replace the current invitation? Devices using it will need the new link, and their personal-code sessions will end. Your current manager session stays open."
              : "Has your team received the private link? Personal-code sessions without it will end. Your current manager session stays open. Manager passwords remain available."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} disabled={busy} onClick={() => void act(confirm)}>
              Confirm {confirm === "issue" ? "replacement" : "invitation requirement"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!status || busy}
            loading={busy}
            onClick={() =>
              status?.hasInvitation ? setConfirm("issue") : void act("issue")
            }
          >
            {status?.hasInvitation
              ? "Replace private invitation"
              : "Create private invitation"}
          </Button>
          {status?.hasInvitation && !status.required && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirm("require")}
            >
              Require invitation for sign-in
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-ink">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-ink-2">
          {notice}
        </p>
      )}
    </section>
  );
}
