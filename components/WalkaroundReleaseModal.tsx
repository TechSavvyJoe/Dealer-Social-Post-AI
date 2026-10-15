import React from "react";
import { ShieldCheck } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";

export interface CapturedWalkaroundRelease {
  signedName: string;
  signaturePngDataUrl: string;
}

interface WalkaroundReleaseModalProps {
  isOpen: boolean;
  dealerName: string;
  defaultName?: string;
  onClose: () => void;
  onCaptured: (release: CapturedWalkaroundRelease) => void;
}

const CONSENTS = [
  ["video", "Record and use my appearance in this vehicle walkaround video."],
  ["voice", "Record and use my voice from this walkaround."],
  ["cloud", "Send the recording to approved cloud and AI services for editing."],
  [
    "youtube",
    "Upload the reviewed result to YouTube as an unlisted video whose link can be forwarded.",
  ],
] as const;

export const WalkaroundReleaseModal: React.FC<WalkaroundReleaseModalProps> = ({
  isOpen,
  dealerName,
  defaultName = "",
  onClose,
  onCaptured,
}) => {
  const padRef = React.useRef<SignaturePadHandle | null>(null);
  const [signedName, setSignedName] = React.useState(defaultName);
  const [signatureEmpty, setSignatureEmpty] = React.useState(true);
  const [consents, setConsents] = React.useState<Record<string, boolean>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) setSignedName(defaultName);
  }, [defaultName, isOpen]);

  const close = () => {
    setConsents({});
    setSignatureEmpty(true);
    setError(null);
    padRef.current?.clear();
    onClose();
  };

  const complete =
    signedName.trim().length > 0 &&
    !signatureEmpty &&
    CONSENTS.every(([id]) => consents[id]);

  const capture = () => {
    const signaturePngDataUrl = padRef.current?.toDataURL();
    if (!complete || !signaturePngDataUrl) {
      setError("Complete every consent item and signature before continuing.");
      return;
    }
    onCaptured({ signedName: signedName.trim(), signaturePngDataUrl });
    close();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      size="lg"
      title="Customer walkaround release"
      description="This release is saved to the exact project before any video processing starts."
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!complete} onClick={capture}>
            Capture release
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl border border-primary-400/30 bg-primary-500/10 p-4 text-sm leading-relaxed text-surface-200">
          <ShieldCheck
            className="h-5 w-5 shrink-0 text-primary-300"
            aria-hidden="true"
          />
          <p>
            By signing, I grant{" "}
            <strong className="text-surface-50">{dealerName}</strong> the permissions
            selected below for this walkaround. I can contact the dealership to withdraw
            future use.
          </p>
        </div>
        <label className="block text-sm font-medium text-surface-200">
          Customer&apos;s full legal name
          <input
            className="mt-2 min-h-11 w-full rounded-xl border border-hairline bg-surface-950/45 px-3 py-2 text-surface-50 outline-hidden focus:border-primary-400"
            value={signedName}
            onChange={(event) => setSignedName(event.target.value)}
          />
        </label>
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-surface-100">
            Permission for this project
          </legend>
          {CONSENTS.map(([id, label]) => (
            <label
              key={id}
              className="flex items-start gap-3 text-sm leading-relaxed text-surface-200"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={Boolean(consents[id])}
                onChange={(event) =>
                  setConsents((current) => ({ ...current, [id]: event.target.checked }))
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <SignaturePad
          ref={padRef}
          width={600}
          height={220}
          onChange={setSignatureEmpty}
        />
        {error && (
          <p
            role="alert"
            className="text-sm text-error-300 in-[.theme-light]:text-error-800"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};
