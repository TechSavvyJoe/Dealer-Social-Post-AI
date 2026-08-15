const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "mx"]);

export const normalizeCustomerIdentity = (value?: string): string =>
  (value || "").normalize("NFKC").replace(/\s+/g, " ").trim();

/**
 * Convert a private release/signature name into the least identifying label
 * needed for public marketing. Full legal names stay on the protected release.
 */
export const toPublicCustomerLabel = (value?: string): string => {
  const normalized = normalizeCustomerIdentity(value)
    .replace(/[\r\n<>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!normalized) return "";

  // Deliberately entered family/generic labels are already public-safe phrases.
  if (/\bfamil(?:y|ies)$/i.test(normalized) || /^our\b/i.test(normalized)) {
    return normalized;
  }

  // Couples/group signers should not be reduced to an ampersand or expose a
  // surname. Public copy can celebrate them without carrying release identity.
  if (/\s(?:&|and)\s/i.test(normalized)) {
    return "our customers";
  }

  const tokens = normalized.split(" ").filter(Boolean);
  while (
    tokens.length > 1 &&
    HONORIFICS.has(tokens[0].replace(/\./g, "").toLowerCase())
  ) {
    tokens.shift();
  }
  return tokens[0] || "";
};

export const releaseAuthorizesPublicLabel = (
  releaseCustomerName?: string,
  publicCustomerLabel?: string,
): boolean => {
  const expected = toPublicCustomerLabel(releaseCustomerName).toLocaleLowerCase();
  // Do not canonicalize the proposed value again: doing so made
  // "Lisa Jordan" authorize against a release for "Lisa Marie Sample" merely
  // because both collapsed to the same first name.
  const actual = normalizeCustomerIdentity(publicCustomerLabel).toLocaleLowerCase();
  return Boolean(expected) && expected === actual;
};
