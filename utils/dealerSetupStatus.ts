import type { ApprovalPolicy, BrandCategoryId, Dealer, SignatureLook } from "../types";

/**
 * The one place that decides what a store has set up. The system
 * administrator's setup board and the manager's settings rail both read it.
 *
 * Computed only from a saved dealer record: the admin list
 * (`GET /api/app/dealers`) or the manager's session, both with field names from
 * `serializeDealer` in pb_hooks/helpers.js. Every value shown here is a public
 * profile field; nothing secret is read.
 *
 * Six profile rows count toward setup, plus Private team access when reported: Store profile, Brand, Facebook,
 * Instagram, Brand voice and Signature look. Google Business Profile, TikTok,
 * X and LinkedIn are optional: the app stores them, but a missing one costs
 * the store nothing (the Google share target opens
 * https://business.google.com/posts/ whatever link is saved; see
 * services/publishTargets.ts), so they are never called missing.
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

/** The five sections of the manager's Dealership settings. */
export type SettingsSectionId =
  "profile" | "channels" | "voice" | "creative" | "workflow";

export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  profile: "Store profile",
  channels: "Channels",
  voice: "Voice",
  creative: "Creative",
  workflow: "Workflow",
};

const SETTINGS_SECTION_IDS = Object.keys(
  SETTINGS_SECTION_LABELS,
) as SettingsSectionId[];

export const isSettingsSectionId = (value: unknown): value is SettingsSectionId =>
  typeof value === "string" &&
  (SETTINGS_SECTION_IDS as readonly string[]).includes(value);

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
  | "creative_system"
  | "private_access";

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
  /** The settings section that fixes this row; null for the creative system. */
  section: SettingsSectionId | null;
  /**
   * When `state` is "missing": one true sentence about what that costs the
   * store. Null in every other state.
   */
  reason: string | null;
}

export interface SectionStatus {
  id: SettingsSectionId;
  label: string;
  /** Counted rows in this section that are ready. */
  ready: number;
  /** Counted rows in this section. 0 for Workflow. */
  total: number;
  /** "none" when total is 0; "ready" when all are; "empty" when none are; otherwise "partial". */
  state: "ready" | "partial" | "empty" | "none";
}

export interface DealerSetupStatus {
  rows: SetupRow[];
  ready: number;
  total: number;
  /** Counted rows that are not ready, in display order. */
  missing: SetupRow[];
  /** "5 of 6 set up" (six counted rows when the creative fields are reported). */
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
export const joinWords = (items: string[]): string =>
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
 * are set, and one sentence about what the gap costs the store.
 */
const requiredRow = (
  id: SetupRowId,
  label: string,
  section: SettingsSectionId,
  parts: Array<{ name: string; saved: string; shown: string }>,
  where: (missingNames: string) => string,
  cost: (missingNames: string[]) => string,
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
    section,
    reason: unsaved.length ? cost(unsaved) : null,
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
  section: "channels",
  reason: null,
});

/**
 * The approval rule exactly as the server applies it
 * (pb_hooks/requestPolicies.js initialApprovalStatus): `requires_approval`
 * is the switch and `approval_policy` can only narrow it. Anything the policy
 * cannot decide is reviewed, so it reads as "Every post". Both describers
 * below format this one reading, so they can never disagree.
 */
type ApprovalReading =
  | { kind: "off" }
  | { kind: "every" }
  | { kind: "first_n"; firstN: number }
  | { kind: "per_category"; categories: BrandCategoryId[] };

const readApproval = (
  requiresApproval: boolean,
  policy: ApprovalPolicy | null | undefined,
): ApprovalReading => {
  if (!requiresApproval) return { kind: "off" };
  if (!policy || typeof policy !== "object") return { kind: "every" };
  if (policy.mode === "first_n") {
    const firstN = Number(policy.firstN);
    return Number.isInteger(firstN) && firstN >= 1
      ? { kind: "first_n", firstN }
      : { kind: "every" };
  }
  if (policy.mode === "per_category") {
    const categories = (Array.isArray(policy.categories) ? policy.categories : [])
      .filter(isCategory)
      .filter((category, index, all) => all.indexOf(category) === index);
    return categories.length ? { kind: "per_category", categories } : { kind: "every" };
  }
  return { kind: "every" };
};

/**
 * The rule in a sentence. When Deliveries is a selected type, the server also
 * reviews any other post with a customer in it, so the sentence says so.
 */
export const describeApproval = (
  requiresApproval: boolean,
  policy: ApprovalPolicy | null | undefined,
): string => {
  const reading = readApproval(requiresApproval, policy);
  switch (reading.kind) {
    case "off":
      return "No approval required";
    case "first_n":
      return `Until each person has ${reading.firstN} approved ${reading.firstN === 1 ? "post" : "posts"}`;
    case "per_category": {
      const types = `Selected post types: ${joinWords(reading.categories.map((c) => CATEGORY_LABELS[c]))}`;
      return reading.categories.includes("deliveries")
        ? `${types}, plus any post with a customer`
        : types;
    }
    default:
      return "Every post";
  }
};

/**
 * For the setup board's Approval column: "Off", "Every post",
 * "First 3 posts each", "Deliveries and Promotions".
 */
export const describeApprovalShort = (
  requiresApproval: boolean,
  policy: ApprovalPolicy | null | undefined,
): string => {
  const reading = readApproval(requiresApproval, policy);
  switch (reading.kind) {
    case "off":
      return "Off";
    case "first_n":
      return reading.firstN === 1
        ? "First post each"
        : `First ${reading.firstN} posts each`;
    case "per_category":
      return joinWords(reading.categories.map((c) => CATEGORY_LABELS[c]));
    default:
      return "Every post";
  }
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
    "profile",
    [
      { name: "website", saved: website, shown: displayUrl(website) },
      { name: "phone", saved: phone, shown: phone },
      { name: "address", saved: address, shown: address },
    ],
    (names) => `Add the ${names}: ${MANAGER_PATH("Store profile")}.`,
    // services/generationRequest.ts hands the saved website, address, hours
    // and phone to the writer as "Dealership facts"; an unsaved one is simply
    // absent from every brief.
    (names) => `The caption writer has no ${joinWords(names)} to mention.`,
  );
  // Hours are shown when saved but never count: the store is set up without them.
  if (hours) profileRow.value.push(`Hours: ${hours}`);
  rows.push(profileRow);

  const brandRow = requiredRow(
    "brand",
    "Brand",
    "creative",
    [
      { name: "logo", saved: logo, shown: "Logo uploaded" },
      {
        name: "brand color",
        saved: brandColor,
        shown: HEX_COLOR.test(brandColor) ? brandColor.toUpperCase() : brandColor,
      },
    ],
    // The store's own manager can replace the logo under Creative; the
    // administrator can still upload it with Edit on the store.
    () =>
      !logo && !brandColor
        ? `Upload the logo with Edit on this card, or ${MANAGER_PATH("Creative")} to add the logo and brand color.`
        : !logo
          ? `Upload the logo with Edit on this card, or ${MANAGER_PATH("Creative")}.`
          : `Set the brand color: ${MANAGER_PATH("Creative")}.`,
    (names) =>
      [
        // services/creativeSkills.ts: with no logo asset the designer uses the
        // dealership name as text and never draws a mark.
        names.includes("logo")
          ? "Designed photos show the store name as text instead of a logo."
          : "",
        // hooks/useDealerTheme.ts: no valid color leaves the app's default
        // accent (#1e40af in styles/globals.css) in place.
        names.includes("brand color")
          ? "The app uses its default blue for this store."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
  );
  if (HEX_COLOR.test(brandColor)) brandRow.swatch = brandColor;
  rows.push(brandRow);

  rows.push(
    requiredRow(
      "facebook",
      "Facebook",
      "channels",
      [
        { name: "page URL", saved: facebookUrl, shown: displayUrl(facebookUrl) },
        { name: "page tag", saved: facebookTag, shown: `Tags ${handle(facebookTag)}` },
      ],
      (names) => `Add the Facebook ${names}: ${MANAGER_PATH("Channels")}.`,
      // utils/socialAttribution.ts adds the page tag to Facebook and
      // Marketplace captions. Nothing in the app reads the page URL: it is
      // kept on file only, so the sentence says exactly that.
      (names) =>
        names.includes("page tag")
          ? "Facebook captions cannot tag the store."
          : "The page address is only kept on file; no post uses it.",
    ),
  );
  rows.push(
    requiredRow(
      "instagram",
      "Instagram",
      "channels",
      [{ name: "handle", saved: instagram, shown: handle(instagram) }],
      () => `Add the Instagram handle: ${MANAGER_PATH("Channels")}.`,
      () => "Instagram captions cannot tag the store.",
    ),
  );

  rows.push(
    optionalChannelRow("gbp", "Google Business Profile", gbpUrl, displayUrl(gbpUrl)),
  );
  rows.push(optionalChannelRow("tiktok", "TikTok", tiktok, handle(tiktok)));
  rows.push(optionalChannelRow("x", "X", xHandle, handle(xHandle)));
  rows.push(optionalChannelRow("linkedin", "LinkedIn", linkedin, linkedin));

  rows.push(
    requiredRow(
      "voice",
      "Brand voice",
      "voice",
      [{ name: "brand voice", saved: brandVoice, shown: brandVoice }],
      () => `Write the brand voice: ${MANAGER_PATH("Voice")}.`,
      // services/generationRequest.ts sends a "Brand voice" block only when
      // one is saved.
      () => "Captions are written without the store's voice.",
    ),
  );

  if (creativeReported) {
    const look = isSignatureLook(dealer.signature_look) ? dealer.signature_look : "";
    rows.push(
      requiredRow(
        "look",
        "Signature look",
        "creative",
        [{ name: "look", saved: look, shown: look ? LOOK_LABELS[look] : "" }],
        () => `Choose a signature look: ${MANAGER_PATH("Creative")}.`,
        // services/creativeSystem.ts: with the creative system on, an unset
        // Look resolves to Showroom; with it off, posts use the classic
        // style list and no Look is applied.
        () =>
          dealer.creative_system_v2 === true
            ? "Posts use the Showroom Look until one is chosen."
            : "Posts use the classic styles; no Look is applied.",
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
      section: "creative",
      reason: null,
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
    section: "workflow",
    reason: null,
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
      section: "workflow",
      reason: null,
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
      section: "workflow",
      reason: null,
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
    section: null,
    reason: null,
  });

  if (
    typeof dealer.invitation_required === "boolean" &&
    typeof dealer.has_invitation === "boolean"
  ) {
    const ready = dealer.invitation_required && dealer.has_invitation;
    rows.push({
      id: "private_access",
      label: "Private team access",
      state: ready ? "ready" : "missing",
      counts: true,
      attention: !ready,
      value: [ready ? "Private invitation required" : "Invitation setup needed"],
      guidance: ready
        ? null
        : "Create and distribute the private link in Private dealership access below, then require it for sign-in. Managers can also find it under Team.",
      section: null,
      reason: ready
        ? null
        : "Finish private invitations before onboarding this store's team.",
    });
  }

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

/**
 * Per settings section: how many of its counted rows are ready, read from the
 * saved record (never from unsaved form values). Workflow holds no counted
 * row, so its state is "none". A row the server did not report is not
 * counted, so it can never make a section look unfinished.
 */
export const settingsSectionStatus = (
  dealer: Dealer,
): Record<SettingsSectionId, SectionStatus> => {
  const { rows } = dealerSetupStatus(dealer);
  const entries = SETTINGS_SECTION_IDS.map((id): [SettingsSectionId, SectionStatus] => {
    const counted = rows.filter((row) => row.counts && row.section === id);
    const ready = counted.filter((row) => row.state === "ready").length;
    const total = counted.length;
    const state: SectionStatus["state"] =
      total === 0
        ? "none"
        : ready === total
          ? "ready"
          : ready === 0
            ? "empty"
            : "partial";
    return [id, { id, label: SETTINGS_SECTION_LABELS[id], ready, total, state }];
  });
  return Object.fromEntries(entries) as Record<SettingsSectionId, SectionStatus>;
};
