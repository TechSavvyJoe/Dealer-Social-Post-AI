/**
 * The sample post beside every settings section, as plain data.
 *
 * The sample is not a mock-up: its caption is built by the functions that
 * build real posts, in the same order, from the dealer record the caller
 * passes (the saved record overlaid with unsaved form values, so it is live).
 * Every sentence here describes what the code does; the comments name the
 * code each one was checked against. Pure: no React, no requests, no storage.
 */
import type { Dealer, LogoCorner, SignatureLook } from "../../types";
import { buildCopyText } from "../../services/deliveryCaptions";
import {
  LOOK_DEFINITIONS,
  isCreativeSystemEnabled,
  isSignatureLook,
  resolveSignatureLook,
} from "../../services/creativeSystem";
import { resolveStoreDefaults } from "../../services/storeDefaults";
import { dealerBrandKit } from "../../utils/brandKit";
import {
  analyzeCaptionForDelivery,
  buildEmployeeDisclosure,
  CANONICAL_DISCLOSURE_HEADER,
} from "../../utils/complianceDisclosures";
import { brandHashtagFromName, formatHashtag } from "../../utils/hashtags";
import {
  appendDealershipMention,
  dealershipMentionFor,
} from "../../utils/socialAttribution";

/** Which part of the sample a settings section marks. */
export type SampleMark = "none" | "mention" | "closing" | "look" | "disclosure";

/** The sample is a Facebook post, the destination every store offers. */
const SAMPLE_DESTINATION = "facebook_feed";

/** The real alt text for the sample photo (public/samples/delivery.webp). */
export const SAMPLE_PHOTO_ALT =
  "Sample photo: a salesperson hands a customer the key to a blue SUV in a showroom";

/**
 * The fixed sample body: about a delivery, no person's name, and the
 * dealership's name once. At 132 characters before the name it always clears
 * the marketing-length floor in `applyDealerBrandKit`, so the pipeline never
 * adds a line to it.
 */
export const sampleBody = (dealer: Pick<Dealer, "name">): string =>
  `Congratulations on your new SUV! Thank you for choosing ${
    (dealer.name || "").trim() || "our dealership"
  }. We loved helping you find the right one, and we hope you enjoy every mile.`;

export interface SampleCaption {
  /** The team-member disclosure line, "" when the store turned it off. */
  disclosure: string;
  /** The body paragraph(s), without footer, hashtags or mention. */
  body: string;
  /** The store footer, "" when none. */
  footer: string;
  /** The hashtag line, "" when none. */
  hashtags: string;
  /** The page tag line for Facebook, "" when none. */
  mention: string;
  /**
   * A hashtag line the copy path writes under the page tag, "" when none (the
   * copied text ends with the tag). A safeguard so the parts
   * always rebuild `full`: a copy path that scans the caption again after
   * adding the tag lets the brand kit's hashtag floor put a line of discovery
   * tags under it, and the sample shows what is copied rather than hiding it.
   */
  afterMention: string;
  /** The compliance disclosure block ("— Disclosures —" and its text), "" when none. */
  compliance: string;
  /** Exactly what the copy path would put on the clipboard for Facebook. "" when refused. */
  full: string;
  /**
   * Set when the real copy path refuses this caption (a blocked phrase). The
   * parts then hold the sample body alone and `full` is empty: the sample never
   * shows a caption the real path would refuse.
   */
  blockedReason?: string;
}

const HASHTAG_LINE = /^#[A-Za-z0-9_]+(?:[ \t]+#[A-Za-z0-9_]+)*$/;

/**
 * Reassemble the parts with the separators the pipeline uses: blank lines
 * between blocks, but one line break before a hashtag line (applyDealerBrandKit
 * puts hashtags directly under the body or footer, and the copy path's re-added
 * line directly under the page tag). `joinSampleCaption(c) === c.full` for
 * every caption that was not refused.
 */
export const joinSampleCaption = (caption: SampleCaption): string => {
  let text = caption.disclosure ? `${caption.disclosure}\n\n` : "";
  text += caption.body;
  if (caption.footer) text += `\n\n${caption.footer}`;
  if (caption.hashtags) text += `\n${caption.hashtags}`;
  if (caption.mention) text += `\n\n${caption.mention}`;
  if (caption.afterMention) text += `\n${caption.afterMention}`;
  if (caption.compliance) text += `\n\n${caption.compliance}`;
  return text;
};

/**
 * Take the copied text apart using values the real functions already told us.
 * Each step peels a part only when the exact separator the pipeline writes is
 * there; anything unexpected stays in the body, so joining the parts always
 * gives back `full` exactly.
 */
const splitCopyText = (
  full: string,
  known: {
    disclosure: string;
    mention: string;
    mentionAppended: boolean;
    footer: string;
  },
): SampleCaption => {
  let rest = full;

  let disclosure = "";
  if (known.disclosure && rest.startsWith(`${known.disclosure}\n\n`)) {
    disclosure = known.disclosure;
    rest = rest.slice(disclosure.length + 2);
  }

  let compliance = "";
  const complianceAt = rest.indexOf(`\n\n${CANONICAL_DISCLOSURE_HEADER}`);
  if (complianceAt >= 0) {
    compliance = rest.slice(complianceAt + 2);
    rest = rest.slice(0, complianceAt);
  }

  let mention = "";
  let afterMention = "";
  if (known.mention && known.mentionAppended) {
    const at = rest.lastIndexOf(`\n\n${known.mention}`);
    if (at >= 0) {
      const tail = rest.slice(at + 2 + known.mention.length);
      if (tail === "" || (tail.startsWith("\n") && HASHTAG_LINE.test(tail.slice(1)))) {
        mention = known.mention;
        afterMention = tail.slice(1);
        rest = rest.slice(0, at);
      }
    }
  }

  let hashtags = "";
  const lastBreak = rest.lastIndexOf("\n");
  if (lastBreak >= 0 && HASHTAG_LINE.test(rest.slice(lastBreak + 1))) {
    hashtags = rest.slice(lastBreak + 1);
    rest = rest.slice(0, lastBreak);
  }

  let footer = "";
  if (known.footer && rest.endsWith(`\n\n${known.footer}`)) {
    footer = known.footer;
    rest = rest.slice(0, rest.length - footer.length - 2);
  }

  return {
    disclosure,
    body: rest,
    footer,
    hashtags,
    mention,
    afterMention,
    compliance,
    full,
  };
};

/**
 * The sample caption, through the real pipeline in the real order:
 * generation's caption preparation (`analyzeCaptionForDelivery` with the
 * store's brand kit, which runs `applyDealerBrandKit`: footer, then hashtags),
 * then the copy path (`buildCopyText` for Facebook: compliance scan, then the
 * page tag on its own line, then the team-member disclosure first).
 */
export const composeSampleCaption = (dealer: Dealer): SampleCaption => {
  const body = sampleBody(dealer);
  const bannedPhrases = dealer.banned_phrases;
  const edited = analyzeCaptionForDelivery(
    body,
    bannedPhrases,
    dealerBrandKit(dealer),
    true,
  ).caption;
  const copy = buildCopyText({
    editedText: edited,
    copyDestinationId: SAMPLE_DESTINATION,
    dealer,
    bannedPhrases,
    deliveryLanguageAllowed: true,
  });
  if (copy.blockedReason) {
    return {
      disclosure: "",
      body,
      footer: "",
      hashtags: "",
      mention: "",
      afterMention: "",
      compliance: "",
      full: "",
      blockedReason: copy.blockedReason,
    };
  }
  return splitCopyText(copy.text, {
    disclosure: buildEmployeeDisclosure(dealer),
    mention: dealershipMentionFor(SAMPLE_DESTINATION, dealer),
    // appendDealershipMention leaves a caption that already carries the tag
    // (in a footer, say) alone; only an appended tag is its own line.
    mentionAppended:
      appendDealershipMention(edited, SAMPLE_DESTINATION, dealer) !== edited.trim(),
    footer: (dealer.default_footer || "").trim(),
  });
};

export interface SampleApproval {
  /** True when the server would hold this sample delivery post for the manager. */
  held: boolean;
  /** One sentence for under the sample, in the manager's words. */
  note: string;
}

const EVERY_POST: SampleApproval = {
  held: true,
  note: "Every post waits for your approval.",
};

/**
 * `initialApprovalStatus` in pb_hooks/requestPolicies.js for one case: a
 * delivery post that involves a customer, from a salesperson with no approved
 * posts yet. The switch decides; the policy can only narrow it; whatever the
 * policy cannot decide is held.
 */
export const sampleApproval = (dealer: Dealer): SampleApproval => {
  if (dealer.requires_approval !== true) {
    return { held: false, note: "Posts can be shared as soon as they are created." };
  }
  const policy: unknown = dealer.approval_policy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return EVERY_POST;
  const { mode, firstN, categories } = policy as Record<string, unknown>;
  if (mode === "per_category") {
    // The server reads the list as saved: an empty or unreadable list holds
    // everything, and only "deliveries" decides a delivery.
    const list = Array.isArray(categories) ? categories : [];
    if (list.length === 0) return EVERY_POST;
    return list.includes("deliveries")
      ? {
          held: true,
          note: "This is a delivery, and Deliveries is checked, so it cannot be shared until you approve it.",
        }
      : {
          held: false,
          note: "Deliveries is not checked, so this delivery can be shared right away.",
        };
  }
  if (mode === "first_n") {
    const n = Number(firstN);
    if (!(n >= 1) || Math.floor(n) !== n) return EVERY_POST;
    // The server counts APPROVED posts, so a rejected post does not count.
    return {
      held: true,
      note:
        n === 1
          ? "A person's posts wait for your approval until you have approved one."
          : `A person's posts wait for your approval until you have approved ${n} of them.`,
    };
  }
  return EVERY_POST;
};

export interface SampleNote {
  glyph: "line" | "dash" | "strip" | "none";
  text: string;
}

const savedHashtags = (dealer: Dealer): string[] =>
  (dealer.default_hashtags || "")
    .split(/[\n,]+/)
    .map((tag) => formatHashtag(tag.trim()))
    .filter(Boolean);

/**
 * The Look the sample draws: the Look posts use, exactly as `resolveCreative`
 * in services/creativeSystem.ts decides it. With the creative system on, the
 * saved Look (an unset one resolves to Showroom); with it off, none, even when
 * the manager has saved one, because posts then use the classic styles. The
 * three choice prints preview each Look through SamplePhoto's `look` prop.
 */
export const sampleLook = (dealer: Dealer): SignatureLook | undefined =>
  isCreativeSystemEnabled(dealer) ? resolveSignatureLook(dealer) : undefined;

const LOGO_CORNERS: readonly LogoCorner[] = [
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
];

/**
 * The logo width as a fraction of the print, with the same bounds and default
 * the settings form applies (components/DealerAdminDashboard.tsx
 * LOGO_SCALE_MIN/MAX/DEFAULT, and the server's logo_placement validation).
 */
const LOGO_SCALE_MIN = 0.04;
const LOGO_SCALE_MAX = 0.5;
const LOGO_SCALE_DEFAULT = 0.18;

/**
 * Where the sample draws a logo whose corner was never saved (the form saves
 * `logo_placement: null` until a corner is picked). Generation never reads
 * logo_placement: every designed photo is given the logo whatever corner is
 * saved (services/geminiService.ts), so a sample without it would understate
 * the post. The Showroom Look's own description puts it bottom-right
 * (LOOK_DEFINITIONS in services/creativeSystem.ts).
 */
const LOGO_CORNER_DEFAULT: LogoCorner = "bottom_right";

export interface SampleLogo {
  /** The saved logo: an `/api/files/...` URL or a data URL. */
  src: string;
  /** The saved corner, or bottom-right when none is saved. */
  corner: LogoCorner;
  /** Width as a fraction of the print width, 0.04 to 0.5. */
  scale: number;
}

/**
 * The logo SamplePhoto draws, or null when the store has no logo. A store
 * with a logo always gets it drawn: in its saved corner at its saved size, or
 * bottom-right at the settings' default size when no corner is saved. Never a
 * stand-in wordmark: a store without a logo shows none.
 */
export const sampleLogo = (dealer: Dealer): SampleLogo | null => {
  const src = (dealer.logo || "").trim();
  if (!src) return null;
  const saved = dealer.logo_placement?.corner;
  if (!LOGO_CORNERS.includes(saved as LogoCorner)) {
    return { src, corner: LOGO_CORNER_DEFAULT, scale: LOGO_SCALE_DEFAULT };
  }
  const scale = Number(dealer.logo_placement?.scale);
  return {
    src,
    corner: saved as LogoCorner,
    scale: Number.isFinite(scale)
      ? Math.min(LOGO_SCALE_MAX, Math.max(LOGO_SCALE_MIN, scale))
      : LOGO_SCALE_DEFAULT,
  };
};

/** True when SamplePhoto draws the store logo: whenever the store has one. */
export const sampleShowsLogo = (dealer: Dealer): boolean => sampleLogo(dealer) !== null;

const lookNotes = (dealer: Dealer): SampleNote[] => {
  const notes: SampleNote[] = [];
  const chosen = isSignatureLook(dealer.signature_look) ? dealer.signature_look : null;
  if (isCreativeSystemEnabled(dealer)) {
    const label = LOOK_DEFINITIONS[resolveSignatureLook(dealer)].label;
    notes.push({
      glyph: "line",
      text: chosen
        ? `The ${label} headline. The signature Look sets its type and the photo finish.`
        : `The ${label} headline. No signature Look is chosen, so posts use ${label}.`,
    });
  } else if (chosen) {
    // creative_system_v2 is off: resolveCreative ignores the Look and posts
    // use the classic style list, so the sample draws no headline (sampleLook)
    // and this note points at nothing. Only a system administrator switches it.
    notes.push({
      glyph: "none",
      text: `Your ${LOOK_DEFINITIONS[chosen].label} Look is saved. Posts use the classic styles until a system administrator turns on the signature Look for your store.`,
    });
  } else {
    notes.push({
      glyph: "none",
      text: "No signature Look yet. Posts use the classic styles.",
    });
  }
  // The logo reaches every designed photo (services/creativeSkills.ts, and the
  // image review in services/geminiService.ts fails a design without it). The
  // saved corner is not sent to the designer, so no note claims a placement.
  if (sampleShowsLogo(dealer)) {
    notes.push({ glyph: "dash", text: "Your logo. Designed photos carry it." });
  } else {
    notes.push({
      glyph: "none",
      text: "No logo yet. Designed photos show your store name as text instead.",
    });
  }
  return notes;
};

/**
 * What the Voice settings put on every caption. Checked against
 * `applyDealerBrandKit` (utils/brandKit.ts), which generation runs on every
 * caption with the store's kit: the footer goes after the body, then one
 * hashtag line whose order is the store's own tag (from its name), the saved
 * tags, then filler tags, at least four in all. So the footer and the line
 * FOLLOW the body; they do not always close the caption (the copy path can
 * put a page tag, more hashtags and compliance disclosures after them).
 */
const closingNote = (dealer: Dealer): string => {
  const footer = Boolean((dealer.default_footer || "").trim());
  const tags = savedHashtags(dealer).length > 0;
  const storeTag = Boolean(brandHashtagFromName((dealer.name || "").trim()));
  if (footer && tags) {
    return storeTag
      ? "Your footer and hashtags. Every caption gets them after its body; the hashtag line starts with your store's tag, then yours."
      : "Your footer and hashtags. Every caption gets them after its body.";
  }
  if (footer) {
    return storeTag
      ? "Your footer. Every caption gets it after its body, above a hashtag line that starts with your store's tag."
      : "Your footer. Every caption gets it after its body, above a hashtag line the app adds.";
  }
  if (tags) {
    return storeTag
      ? "Your hashtags. Every caption gets a hashtag line after its body: your store's tag, then yours."
      : "Your hashtags. Every caption gets them after its body.";
  }
  return storeTag
    ? "No footer or hashtags saved yet. Every caption still gets a hashtag line after its body, starting with your store's tag."
    : "No footer or hashtags saved yet. Every caption still gets a hashtag line after its body.";
};

/**
 * What this Facebook caption puts after the footer and hashtags, read from
 * the parts the real copy path produced: the page tag on its own line, and
 * any hashtag line the copy path writes under the tag (see `afterMention`).
 * Null when nothing follows them.
 */
const closingTailNote = (caption: SampleCaption): string | null => {
  if (!caption.mention) return null;
  const after = caption.hashtags ? "the hashtag line" : "them";
  return caption.afterMention
    ? `In this Facebook caption, your page tag and a second line of common delivery hashtags come after ${after}.`
    : `In this Facebook caption, your page tag comes after ${after}.`;
};

/**
 * True when the store's footer already carries its Facebook page tag, judged
 * by the function that decides it (`appendDealershipMention` leaves a caption
 * that carries the tag alone). The fixed sample body never carries one.
 */
const footerCarriesTag = (dealer: Dealer): boolean => {
  const footer = (dealer.default_footer || "").trim();
  return (
    Boolean(footer) &&
    appendDealershipMention(footer, SAMPLE_DESTINATION, dealer) === footer
  );
};

/** The notes shown under the sample for a mark, in order. */
export const sampleNotes = (dealer: Dealer, mark: SampleMark): SampleNote[] => {
  const caption = composeSampleCaption(dealer);
  const notes: SampleNote[] = caption.blockedReason
    ? [
        {
          glyph: "none",
          text: `Your team could not share this caption. ${caption.blockedReason}`,
        },
      ]
    : [];

  switch (mark) {
    case "mention": {
      const tag = dealershipMentionFor(SAMPLE_DESTINATION, dealer);
      if (!tag) {
        notes.push({
          glyph: "none",
          text: "No page tag yet. Add one and it appears here.",
        });
      } else if (caption.mention || !footerCarriesTag(dealer)) {
        // Every outgoing caption is built per channel: PostScreen gives each
        // channel the salesperson can pick its own buildShareCaptions entry,
        // which runs appendDealershipMention after the compliance scan, and
        // the copy path (buildCopyText) does the same. dealershipMentionFor is
        // the only source of the tag for facebook_feed and marketplace, and
        // appendDealershipMention puts it on its own line, last. A refused
        // sample has no parts to read (caption.mention is ""), so the footer
        // decides: appendDealershipMention adds nothing to a caption whose
        // footer already carries the tag, refused or not.
        notes.push({
          glyph: caption.mention ? "line" : "none",
          text: "Your Facebook page tag. It is added, on its own line, to every Facebook and Marketplace caption your team shares.",
        });
      } else {
        notes.push({
          glyph: "none",
          text: "Your Facebook page tag is already in your footer, so it is not added again.",
        });
      }
      return notes;
    }
    case "disclosure": {
      if (buildEmployeeDisclosure(dealer)) {
        notes.push({
          glyph: caption.disclosure ? "line" : "none",
          text: "The team-member disclosure. It opens every post your team shares.",
        });
      } else {
        notes.push({
          glyph: "none",
          text: "The disclosure is off. Posts carry no team-member line.",
        });
      }
      const approval = sampleApproval(dealer);
      notes.push({ glyph: approval.held ? "strip" : "none", text: approval.note });
      return notes;
    }
    case "closing": {
      // The line glyph points at the marked parts: the footer and the
      // hashtag line. The tail note explains unmarked parts, so it has none.
      notes.push({
        glyph: caption.footer || caption.hashtags ? "line" : "none",
        text: closingNote(dealer),
      });
      const tail = closingTailNote(caption);
      if (tail) notes.push({ glyph: "none", text: tail });
      return notes;
    }
    case "look":
      return [...notes, ...lookNotes(dealer)];
    default:
      // services/generationRequest.ts sends the saved website, address, hours
      // and phone as "Dealership facts (may be referenced, never
      // contradicted)" in each post's brief; nothing in the caption, copy or
      // image path stamps them on a post. The spec's own sentence is true.
      notes.push({
        glyph: "none",
        text: "The caption writer knows your website, phone, address and hours and can mention them. Nothing here is stamped on every post.",
      });
      return notes;
  }
};

/** One line for the collapsed strip on phones. */
export const sampleSummary = (dealer: Dealer, mark: SampleMark): string => {
  switch (mark) {
    case "mention": {
      const tag = dealershipMentionFor(SAMPLE_DESTINATION, dealer);
      // Names the tag without claiming every caption carries it (see the
      // mention note in sampleNotes).
      return tag ? `Your Facebook page tag is ${tag}` : "No page tag yet";
    }
    case "disclosure":
      return sampleApproval(dealer).note;
    case "closing": {
      const footer = Boolean((dealer.default_footer || "").trim());
      const tags = savedHashtags(dealer).length > 0;
      // "Follow the body", never "close": see closingNote.
      if (footer && tags)
        return "Your footer and hashtags follow every caption's body.";
      if (footer) return "Your footer follows every caption's body.";
      if (tags) return "Your hashtags follow every caption's body.";
      return "No footer or hashtags saved yet";
    }
    case "look": {
      const chosen = isSignatureLook(dealer.signature_look)
        ? dealer.signature_look
        : null;
      if (isCreativeSystemEnabled(dealer)) {
        if (!chosen) return "Showroom Look until you choose one";
        const label = LOOK_DEFINITIONS[chosen].label;
        // Follows the drawing, so the strip and its thumbnail agree.
        return sampleShowsLogo(dealer)
          ? `${label} Look with your logo`
          : `${label} Look`;
      }
      return chosen
        ? `${LOOK_DEFINITIONS[chosen].label} Look, not on posts yet`
        : "Classic styles, no signature Look yet";
    }
    default:
      return "The caption writer can mention your contact details.";
  }
};

/** Labels for "Your team can share this to", from resolveStoreDefaults for a delivery. */
export const sampleChannels = (dealer: Dealer): string[] =>
  resolveStoreDefaults({
    dealer,
    person: null,
    categoryId: "deliveries",
    scenarioId: "customer_delivery",
    websiteReady: false,
  }).channels.map((channel) => channel.label);
