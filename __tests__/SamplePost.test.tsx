import React from "react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dealer } from "../types";
import {
  appendDisclosureText,
  type BuildCopyTextInput,
  type CopyTextResult,
} from "../services/deliveryCaptions";
import {
  analyzeCaptionForDelivery,
  prependEmployeeDisclosure,
  prohibitedClaimsMessage,
} from "../utils/complianceDisclosures";
import { appendDealershipMention } from "../utils/socialAttribution";
import { SamplePhoto } from "../components/dealer-settings/SamplePhoto";
import { SamplePost } from "../components/dealer-settings/SamplePost";
import {
  SAMPLE_PHOTO_ALT,
  composeSampleCaption,
  sampleNotes,
  type SampleMark,
} from "../components/dealer-settings/sampleProof";

/**
 * Lets a test render the sample against a given shape of the Facebook copy
 * path (null: the real `buildCopyText`), so these tests hold whichever shape
 * ships and cover both.
 */
const copyPath = vi.hoisted(() => ({
  override: null as null | ((input: BuildCopyTextInput) => CopyTextResult),
}));

vi.mock("../services/deliveryCaptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/deliveryCaptions")>();
  return {
    ...actual,
    buildCopyText: (input: BuildCopyTextInput) =>
      copyPath.override ? copyPath.override(input) : actual.buildCopyText(input),
  };
});

afterEach(() => {
  copyPath.override = null;
});

type Destination = Parameters<typeof appendDealershipMention>[1];

/**
 * One shape of the Facebook copy path, from the steps `buildCopyText` uses.
 * `tagFirst`: the page tag is added, then the whole caption scanned (the
 * scan can write a hashtag line under the tag); otherwise the tag goes last.
 */
const copyShape =
  (tagFirst: boolean) =>
  (input: BuildCopyTextInput): CopyTextResult => {
    const tag = (text: string) =>
      appendDealershipMention(
        text,
        input.copyDestinationId as Destination,
        input.dealer,
      );
    const scanned = analyzeCaptionForDelivery(
      tagFirst ? tag(input.editedText) : input.editedText,
      input.bannedPhrases,
      undefined,
      input.deliveryLanguageAllowed,
    );
    if (scanned.compliance.prohibited.length > 0) {
      return {
        text: "",
        blockedReason: prohibitedClaimsMessage(scanned.compliance.prohibited),
      };
    }
    const caption = tagFirst ? scanned.caption : tag(scanned.caption);
    return {
      text: appendDisclosureText(
        prependEmployeeDisclosure(caption, input.dealer),
        scanned.disclosures,
      ),
    };
  };

/** A store with everything the sample can show. */
const full: Dealer = {
  id: "dealer-1",
  name: "Bob Maxey Ford of Howell",
  logo: "/api/files/dealers/dealer-1/logo.png",
  logo_placement: { corner: "bottom_right", scale: 0.2 },
  brand_color: "#1e40af",
  facebook_page_tag: "BobMaxeyFordHowell",
  instagram_handle: "bobmaxeyford",
  default_footer: "Visit us at 2798 E Grand River Ave, Howell.",
  default_hashtags: "#FordHowell, #HowellMI",
  signature_look: "showroom",
  creative_system_v2: true,
  requires_approval: true,
  approval_policy: { mode: "per_category", categories: ["deliveries", "promotions"] },
  employee_disclosure_disabled: false,
};

const MARKS: SampleMark[] = ["none", "mention", "closing", "look", "disclosure"];

const part = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLElement>(`[data-part="${name}"]`);

/** The caption parts that carry the underline, by name. */
const markedParts = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll("[data-sample-caption] [data-mark]")).map(
    (mark) => mark.closest("[data-part]")?.getAttribute("data-part") ?? "?",
  );

const headlineMark = (container: HTMLElement) =>
  container.querySelector('svg [data-mark="headline"]');

const logo = (container: HTMLElement) =>
  container.querySelector<HTMLImageElement>("[data-sample-logo]");

describe("SamplePost: the marks", () => {
  const expected: Record<SampleMark, string[]> = {
    none: [],
    mention: ["mention"],
    closing: ["footer", "hashtags"],
    look: [],
    disclosure: ["disclosure"],
  };

  it.each(MARKS)("%s underlines only its own part", (mark) => {
    const { container } = render(<SamplePost dealer={full} mark={mark} />);
    expect(markedParts(container)).toEqual(expected[mark]);
    // The mark itself: the 2 px brand-ink underline, not just the attribute.
    const marks = container.querySelectorAll("[data-sample-caption] [data-mark]");
    expect(marks).toHaveLength(expected[mark].length);
    marks.forEach((m) => expect(m).toHaveClass("border-b-2", "border-brand-ink"));
    // No unmarked caption part carries the underline.
    container.querySelectorAll("[data-sample-caption] [data-part]").forEach((p) => {
      if (!expected[mark].includes(p.getAttribute("data-part") ?? "")) {
        expect(p.querySelector(".border-brand-ink")).toBeNull();
      }
    });
    // The photo's marks belong to the Creative section alone: a 2 px
    // brand-ink rule under the headline, a dashed brand-ink outline on the logo.
    const headline = headlineMark(container);
    expect(Boolean(headline)).toBe(mark === "look");
    if (headline) {
      expect(headline).toHaveClass("stroke-brand-ink");
      expect(headline).toHaveAttribute("stroke-width", "2");
    }
    const outlined = ["outline-dashed", "outline-2", "outline-brand-ink"];
    if (mark === "look") {
      expect(logo(container)).toHaveClass(...outlined);
    } else {
      for (const name of outlined) expect(logo(container)).not.toHaveClass(name);
    }
  });

  it("sets the page tag semibold only when it is the marked part", () => {
    const { container, rerender } = render(<SamplePost dealer={full} mark="mention" />);
    expect(part(container, "mention")?.querySelector(".font-semibold")).not.toBeNull();
    rerender(<SamplePost dealer={full} mark="closing" />);
    expect(part(container, "mention")?.querySelector(".font-semibold")).toBeNull();
  });
});

describe("SamplePost: the caption is the real one", () => {
  it("shows each part the copy path produced, and nothing else", () => {
    const caption = composeSampleCaption(full);
    const { container } = render(<SamplePost dealer={full} mark="none" />);
    // An empty part renders no element, so a missing element reads as "".
    const shown = (name: string) => part(container, name)?.textContent ?? "";
    expect(shown("disclosure")).toBe(caption.disclosure);
    expect(shown("body")).toBe(caption.body);
    expect(shown("footer")).toBe(caption.footer);
    expect(shown("hashtags")).toBe(caption.hashtags);
    expect(shown("mention")).toBe(caption.mention);
    expect(shown("after-mention")).toBe(caption.afterMention);
    expect(part(container, "compliance")).toBeNull();
  });

  it("shows a hashtag line the copy path writes under the page tag, unmarked", () => {
    copyPath.override = copyShape(true);
    const caption = composeSampleCaption(full);
    expect(caption.afterMention).not.toBe("");
    const { container } = render(<SamplePost dealer={full} mark="closing" />);
    const after = part(container, "after-mention");
    expect(after?.textContent).toBe(caption.afterMention);
    expect(after?.querySelector("[data-mark]")).toBeNull();
    // It follows the page tag.
    const order = Array.from(container.querySelectorAll("[data-part]")).map((p) =>
      p.getAttribute("data-part"),
    );
    expect(order.slice(-2)).toEqual(["mention", "after-mention"]);
  });

  it("ends with the page tag when the copied text does", () => {
    copyPath.override = copyShape(false);
    expect(composeSampleCaption(full).afterMention).toBe("");
    const { container } = render(<SamplePost dealer={full} mark="mention" />);
    expect(part(container, "after-mention")).toBeNull();
    const order = Array.from(container.querySelectorAll("[data-part]")).map((p) =>
      p.getAttribute("data-part"),
    );
    expect(order).toEqual(["disclosure", "body", "footer", "hashtags", "mention"]);
    expect(markedParts(container)).toEqual(["mention"]);
  });

  it("omits the parts the store does not have", () => {
    const { container } = render(
      <SamplePost
        dealer={{
          ...full,
          employee_disclosure_disabled: true,
          default_footer: "",
          facebook_page_tag: "",
        }}
        mark="disclosure"
      />,
    );
    expect(part(container, "disclosure")).toBeNull();
    expect(part(container, "footer")).toBeNull();
    expect(part(container, "mention")).toBeNull();
    expect(part(container, "body")).not.toBeNull();
    expect(markedParts(container)).toEqual([]);
  });

  it("shows the compliance block the copy path appends", () => {
    const dealer = { ...full, default_footer: "Ask about 0.9% APR financing." };
    const { container } = render(<SamplePost dealer={dealer} mark="closing" />);
    expect(part(container, "compliance")?.textContent).toBe(
      composeSampleCaption(dealer).compliance,
    );
  });

  it("shows only the body and the reason when the real path would refuse the caption", () => {
    const blocked = { ...full, banned_phrases: "new SUV" };
    const { container } = render(<SamplePost dealer={blocked} mark="closing" />);
    const shown = Array.from(container.querySelectorAll("[data-part]")).map((p) =>
      p.getAttribute("data-part"),
    );
    expect(shown).toEqual(["body"]);
    expect(
      screen.getByText(sampleNotes(blocked, "closing")[0].text, { exact: true }),
    ).toBeInTheDocument();
  });
});

describe("SamplePost: approval", () => {
  const waiting = (container: HTMLElement) =>
    container.querySelector("[data-sample-waiting]");

  it("shows the waiting strip only when the rule holds the sample, and only for Workflow", () => {
    for (const mark of MARKS) {
      const { container, unmount } = render(<SamplePost dealer={full} mark={mark} />);
      expect(Boolean(waiting(container)), mark).toBe(mark === "disclosure");
      if (mark === "disclosure") {
        expect(waiting(container)).toHaveClass("bg-warning-fill", "text-warning-ink");
      }
      unmount();
    }
    const notHeld: Dealer[] = [
      { ...full, requires_approval: false },
      { ...full, approval_policy: { mode: "per_category", categories: ["service"] } },
    ];
    for (const dealer of notHeld) {
      const { container, unmount } = render(
        <SamplePost dealer={dealer} mark="disclosure" />,
      );
      expect(waiting(container)).toBeNull();
      unmount();
    }
  });

  it("puts the approval rule under the sample with the glyph that matches the strip", () => {
    const { container } = render(<SamplePost dealer={full} mark="disclosure" />);
    const notes = within(container.querySelector("[data-sample-notes]") as HTMLElement);
    const rule = notes.getByText(
      "This is a delivery, and Deliveries is checked, so it cannot be shared until you approve it.",
    );
    const strip = rule.closest("li")?.querySelector('[data-glyph="strip"]');
    // The glyph is drawn like the strip it explains: a warning-fill pill.
    expect(strip).toHaveClass("bg-warning-fill", "border-warning-ink", "rounded-full");
    const line = notes
      .getByText("The team-member disclosure. It opens every post your team shares.")
      .closest("li")
      ?.querySelector('[data-glyph="line"]');
    // ...and the line glyph like the underline it explains.
    expect(line).toHaveClass("border-b-2", "border-brand-ink");
  });

  it("draws the logo note's glyph like the logo's dashed outline", () => {
    const { container } = render(<SamplePost dealer={full} mark="look" />);
    const dash = container.querySelector('[data-sample-notes] [data-glyph="dash"]');
    expect(dash).toHaveClass("border-2", "border-dashed", "border-brand-ink");
    expect(
      container.querySelector('[data-sample-notes] [data-glyph="line"]'),
    ).toHaveClass("border-b-2", "border-brand-ink");
  });
});

describe("SamplePost: channels", () => {
  it("lists where the team can share only for the Channels mark", () => {
    for (const mark of MARKS) {
      const { unmount } = render(<SamplePost dealer={full} mark={mark} />);
      const list = screen.queryByRole("list", { name: "Your team can share this to" });
      if (mark === "mention") {
        expect(
          within(list as HTMLElement)
            .getAllByRole("listitem")
            .map((chip) => chip.textContent),
        ).toEqual(["Facebook", "Instagram"]);
      } else {
        expect(list, mark).toBeNull();
      }
      unmount();
    }
  });
});

describe("SamplePost is live", () => {
  it("re-renders from the dealer prop alone", () => {
    const { container, rerender } = render(<SamplePost dealer={full} mark="mention" />);
    expect(part(container, "mention")?.textContent).toBe("@BobMaxeyFordHowell");
    rerender(
      <SamplePost
        dealer={{
          ...full,
          facebook_page_tag: "HowellFord",
          default_footer: "Open late.",
        }}
        mark="mention"
      />,
    );
    expect(part(container, "mention")?.textContent).toBe("@HowellFord");
    expect(part(container, "footer")?.textContent).toBe("Open late.");
    rerender(<SamplePost dealer={{ ...full, facebook_page_tag: "" }} mark="mention" />);
    expect(part(container, "mention")).toBeNull();
    expect(
      screen.getByText("No page tag yet. Add one and it appears here."),
    ).toBeInTheDocument();
  });
});

describe("SamplePhoto", () => {
  it("is a real image with an alt, and its Look overlay is hidden from assistive technology", () => {
    const { container } = render(<SamplePost dealer={full} mark="look" />);
    const photo = screen.getByRole("img", { name: SAMPLE_PHOTO_ALT });
    expect(photo).toHaveAttribute("src", "/samples/delivery.webp");
    expect(photo).toHaveAttribute("width", "720");
    expect(photo).toHaveAttribute("height", "900");
    expect(photo).toHaveAttribute("loading", "lazy");
    const overlay = container.querySelector("[data-look] > svg");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay).toHaveAttribute("viewBox", "0 0 400 500");
    // The logo inside the print is decoration: empty alt.
    expect(logo(container)).toHaveAttribute("alt", "");
  });

  it("takes its alt from the caller", () => {
    render(<SamplePhoto dealer={full} alt="Sample photo in this store's Look" />);
    expect(
      screen.getByRole("img", { name: "Sample photo in this store's Look" }),
    ).toBeInTheDocument();
  });

  it("hides a decorative print entirely", () => {
    const { container } = render(<SamplePhoto dealer={full} look="turbo" decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    const print = container.firstElementChild as HTMLElement;
    expect(print).toHaveAttribute("aria-hidden", "true");
    expect(print.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("draws no logo when the store has none, and never a stand-in", () => {
    const { container } = render(
      <SamplePost dealer={{ ...full, logo: "" }} mark="look" />,
    );
    expect(logo(container)).toBeNull();
    const print = container.querySelector("[data-look]") as HTMLElement;
    expect(print.querySelectorAll("img")).toHaveLength(1);
    // The photo carries its Look's headline and nothing that spells the store.
    expect(print.textContent).toBe("Just delivered");
  });

  it("puts the logo in the saved corner at the saved scale", () => {
    const corners = ["top_left", "top_right", "bottom_left", "bottom_right"] as const;
    for (const corner of corners) {
      const { container, unmount } = render(
        <SamplePhoto
          dealer={{
            ...full,
            signature_look: "",
            creative_system_v2: false,
            logo_placement: { corner, scale: 0.25 },
          }}
        />,
      );
      const image = logo(container) as HTMLImageElement;
      expect(image).toHaveAttribute("src", full.logo);
      expect(image).toHaveAttribute("data-corner", corner);
      const [vertical, horizontal] = corner.split("_");
      expect(image.style.width).toBe("25%");
      expect(image.style.getPropertyValue(horizontal)).toBe("4%");
      expect(image.style.getPropertyValue(vertical)).toBe("3.2%");
      for (const other of ["top", "bottom", "left", "right"]) {
        if (other !== vertical && other !== horizontal) {
          expect(image.style.getPropertyValue(other)).toBe("");
        }
      }
      unmount();
    }
  });

  it("draws a logo with no saved corner bottom-right at the default size", () => {
    // Every designed photo carries the logo whatever corner is saved, so a
    // store that never picked one still sees its logo on the sample.
    const { container } = render(
      <SamplePhoto
        dealer={{
          ...full,
          signature_look: "",
          creative_system_v2: false,
          logo_placement: null,
        }}
      />,
    );
    const image = logo(container) as HTMLImageElement;
    expect(image).toHaveAttribute("src", full.logo);
    expect(image).toHaveAttribute("data-corner", "bottom_right");
    expect(image.style.width).toBe("18%");
    expect(image.style.getPropertyValue("right")).toBe("4%");
    expect(image.style.getPropertyValue("bottom")).toBe("3.2%");
  });

  it("lifts the logo clear of a headline in the same corner", () => {
    const at = (
      look: "showroom" | "hometown" | "turbo",
      corner: Dealer["logo_placement"],
    ) => {
      const { container, unmount } = render(
        <SamplePhoto dealer={{ ...full, logo_placement: corner }} look={look} />,
      );
      const style = logo(container)?.style;
      const placed = {
        top: style?.getPropertyValue("top"),
        bottom: style?.getPropertyValue("bottom"),
      };
      unmount();
      return placed;
    };
    // Hometown's band spans the bottom: either bottom corner sits above it.
    expect(at("hometown", { corner: "bottom_right", scale: 0.2 }).bottom).toBe("18.4%");
    expect(at("hometown", { corner: "bottom_left", scale: 0.2 }).bottom).toBe("18.4%");
    // Showroom's headline is lower left only.
    expect(at("showroom", { corner: "bottom_right", scale: 0.2 }).bottom).toBe("3.2%");
    expect(at("showroom", { corner: "bottom_left", scale: 0.2 }).bottom).toBe("16%");
    // Turbo's headline is upper left only.
    expect(at("turbo", { corner: "top_left", scale: 0.2 }).top).toBe("26.4%");
    expect(at("turbo", { corner: "top_right", scale: 0.2 }).top).toBe("3.2%");
  });

  it("draws no Look while the creative system is off, even with one saved", () => {
    // Posts use the classic styles then (resolveCreative returns look: null),
    // so no section's sample may show a designed headline.
    const off: Dealer = { ...full, signature_look: "turbo", creative_system_v2: false };
    for (const mark of MARKS) {
      const { container, unmount } = render(<SamplePost dealer={off} mark={mark} />);
      const print = container.querySelector("[data-look]") as HTMLElement;
      expect(print.getAttribute("data-look"), mark).toBe("none");
      expect(print.querySelector("svg"), mark).toBeNull();
      expect(headlineMark(container), mark).toBeNull();
      // The logo is not gated on the creative system, so it stays.
      expect(logo(container), mark).not.toBeNull();
      unmount();
    }
    const { container } = render(<SamplePost dealer={off} mark="look" />);
    const saved = screen.getByText(
      "Your Turbo Look is saved. Posts use the classic styles until a system administrator turns on the signature Look for your store.",
    );
    expect(saved.closest("li")?.querySelector('[data-glyph="none"]')).not.toBeNull();
    expect(
      container.querySelector('[data-sample-notes] [data-glyph="line"]'),
    ).toBeNull();
    // A choice print still previews the Look it is asked to draw.
    const { container: choice } = render(
      <SamplePhoto dealer={off} look="turbo" decorative />,
    );
    expect(choice.firstElementChild).toHaveAttribute("data-look", "turbo");
  });

  it("draws the chosen Look, or just the photo when there is none", () => {
    const look = (dealer: Dealer, override?: "showroom" | "hometown" | "turbo") => {
      const { container, unmount } = render(
        <SamplePhoto dealer={dealer} look={override} />,
      );
      const print = container.firstElementChild as HTMLElement;
      const result = {
        look: print.getAttribute("data-look"),
        overlay: Boolean(print.querySelector("svg")),
        text: print.querySelector("svg")?.textContent ?? "",
      };
      unmount();
      return result;
    };
    expect(look(full)).toEqual({
      look: "showroom",
      overlay: true,
      text: "Just delivered",
    });
    expect(look(full, "hometown")).toEqual({
      look: "hometown",
      overlay: true,
      text: "Welcome to the family",
    });
    expect(look(full, "turbo").text).toContain("SOLD");
    expect(look({ id: "d", name: "Plain Motors" })).toEqual({
      look: "none",
      overlay: false,
      text: "",
    });
  });
});
