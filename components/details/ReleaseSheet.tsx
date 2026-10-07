import React, { useCallback, useId, useRef, useState } from "react";
import type { PendingRelease } from "../../types";
import {
  readInkColor,
  SignaturePad,
  type SignatureGap,
  type SignaturePadHandle,
} from "../SignaturePad";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { logEvent } from "../../utils/telemetry";
import {
  RELEASE_CONSENT_GRANT,
  RELEASE_CONSENT_LEAD,
  RELEASE_STORAGE_NOTICE,
} from "./releaseConsent";

export interface ReleaseSheetProps {
  dealershipName: string;
  vin?: string;
  defaultCustomerName?: string;
  onCaptured: (release: PendingRelease) => void;
  onCancel: () => void;
}

const NAME_MISSING = "Enter the customer's full name.";
/** Says the one step still missing in the pad's visible mode. */
const SIGNATURE_MISSING: Record<SignatureGap, string> = {
  drawing: "Have the customer sign in the box above.",
  typed_name: "Have the customer type their full legal name above.",
  attestation: "Have the customer tick the box above to confirm.",
};

export const ReleaseSheet: React.FC<ReleaseSheetProps> = ({
  dealershipName,
  vin,
  defaultCustomerName = "",
  onCaptured,
  onCancel,
}) => {
  const padRef = useRef<SignaturePadHandle | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  // The sheet remounts on every open, so the theme's ink is read once here and
  // drives both the drawn stroke and the typed-signature image. A fixed white
  // stroke was invisible on the Sunlight pad.
  const [inkColor] = useState(readInkColor);
  const [customerName, setCustomerName] = useState(defaultCustomerName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const signatureErrorId = `${useId().replace(/:/g, "")}-signature-error`;

  const clearSignatureError = useCallback((empty: boolean) => {
    if (!empty) setSignatureError(null);
  }, []);

  const submit = useCallback(() => {
    const legalName = customerName.trim();
    const signaturePngDataUrl = padRef.current?.toDataURL() ?? null;
    setNameError(legalName ? null : NAME_MISSING);
    setSignatureError(
      signaturePngDataUrl
        ? null
        : SIGNATURE_MISSING[padRef.current?.missingStep?.() ?? "drawing"],
    );
    if (!legalName) {
      nameRef.current?.focus();
      return;
    }
    if (!signaturePngDataUrl) return;
    logEvent("photo_release.captured", { vinPresent: Boolean(vin) });
    onCaptured({ customerName: legalName, signaturePngDataUrl, vin, linked: false });
  }, [customerName, onCaptured, vin]);

  return (
    <div className="space-y-5">
      <p className="text-base leading-6 text-ink-2">
        {RELEASE_CONSENT_LEAD}{" "}
        <strong className="font-semibold text-ink">{dealershipName}</strong>{" "}
        {RELEASE_CONSENT_GRANT}
      </p>
      <div className="space-y-2">
        {/* Not AutoFill-able: the phone is the salesperson's, so a suggested
            "name" would record their legal name as the customer's. The field
            name also avoids "name", which Safari's contact matching keys on. */}
        <Input
          ref={nameRef}
          label="Customer's full name"
          name="release-signer"
          value={customerName}
          onChange={(event) => {
            setCustomerName(event.target.value);
            setNameError(null);
          }}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          error={nameError ?? undefined}
          fullWidth
        />
        {vin ? (
          <div className="font-mono text-caption text-ink-hint">
            Attached VIN: {vin}
          </div>
        ) : null}
      </div>
      <div>
        <SignaturePad
          ref={padRef}
          width={600}
          height={180}
          strokeColor={inkColor}
          onChange={clearSignatureError}
          describedBy={signatureError ? signatureErrorId : undefined}
        />
        {signatureError ? (
          <p
            id={signatureErrorId}
            role="alert"
            className="mt-1 text-caption text-error-ink"
          >
            {signatureError}
          </p>
        ) : null}
      </div>
      <p className="text-caption leading-[18px] text-ink-hint">
        {RELEASE_STORAGE_NOTICE}
      </p>
      <div className="space-y-2">
        <Button type="button" fullWidth size="lg" onClick={submit}>
          Save signature
        </Button>
        <Button type="button" fullWidth variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};
