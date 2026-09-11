import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { ShieldCheck, AlertCircle, Check } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { SignaturePad, SignaturePadHandle } from "./SignaturePad";
import { CapturedRelease } from "../services/photoReleases";
import { logEvent } from "../utils/telemetry";
import { triggerHapticFeedback } from "../utils/haptics";

interface PhotoReleaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Kept for backwards compat — unused in capture-only mode. */
  dealerId?: string;
  dealershipName: string;
  /** Optional VIN to attach to the release */
  vin?: string;
  defaultCustomerName?: string;
  /**
   * Called with the captured (not yet uploaded) release. Generation first
   * stores it as a short-lived, session-owned record, then links that same
   * record to the post. An abandoned unlinked record expires automatically.
   */
  onCaptured?: (release: CapturedRelease) => void;
}

export const PhotoReleaseModal: React.FC<PhotoReleaseModalProps> = ({
  isOpen,
  onClose,
  dealershipName,
  vin,
  defaultCustomerName,
  onCaptured,
}) => {
  const padRef = useRef<SignaturePadHandle | null>(null);
  const autoCloseTimerRef = useRef<number | null>(null);
  const wasOpenRef = useRef(false);
  const backConsequenceId = useId();
  const [customerName, setCustomerName] = useState(defaultCustomerName || "");
  const [signatureEmpty, setSignatureEmpty] = useState(true);
  const [captured, setCaptured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearAutoCloseTimer = useCallback(() => {
    if (autoCloseTimerRef.current === null) return;
    window.clearTimeout(autoCloseTimerRef.current);
    autoCloseTimerRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    clearAutoCloseTimer();
    setCustomerName(defaultCustomerName || "");
    setSignatureEmpty(true);
    setCaptured(false);
    setError(null);
    padRef.current?.clear();
    onClose();
  }, [clearAutoCloseTimer, defaultCustomerName, onClose]);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setCustomerName(defaultCustomerName || "");
    } else if (!isOpen && wasOpenRef.current) {
      clearAutoCloseTimer();
      setCustomerName(defaultCustomerName || "");
      setSignatureEmpty(true);
      setCaptured(false);
      setError(null);
      padRef.current?.clear();
    }
    wasOpenRef.current = isOpen;
  }, [clearAutoCloseTimer, defaultCustomerName, isOpen]);

  useEffect(
    () => () => {
      clearAutoCloseTimer();
    },
    [clearAutoCloseTimer],
  );

  const handleSubmit = useCallback(() => {
    setError(null);
    if (!customerName.trim()) {
      setError("Please enter the customer's name.");
      return;
    }
    const sigDataUrl = padRef.current?.toDataURL();
    if (!sigDataUrl) {
      setError("Please ask the customer to sign before continuing.");
      return;
    }

    logEvent("photo_release.captured", { vinPresent: Boolean(vin) });
    triggerHapticFeedback();
    setCaptured(true);
    onCaptured?.({
      customerName: customerName.trim(),
      signaturePngDataUrl: sigDataUrl,
      vin,
    });
    clearAutoCloseTimer();
    autoCloseTimerRef.current = window.setTimeout(() => {
      autoCloseTimerRef.current = null;
      handleClose();
    }, 1200);
  }, [customerName, vin, onCaptured, clearAutoCloseTimer, handleClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Customer photo release"
      description="Required for customer-focused posts. It is stored securely before AI processing, linked only to this post, and an abandoned unlinked capture expires within 24 hours."
      size="lg"
    >
      <div className="space-y-4">
        <AnimatePresence mode="wait">
          {captured ? (
            <m.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 py-8 text-center"
            >
              <div className="w-14 h-14 rounded-full bg-success-500/20 flex items-center justify-center">
                <Check className="h-7 w-7 text-success-400" />
              </div>
              <div className="text-lg font-semibold text-surface-50">
                Release captured
              </div>
              <div className="text-xs text-surface-400">
                Generate will securely store it before AI processing and link it to this
                exact customer and vehicle.
              </div>
            </m.div>
          ) : (
            <m.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              {/* Consent text */}
              <div className="rounded-xl border border-primary-500/30 bg-primary-500/5 px-4 py-3 text-xs text-surface-200 leading-relaxed">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary-300 mt-0.5 flex-shrink-0" />
                  <p>
                    By signing below, the customer grants{" "}
                    <strong className="text-surface-50">{dealershipName}</strong>{" "}
                    permission to use the photo taken today on social media, websites,
                    advertising, and other marketing materials. The customer may
                    withdraw consent in writing at any time by contacting the
                    dealership.
                  </p>
                </div>
              </div>

              <Input
                label="Customer's full name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Jane Smith"
                fullWidth
                className="bg-fill-subtle border-hairline focus:border-primary-400"
              />

              {vin && (
                <div className="text-[11px] text-surface-400 font-mono">
                  Attached VIN: {vin}
                </div>
              )}

              <SignaturePad
                ref={padRef}
                width={600}
                height={220}
                onChange={(empty) => setSignatureEmpty(empty)}
              />

              <AnimatePresence>
                {error && (
                  <m.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-error-700/50 bg-error-900/40 px-3 py-2 text-error-100 text-xs [.theme-light_&]:text-error-800"
                  >
                    <AlertCircle className="h-4 w-4 text-error-400 flex-shrink-0 mt-0.5" />
                    {error}
                  </m.div>
                )}
              </AnimatePresence>

              <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-hairline">
                <div className="flex-1">
                  <Button
                    variant="filled"
                    size="md"
                    fullWidth
                    disabled={signatureEmpty || !customerName.trim()}
                    leftIcon={<ShieldCheck className="h-4 w-4" />}
                    onClick={handleSubmit}
                  >
                    Capture release
                  </Button>
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Button
                    variant="ghost"
                    size="md"
                    fullWidth
                    aria-describedby={backConsequenceId}
                    onClick={handleClose}
                  >
                    Back to post
                  </Button>
                  <p
                    id={backConsequenceId}
                    className="text-center text-[11px] leading-relaxed text-surface-400"
                  >
                    No release will be saved. Customer-photo AI generation stays blocked
                    until a signed release is captured.
                  </p>
                </div>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
};
