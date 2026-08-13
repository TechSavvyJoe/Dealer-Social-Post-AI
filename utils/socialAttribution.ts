import type { Dealer } from "../types";

type SocialDestinationId =
  | "facebook_feed"
  | "marketplace"
  | "instagram_feed"
  | "instagram_reel"
  | "instagram_story"
  | "tiktok"
  | "x_twitter"
  | "linkedin"
  | "gbp"
  | "native_share"
  | string;

export type DealerSocialProfile = Pick<
  Dealer,
  | "facebook_page_tag"
  | "instagram_handle"
  | "tiktok_handle"
  | "x_handle"
  | "linkedin_company_tag"
>;

export type DealerSocialProfileField = keyof DealerSocialProfile;

type UsernamePlatform = "instagram" | "tiktok" | "x";

const FACEBOOK_RESERVED_PROFILE_PATHS = new Set([
  "business",
  "events",
  "gaming",
  "groups",
  "hashtag",
  "help",
  "home.php",
  "latest",
  "login",
  "marketplace",
  "pages",
  "people",
  "permalink.php",
  "pg",
  "photo",
  "photos",
  "plugins",
  "profile.php",
  "reel",
  "reels",
  "share",
  "story.php",
  "watch",
]);

const urlPathParts = (value: string): string[] => {
  if (!/^https?:\/\//i.test(value)) return [];
  try {
    const url = new URL(value);
    return url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return [];
  }
};

const facebookPageTagFromValue = (value: string): string => {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    const isFacebookHost =
      hostname === "facebook.com" ||
      hostname.endsWith(".facebook.com") ||
      hostname === "fb.com" ||
      hostname.endsWith(".fb.com");
    if (!isFacebookHost) return "";

    const firstPathPart = urlPathParts(value)[0] || "";
    const normalizedPath = firstPathPart.toLowerCase();
    if (
      !firstPathPart ||
      FACEBOOK_RESERVED_PROFILE_PATHS.has(normalizedPath) ||
      normalizedPath.endsWith(".php")
    ) {
      return "";
    }
    return firstPathPart;
  } catch {
    return "";
  }
};

const tagFromUrl = (value: string): string => {
  if (!/^https?:\/\//i.test(value)) return value;
  const pieces = urlPathParts(value);
  const companyIndex = pieces.indexOf("company");
  return companyIndex >= 0 ? pieces[companyIndex + 1] || "" : pieces.at(-1) || "";
};

const usernameFromValue = (value: string, platform: UsernamePlatform): string => {
  if (!/^https?:\/\//i.test(value)) return value;
  const pieces = urlPathParts(value);
  if (platform === "tiktok") {
    return pieces.find((part) => part.startsWith("@")) || pieces[0] || "";
  }
  // Instagram and X profile URLs put the username first. This deliberately
  // ignores later /p/, /reel/, /status/, and similar content identifiers.
  const first = pieces[0] || "";
  const reserved =
    platform === "instagram"
      ? new Set(["p", "reel", "reels", "stories", "explore"])
      : new Set(["home", "i", "intent", "search", "share"]);
  return reserved.has(first.toLowerCase()) ? "" : first;
};

const normalizeUsernameTag = (
  value: string | null | undefined,
  platform: UsernamePlatform,
): string => {
  const limits: Record<UsernamePlatform, number> = {
    instagram: 30,
    tiktok: 24,
    x: 15,
  };
  const allowed = platform === "x" ? /[^A-Za-z0-9_]+/g : /[^A-Za-z0-9._]+/g;
  const cleaned = usernameFromValue(
    String(value || "")
      .trim()
      .normalize("NFKC"),
    platform,
  )
    .replace(/^@+/, "")
    .replace(allowed, "")
    .slice(0, limits[platform]);
  return cleaned ? `@${cleaned}` : "";
};

/**
 * A Facebook @mention only resolves against the Page *username*, which never
 * contains spaces. Pasting the store's display name ("Bob Maxey Ford of
 * Howell") previously stored it verbatim and rendered "@Bob Maxey Ford of
 * Howell", which links to nothing — so close the value up rather than reject
 * it. Page usernames allow letters, numbers, and periods only.
 *
 * LinkedIn deliberately keeps its spaced display name: that composer resolves
 * a company from a typed suggestion, so it is not the same shape of value.
 */
const normalizeFacebookPageTag = (value: string | null | undefined): string => {
  const cleaned = String(value || "")
    .trim()
    .normalize("NFKC")
    .replace(/^@+/, "")
    .replace(/[^A-Za-z0-9.]+/g, "")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 100);
  return cleaned ? `@${cleaned}` : "";
};

/** Normalize pasted handles/URLs without storing markup or multiline content. */
export const normalizeSocialTag = (value: string | null | undefined): string => {
  const cleaned = tagFromUrl(
    String(value || "")
      .trim()
      .normalize("NFKC"),
  )
    .replace(/^@+/, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned ? `@${cleaned}` : "";
};

/**
 * Canonical value stored in a dealer profile. Storage omits the display `@`;
 * `dealershipMentionFor` adds it only when building destination copy.
 */
export const normalizeDealerSocialProfileValue = (
  field: DealerSocialProfileField,
  value: string | null | undefined,
): string => {
  const raw = String(value || "").trim();
  const facebookPageValue =
    field === "facebook_page_tag" && /^https?:\/\//i.test(raw)
      ? facebookPageTagFromValue(raw)
      : value;
  const normalized =
    field === "instagram_handle"
      ? normalizeUsernameTag(value, "instagram")
      : field === "tiktok_handle"
        ? normalizeUsernameTag(value, "tiktok")
        : field === "x_handle"
          ? normalizeUsernameTag(value, "x")
          : field === "facebook_page_tag"
            ? normalizeFacebookPageTag(facebookPageValue)
            : normalizeSocialTag(facebookPageValue);
  return normalized.replace(/^@/u, "");
};

export const dealershipMentionFor = (
  destinationId: SocialDestinationId,
  dealer: DealerSocialProfile | null | undefined,
): string => {
  if (!dealer) return "";
  if (destinationId === "facebook_feed" || destinationId === "marketplace") {
    const value = normalizeDealerSocialProfileValue(
      "facebook_page_tag",
      dealer.facebook_page_tag,
    );
    return value ? `@${value}` : "";
  }
  if (destinationId.startsWith("instagram")) {
    const value = normalizeDealerSocialProfileValue(
      "instagram_handle",
      dealer.instagram_handle,
    );
    return value ? `@${value}` : "";
  }
  if (destinationId === "tiktok") {
    const value = normalizeDealerSocialProfileValue(
      "tiktok_handle",
      dealer.tiktok_handle,
    );
    return value ? `@${value}` : "";
  }
  if (destinationId === "x_twitter") {
    const value = normalizeDealerSocialProfileValue("x_handle", dealer.x_handle);
    return value ? `@${value}` : "";
  }
  if (destinationId === "linkedin") {
    const value = normalizeDealerSocialProfileValue(
      "linkedin_company_tag",
      dealer.linkedin_company_tag,
    );
    return value ? `@${value}` : "";
  }
  return "";
};

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Match the configured mention as a complete token, never as part of a longer
 * handle, email address, or Page name.
 */
export const captionIncludesDealershipMention = (
  caption: string,
  mention: string,
): boolean => {
  const expected = mention.trim().normalize("NFKC").toLowerCase();
  if (!expected) return false;
  const normalizedCaption = caption.normalize("NFKC").toLowerCase();
  if (/\s/u.test(expected)) {
    // Display-name mentions can contain spaces, so a normal word boundary
    // cannot distinguish "@Dealer" from "@Dealer of Howell". The app adds
    // these as their own line; require that complete line here as well.
    return normalizedCaption.split(/\r?\n/u).some((line) => line.trim() === expected);
  }
  const boundaryBefore = String.raw`(^|[\s([{'"/\-–—“‘])`;
  const boundaryAfter = String.raw`(?=$|[\s.,!?;:)\]}'"/\-–—”’])`;
  return new RegExp(
    `${boundaryBefore}${escapeRegularExpression(expected)}${boundaryAfter}`,
    "mu",
  ).test(normalizedCaption);
};

/**
 * Add only the destination's dealership mention. A copied @Page name can
 * prompt Facebook/LinkedIn to show a suggestion; the salesperson may need to
 * tap that suggestion once to turn the text into an active Page/company tag.
 */
export const appendDealershipMention = (
  caption: string,
  destinationId: SocialDestinationId,
  dealer: DealerSocialProfile | null | undefined,
): string => {
  const body = caption.trim();
  const mention = dealershipMentionFor(destinationId, dealer);
  if (!mention || captionIncludesDealershipMention(body, mention)) {
    return body;
  }
  return body ? `${body}\n\n${mention}` : mention;
};
