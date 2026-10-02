import React, { useCallback, useRef, useState } from "react";
import { AlertCircle, ShieldCheck } from "lucide-react";
import type { PendingRelease } from "../../types";
import { SignaturePad, type SignaturePadHandle } from "../SignaturePad";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { logEvent } from "../../utils/telemetry";

export interface ReleaseSheetProps {
  dealershipName: string;
  vin?: string;
  defaultCustomerName?: string;
  onCaptured: (release: PendingRelease) => void;
  onCancel: () => void;
}

export const ReleaseSheet: React.FC<ReleaseSheetProps> = ({
  dealershipName,
  vin,
  defaultCustomerName = "",
  onCaptured,
  onCancel,
}) => {
  const padRef = useRef<SignaturePadHandle | null>(null);
  const [customerName, setCustomerName] = useState(defaultCustomerName);
  const [signatureEmpty, setSignatureEmpty] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(() => {
    const legalName = customerName.trim();
    if (!legalName) {
      setError("Please enter the customer's name.");
      return;
    }
    const signaturePngDataUrl = padRef.current?.toDataURL();
    if (!signaturePngDataUrl) {
      setError("Please ask the customer to sign before continuing.");
      return;
    }
    logEvent("photo_release.captured", { vinPresent: Boolean(vin) });
    onCaptured({ customerName: legalName, signaturePngDataUrl, vin, linked: false });
  }, [customerName, onCaptured, vin]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-hairline bg-panel-raised px-4 py-3 text-sm leading-relaxed text-ink-2">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            By signing below, the customer grants{" "}
            <strong className="font-semibold text-ink">{dealershipName}</strong>{" "}
            permission to use the photo taken today on social media, websites,
            advertising, and other marketing materials. The customer may withdraw
            consent in writing at any time by contacting the dealership.
          </p>
        </div>
      </div>
      <Input
        label="Customer's full name"
        value={customerName}
        onChange={(event) => {
          setCustomerName(event.target.value);
          setError(null);
        }}
        autoComplete="name"
        fullWidth
      />
      {vin ? (
        <div className="font-mono text-caption text-ink-hint">Attached VIN: {vin}</div>
      ) : null}
      <SignaturePad
        ref={padRef}
        width={600}
        height={180}
        onChange={setSignatureEmpty}
      />
      {error ? (
        <div
          role="alert"
          className="flex gap-2 rounded-sm border border-error-ink/40 bg-error-fill px-3 py-2 text-sm text-error-ink"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      ) : null}
      <p className="text-caption leading-relaxed text-ink-hint">
        Required for customer-focused posts. It is stored securely before AI processing,
        linked only to this post, and an abandoned unlinked capture expires within 24
        hours.
      </p>
      <Button
        type="button"
        fullWidth
        size="lg"
        disabled={signatureEmpty || !customerName.trim()}
        onClick={submit}
      >
        Done
      </Button>
      <Button type="button" fullWidth variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
};
