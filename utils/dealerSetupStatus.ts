import type { ApprovalPolicy, BrandCategoryId, Dealer, SignatureLook } from "../types";

/**
 * Per-store setup status for the system administrator's Dealers tab.
 *
 * Computed only from the saved dealer record the admin list returns
 * (`GET /api/app/dealers`, field names from `serializeDealer` in
 * pb_hooks/helpers.js). Every value shown here is a public profile field;
 * nothing secret is read.
 *
 * The creative fields (`signature_look`, `approval_policy`,
 * `employee_disclosure_disabled`, `creative_system_v2`) are in
 * `serializeDealer` but only reach the admin list once the list route returns
 * them. A list that does not carry them must not be read as "missing" or
 * "off": those rows report "unknown" instead, so a backend that has not caught
 * up can never make a configured store look unconfigured. They travel
 * together, so `creative_system_v2` arriving as a boolean is the signal.
 */

export type SetupState = "ready" | "missing" | "optional" | "on" | "off" | "unknown";

export type SetupRowId =
  | "profile"
  | "brand"
  | "facebook"
  | "instagram"
  | "gbp"
  | "tiktok"
  | "x"
  | "linkedin"
  | "voice"
  | "look"
  | "approval"
  | "disclosure"
  | "creative_system";

export interface SetupRow {
  id: SetupRowId;
  label: string;
  state: SetupState;
  /** Counts toward "N of M set up". Optional channels and switches never do. */
  counts: boolean;
  /** True when the row deserves the administrator's attention. */
  attention: boolean;
  /** The saved value in plain words, one entry per line. Empty when unset. */
  value: string[];
  /** A brand color to preview beside the value, already validated as hex. */
  swatch?: string;
  /** One sentence: what to do and exactly where it is set. */
  guidance: string | null;
}

export interface DealerSetupStatus {
  rows: SetupRow[];
  ready: number;
  total: number;
  /** Counted rows that are not ready, in display order. */
  missing: SetupRow[];
  /** "5 of 7 set up". */
  summary: string;
}

export const SETUP_STATE_LABELS: Record<SetupState, string> = {
  ready: "Ready",
  missing: "Missing",
  optional: "Optional",
  on: "On",
  off: "Off",
  unknown: "Not reported",
};

const LOOK_LABELS: Record<SignatureLook, string> = {
  showroom: "Showroom",
  hometown: "Hometown",
  turbo: "Turbo",
};

const CATEGORY_LABELS: Record<BrandCategoryId, string> = {
  deliveries: "Deliveries",
  inventory: "Inventory",
  service: "Service",
  promotions: "Promotions",
  community: "Community",
  team: "Team",
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const MANAGER_PATH = (section: string) =>
  `open as the manager, then Settings > ${section}`;

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** "a", "a and b", "a, b and c". */
const joinWords = (items: string[]): string =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** A URL as people say it: no scheme, no "www.", no trailing slash. */
export const displayUrl = (url: string): string =>
  url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");

const handle = (value: string): string => `@${value.replace(/^@+/, "")}`;

const isSignatureLook = (value: unknown): value is SignatureLook =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(LOOK_LABELS, value);

const isCategory = (value: unknown): value is BrandCategoryId =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value);

/**
 * A required area made of one or more fields: ready when every part is saved,
 * otherwise missing with one sentence naming the unsaved parts and where they
 * are set.
 */
const requiredRow = (
  id: SetupRowId,
  label: string,
  parts: Array<{ name: string; saved: string; shown: string }>,
  where: (missingNames: string) => string,
): SetupRow => {
  const unsaved = parts.filter((part) => !part.saved).map((part) => part.name);
  return {
    id,
    label,
    state: unsaved.length ? "missing" : "ready",
    counts: true,
    attention: unsaved.length > 0,
    value: parts.filter((part) => part.saved).map((part) => part.shown),
    guidance: unsaved.length ? where(joinWords(unsaved)) : null,
  };
};

const optionalChannelRow = (
  id: SetupRowId,
  label: string,
  saved: string,
  shown: string,
): SetupRow => ({
  id,
  label,
  state: saved ? "ready" : "optional",
  counts: false,
  attention: false,
  value: saved ? [shown] : [],
  guidance: saved
    ? null
    : `Optional: if the store posts on ${label}, ${MANAGER_PATH("Channels")}.`,
});

/**
 * The approval rule exactly as the server applies it
 * (pb_hooks/requestPolicies.js initialApprovalStatus): `requires_approval`
 * is the switch and `approval_policy` can only narrow it. Anything the policy
 * cannot decide is reviewed, so it reads as "Every post". When Deliveries is
 * a selected type, the server also reviews any other post with a customer in
 * it, so the sentence says so.
 */
export const describeApproval = (
  requiresApproval: boolean,
  policy: ApprovalPolicy | null | undefined,
): string => {
  if (!requiresApproval) return "No approval required";
  if (!policy || typeof policy !== "object") return "Every post";
  if (policy.mode === "first_n") {
    const firstN = Number(policy.firstN);
    if (Number.isInteger(firstN) && firstN >= 1) {
      return `Until each person has ${firstN} approved ${firstN === 1 ? "post" : "posts"}`;
    }
    return "Every post";
  }
  if (policy.mode === "per_category") {
    const categories = (Array.isArray(policy.categories) ? policy.categories : [])
      .filter(isCategory)
      .filter((category, index, all) => all.indexOf(category) === index);
    if (!categories.length) return "Every post";
    const types = `Selected post types: ${joinWords(categories.map((c) => CATEGORY_LABELS[c]))}`;
    return categories.includes("deliveries")
      ? `${types}, plus any post with a customer`
      : types;
  }
  return "Every post";
};

export const dealerSetupStatus = (dealer: Dealer): DealerSetupStatus => {
  // The creative fields arrive together; their absence means the list did
  // not report them, not that they are unset.
  const creativeReported = typeof dealer.creative_system_v2 === "boolean";
  const disclosureReported = typeof dealer.employee_disclosure_disabled === "boolean";

  const website = text(dealer.website);
  const phone = text(dealer.phone);
  const address = text(dealer.address);
  const hours = text(dealer.hours);
  const logo = text(dealer.logo);
  const brandColor = text(dealer.brand_color);
  const facebookUrl = text(dealer.facebook_url);
  const facebookTag = text(dealer.facebook_page_tag).replace(/^@+/, "");
  const instagram = text(dealer.instagram_handle).replace(/^@+/, "");
  const gbpUrl = text(dealer.gbp_url);
  const tiktok = text(dealer.tiktok_handle).replace(/^@+/, "");
  const xHandle = text(dealer.x_handle).replace(/^@+/, "");
  const linkedin = text(dealer.linkedin_company_tag);
  const brandVoice = text(dealer.brand_voice);

  const rows: SetupRow[] = [];

  const profileRow = requiredRow(
    "profile",
    "Store profile",
    [
      { name: "website", saved: website, shown: displayUrl(website) },
      { name: "phone", saved: phone, shown: phone },
      { name: "address", saved: address, shown: address },
    ],
    (names) => `Add the ${names}: ${MANAGER_PATH("Store profile")}.`,
  );
  // Hours are shown when saved but never count: the store is set up without them.
  if (hours) profileRow.value.push(`Hours: ${hours}`);
  rows.push(profileRow);

  const brandRow = requiredRow(
    "brand",
    "Brand",
    [
      { name: "logo", saved: logo, shown: "Logo uploaded" },
      {
        name: "brand color",
        saved: brandColor,
        shown: HEX_COLOR.test(brandColor) ? brandColor.toUpperCase() : brandColor,
      },
    ],
    () =>
      !logo && !brandColor
        ? `Upload the logo with Edit on this card; for the brand color, ${MANAGER_PATH("Store profile")}.`
        : !logo
          ? "Upload the logo: choose Edit on this card."
          : `Set the brand color: ${MANAGER_PATH("Store profile")}.`,
  );
  if (HEX_COLOR.test(brandColor)) brandRow.swatch = brandColor;
  rows.push(brandRow);

  rows.push(
    requiredRow(
      "facebook",
      "Facebook",
      [
        { name: "page URL", saved: facebookUrl, shown: displayUrl(facebookUrl) },
        { name: "page tag", saved: facebookTag, shown: `Tags ${handle(facebookTag)}` },
      ],
      (names) => `Add the Facebook ${names}: ${MANAGER_PATH("Channels")}.`,
    ),
  );
  rows.push(
    requiredRow(
      "instagram",
      "Instagram",
      [{ name: "handle", saved: instagram, shown: handle(instagram) }],
      () => `Add the Instagram handle: ${MANAGER_PATH("Channels")}.`,
    ),
  );
  rows.push(
    requiredRow(
      "gbp",
      "Google Business Profile",
      [{ name: "URL", saved: gbpUrl, shown: displayUrl(gbpUrl) }],
      () => `Add the Google Business Profile URL: ${MANAGER_PATH("Channels")}.`,
    ),
  );

  rows.push(optionalChannelRow("tiktok", "TikTok", tiktok, handle(tiktok)));
  rows.push(optionalChannelRow("x", "X", xHandle, handle(xHandle)));
  rows.push(optionalChannelRow("linkedin", "LinkedIn", linkedin, linkedin));

  rows.push(
    requiredRow(
      "voice",
      "Brand voice",
      [{ name: "brand voice", saved: brandVoice, shown: brandVoice }],
      () => `Write the brand voice: ${MANAGER_PATH("Voice")}.`,
    ),
  );

  if (creativeReported) {
    const look = isSignatureLook(dealer.signature_look) ? dealer.signature_look : "";
    rows.push(
      requiredRow(
        "look",
        "Signature look",
        [{ name: "look", saved: look, shown: look ? LOOK_LABELS[look] : "" }],
        () => `Choose a signature look: ${MANAGER_PATH("Creative")}.`,
      ),
    );
  } else {
    rows.push({
      id: "look",
      label: "Signature look",
      state: "unknown",
      counts: false,
      attention: false,
      value: [],
      guidance: `This server's dealer list doesn't include the signature look yet; ${MANAGER_PATH("Creative")} to see it.`,
    });
  }

  const reviewOn = dealer.requires_approval === true;
  rows.push({
    id: "approval",
    label: "Manager approval",
    state: reviewOn ? "on" : "off",
    counts: false,
    attention: false,
    value: [
      reviewOn && !creativeReported
        ? "Review is on"
        : describeApproval(reviewOn, dealer.approval_policy),
    ],
    guidance:
      reviewOn && !creativeReported
        ? `This server's dealer list doesn't say which posts are reviewed; ${MANAGER_PATH("Workflow")} to see the rule.`
        : `To change it, ${MANAGER_PATH("Workflow")}.`,
  });

  if (disclosureReported) {
    const disclosureOn = dealer.employee_disclosure_disabled !== true;
    rows.push({
      id: "disclosure",
      label: "Team-member disclosure",
      state: disclosureOn ? "on" : "off",
      counts: false,
      // The disclosure is the store's FTC endorsement safeguard; off is worth
      // a second look even though it is the manager's choice.
      attention: !disclosureOn,
      value: disclosureOn
        ? [
            text(dealer.employee_disclosure_text)
              ? "Custom wording"
              : "Standard wording",
          ]
        : ["Not added to posts"],
      guidance: disclosureOn
        ? null
        : `To turn it back on, ${MANAGER_PATH("Workflow")}.`,
    });
  } else {
    rows.push({
      id: "disclosure",
      label: "Team-member disclosure",
      state: "unknown",
      counts: false,
      attention: false,
      value: [],
      guidance: `This server's dealer list doesn't include the disclosure setting yet; ${MANAGER_PATH("Workflow")} to see it.`,
    });
  }

  rows.push({
    id: "creative_system",
    label: "Streamlined creative system",
    state: creativeReported ? (dealer.creative_system_v2 ? "on" : "off") : "unknown",
    counts: false,
    attention: false,
    value: [],
    guidance: creativeReported
      ? null
      : "This server's dealer list doesn't report this setting yet, so it can't be changed here.",
  });

  const counted = rows.filter((row) => row.counts);
  const ready = counted.filter((row) => row.state === "ready").length;
  const missing = counted.filter((row) => row.state !== "ready");
  return {
    rows,
    ready,
    total: counted.length,
    missing,
    summary: `${ready} of ${counted.length} set up`,
  };
};

/** "Instagram and Signature look" for the card's one-line easy view. */
export const missingSummary = (status: DealerSetupStatus): string =>
  joinWords(status.missing.map((row) => row.label));
