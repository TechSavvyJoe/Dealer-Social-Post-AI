/**
 * Vehicle makes that also read as plausible customer surnames ("Ford",
 * "Lincoln", "Mercedes"). Kept in one place so the caption identity guard and
 * the website-copy redaction agree on what a "brand token" is. Mirror of
 * AUTOMOTIVE_BRAND_TOKENS in pb_hooks/websitePublications.js — the server
 * runs the same identity checks and must classify the same words.
 */
export const AUTOMOTIVE_BRAND_TOKENS: ReadonlySet<string> = new Set([
  "acura",
  "audi",
  "bmw",
  "buick",
  "cadillac",
  "chevrolet",
  "chevy",
  "chrysler",
  "dodge",
  "ford",
  "genesis",
  "gmc",
  "honda",
  "hyundai",
  "infiniti",
  "jaguar",
  "jeep",
  "kia",
  "landrover",
  "lexus",
  "lincoln",
  "mazda",
  "mercedes",
  "mercedesbenz",
  "mini",
  "mitsubishi",
  "nissan",
  "porsche",
  "ram",
  "rivian",
  "rover",
  "subaru",
  "tesla",
  "toyota",
  "volkswagen",
  "volvo",
]);

export const isAutomotiveBrandToken = (token: string): boolean =>
  AUTOMOTIVE_BRAND_TOKENS.has(
    (token || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z]/g, ""),
  );
