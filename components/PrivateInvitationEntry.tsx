import React, { useState } from "react";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { dealershipInvitationToken } from "../utils/dealershipInvitationLink";

export function PrivateInvitationEntry({
  configured,
  onOpen = (token: string) => location.assign("/join#" + token),
}: {
  configured: boolean;
  onOpen?: (token: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const inputId = React.useId();
  return (
    <div className="mt-1 min-w-0">
      <button
        type="button"
        className="min-h-11 text-left text-sm font-medium text-brand-ink underline underline-offset-4"
        aria-expanded={expanded}
        aria-controls={expanded ? inputId : undefined}
        onClick={() => {
          setExpanded(!expanded);
          setLink("");
          setError("");
        }}
      >
        {configured ? "Change dealership" : "Use a private invitation"}
      </button>
      {expanded && (
        <form
          id={inputId}
          className="mt-2 space-y-3 rounded-md border border-hairline bg-panel p-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const token = dealershipInvitationToken(link, location.origin);
            if (!token) {
              setError(
                "Enter this app’s private dealership invitation from your manager.",
              );
              return;
            }
            setLink("");
            onOpen(token);
          }}
        >
          <Input
            label="Private invitation link"
            type="url"
            inputMode="url"
            value={link}
            maxLength={2048}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Paste the link from your manager"
            error={error}
            helperText="Set up the app on this device, then use your personal code."
            onChange={(event) => {
              setLink(event.target.value);
              setError("");
            }}
          />
          <Button type="submit" className="w-full" disabled={!link.trim()}>
            Open invitation
          </Button>
        </form>
      )}
    </div>
  );
}
