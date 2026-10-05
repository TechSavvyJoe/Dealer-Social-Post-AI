/**
 * Legally operative wording of the customer photo release.
 *
 * Every string here is approved copy and must not change by one character
 * without the dealership owner's sign-off: restyle the sheet freely, never
 * reword it. `__tests__/ReleaseSheet.test.tsx` and
 * `__tests__/SignaturePad.test.tsx` compare the rendered text with frozen
 * copies of this wording, so an edit here fails those tests on purpose.
 *
 * Source of truth: the production `components/PhotoReleaseModal.tsx` (consent
 * paragraph and modal description) and `components/SignaturePad.tsx` (typed
 * attestation), copied byte for byte.
 */

/** Consent paragraph, before the dealership's name. */
export const RELEASE_CONSENT_LEAD = "By signing below, the customer grants";

/** Consent paragraph, after the dealership's name. */
export const RELEASE_CONSENT_GRANT =
  "permission to use the photo taken today on social media, websites, advertising, and other marketing materials. The customer may withdraw consent in writing at any time by contacting the dealership.";

/** The full consent paragraph as the customer reads it. */
export const releaseConsentText = (dealershipName: string): string =>
  `${RELEASE_CONSENT_LEAD} ${dealershipName} ${RELEASE_CONSENT_GRANT}`;

/** How the signature is stored and when an unused one expires. */
export const RELEASE_STORAGE_NOTICE =
  "Required for customer-focused posts. It is stored securely before AI processing, linked only to this post, and an abandoned unlinked capture expires within 24 hours.";

/** The customer's attestation when they type their name instead of drawing. */
export const TYPED_SIGNATURE_ATTESTATION =
  "I am the named customer and agree that typing my name is my electronic signature for this photo release.";
