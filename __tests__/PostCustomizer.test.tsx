import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";
import {
  composeGenerationCreativeBrief,
  PostCustomizer,
} from "../components/PostCustomizer";
import { StyleOption, ToneOption } from "../types";

Object.assign(global.navigator, { vibrate: vi.fn() });

describe("composeGenerationCreativeBrief", () => {
  it("keeps dealer, scenario, vehicle, and OEM grounding ahead of verbose platform copy", () => {
    const brief = composeGenerationCreativeBrief({
      dealershipName: "Bob Maxey Ford of Howell",
      scenarioBlock: "Scenario: New arrival announcement.",
      vehicleBlock:
        "Vehicle facts (do not contradict): 2025 Ford Explorer ST, four-door SUV.",
      oemBlock: "OEM affiliation: Ford. Follow Ford advertising standards.",
      designBlock: "Design DNA: premium high-end campaign composition.",
      supportingBlocks: [
        `Brand voice: ${"warm, factual, polished ".repeat(30)}`,
        `Dealership facts: ${"Howell showroom; ".repeat(30)}`,
      ],
      platformBlock: `Platform guidance: ${"destination-specific detail ".repeat(100)}`,
    });

    expect(brief.length).toBeLessThanOrEqual(1400);
    expect(brief).toContain(
      'Dealership identity (use this exact name): "Bob Maxey Ford of Howell"',
    );
    expect(brief).toContain("Scenario: New arrival announcement");
    expect(brief).toContain("2025 Ford Explorer ST");
    expect(brief).toContain("OEM affiliation: Ford");
  });

  it("keeps every essential block inside the live 900-character caption window", () => {
    const brief = composeGenerationCreativeBrief({
      dealershipName: "D".repeat(140),
      scenarioBlock: `Post scenario: Pre-Owned Spotlight. ${"scenario ".repeat(80)}`,
      vehicleBlock: `Vehicle facts (do not contradict): Vehicle: 2025 Ford Explorer ST. ${"vehicle ".repeat(80)}`,
      oemBlock: `OEM affiliation: Ford. ${"oem guidance ".repeat(40)}`,
      designBlock: `Design DNA: premium environmental campaign. ${"design ".repeat(40)}`,
      supportingBlocks: [`Brand voice: ${"warm and polished ".repeat(80)}`],
      platformBlock: `Platform guidance: ${"destination detail ".repeat(80)}`,
    });
    const liveCaptionWindow = brief.slice(0, 900);

    expect(liveCaptionWindow).toContain("Dealership identity");
    expect(liveCaptionWindow).toContain("Post scenario: Pre-Owned Spotlight");
    expect(liveCaptionWindow).toContain("Vehicle: 2025 Ford Explorer ST");
    expect(liveCaptionWindow).toContain("OEM affiliation: Ford");
    expect(liveCaptionWindow).toContain("Design DNA: premium environmental campaign");
    expect(brief.length).toBeLessThanOrEqual(1400);
  });
});

describe("PostCustomizer", () => {
  const baseProps = {
    imageSrc: "data:image/png;base64,xyz",
    dealershipName: "Test Motors",
    onBack: vi.fn(),
    onGenerate: vi.fn(),
    onStyleToneChange: vi.fn(),
    defaultStyle: StyleOption.Modern,
    defaultTone: ToneOption.Excited,
    isDesktopLayout: true,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "joe_customer_hub",
                  label: "Website",
                  siteUrl: "https://joegallant.me",
                  enabled: true,
                  mode: "private_draft",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("invokes onStyleToneChange when selecting a new style", () => {
    render(<PostCustomizer {...baseProps} />);

    // Find by the simplified label "Sporty" (not the full enum value "Sporty & Dynamic")
    const sportyCard = screen.getByText("Sporty");
    fireEvent.click(sportyCard);

    expect(baseProps.onStyleToneChange).toHaveBeenCalledWith(
      StyleOption.Sporty,
      ToneOption.Excited,
    );
  });

  it("does not send a customer-focused photo to AI before release capture", () => {
    render(<PostCustomizer {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));

    expect(baseProps.onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("needs a signed photo release");
  });

  it("restores the exact platform, media, and primary-format plan for a remix", () => {
    render(
      <PostCustomizer
        {...baseProps}
        initialGenerationParams={{
          style: StyleOption.Modern,
          tone: ToneOption.Excited,
          customerName: "",
          platformIds: ["facebook_feed", "gbp", "linkedin"],
          mediaOutputMode: "both",
          primaryFormatId: "marketplace",
          imageAspectRatio: "16:9",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /^FacebookFeed$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^GoogleFeed$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^IG FeedFeed$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("button", { name: /^BothFull campaign$/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /^Marketplace1200×628$/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Auto$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("button", { name: /More platforms, 1 selected/i }),
    ).toHaveAttribute("aria-expanded", "true");
    const restoredLinkedIn = screen.getByRole("button", { name: /^LinkedIn/i });
    expect(restoredLinkedIn).toHaveAttribute("aria-pressed", "true");
    expect(restoredLinkedIn.querySelector(".lucide-check")).not.toBeNull();
  });

  it("restores safe editor inputs after a failed generation round trip", async () => {
    render(
      <PostCustomizer
        {...baseProps}
        initialGenerationParams={{
          style: StyleOption.Sporty,
          tone: ToneOption.Professional,
          customerName: "Alex",
          customText: "Alex found the perfect SUV.",
          scenarioId: "preowned_spotlight",
          platformIds: ["gbp"],
          mediaOutputMode: "photo",
          primaryFormatId: "gbp",
          imageAspectRatio: "4:3",
        }}
      />,
    );

    expect(screen.getByLabelText("Customer's name (optional)")).toHaveValue("Alex");
    expect(screen.getByText("Sporty").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(ToneOption.Professional).closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Pre-Owned Spotlight/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write My Own" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Your caption")).toHaveValue(
      "Alex found the perfect SUV.",
    );

    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));
    await waitFor(() =>
      expect(baseProps.onGenerate).toHaveBeenCalledWith(
        StyleOption.Sporty,
        ToneOption.Professional,
        "Alex",
        "Alex found the perfect SUV.",
        expect.any(String),
        expect.objectContaining({ scenarioId: "preowned_spotlight" }),
        ["gbp"],
        expect.objectContaining({
          primaryFormatId: "gbp",
          imageAspectRatio: "4:3",
        }),
        "photo",
      ),
    );
  });

  it("quarantines a restored caption that adds a different customer", async () => {
    const onGenerate =
      vi.fn<React.ComponentProps<typeof PostCustomizer>["onGenerate"]>();
    render(
      <PostCustomizer
        {...baseProps}
        onGenerate={onGenerate}
        initialGenerationParams={{
          style: StyleOption.Modern,
          tone: ToneOption.Excited,
          customerName: "Lisa Marie Sample",
          customText:
            "Congratulations to Lisa and Jordan! Lisa and Jordan just found the perfect new ride.",
          scenarioId: "preowned_spotlight",
          platformIds: ["instagram_feed"],
          mediaOutputMode: "photo",
          primaryFormatId: "feed_square",
          imageAspectRatio: "1:1",
        }}
      />,
    );

    expect(screen.getByLabelText("Customer's name (optional)")).toHaveValue("Lisa");
    expect(screen.getByRole("alert")).toHaveTextContent("was quarantined");
    expect(screen.getByRole("button", { name: "AI Caption" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate.mock.calls[0]?.[2]).toBe("Lisa");
    expect(onGenerate.mock.calls[0]?.[3]).toBeUndefined();
  });

  it("keeps grounded no-customer inventory copy editable", async () => {
    const onGenerate =
      vi.fn<React.ComponentProps<typeof PostCustomizer>["onGenerate"]>();
    render(
      <PostCustomizer
        {...baseProps}
        onGenerate={onGenerate}
        initialGenerationParams={{
          style: StyleOption.Modern,
          tone: ToneOption.Excited,
          customerName: "",
          customText:
            "Bronco just arrived at Test Motors, and the team is ready to share the details.",
          scenarioId: "preowned_spotlight",
          platformIds: ["instagram_feed"],
          mediaOutputMode: "photo",
          primaryFormatId: "feed_square",
          imageAspectRatio: "1:1",
        }}
      />,
    );

    expect(screen.getByLabelText("Your caption")).toHaveValue(
      "Bronco just arrived at Test Motors, and the team is ready to share the details.",
    );
    expect(screen.queryByText(/was quarantined/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate.mock.calls[0]?.[5]).toEqual(
      expect.objectContaining({ customerIdentityRequired: false }),
    );
  });

  it("quarantines an unnamed person in restored customer-delivery copy", () => {
    render(
      <PostCustomizer
        {...baseProps}
        initialGenerationParams={{
          style: StyleOption.Modern,
          tone: ToneOption.Excited,
          customerName: "",
          customText:
            "Meet Jordan! A memorable delivery day is underway at Test Motors.",
          scenarioId: "customer_delivery",
          platformIds: ["instagram_feed"],
          mediaOutputMode: "photo",
          primaryFormatId: "feed_square",
          imageAspectRatio: "1:1",
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("was quarantined");
    expect(screen.getByRole("button", { name: "AI Caption" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("rebinds a selected template when the customer changes", async () => {
    const onGenerate =
      vi.fn<React.ComponentProps<typeof PostCustomizer>["onGenerate"]>();
    render(
      <PostCustomizer
        {...baseProps}
        onGenerate={onGenerate}
        initialGenerationParams={{
          style: StyleOption.Friendly,
          tone: ToneOption.Excited,
          customerName: "Alex",
          scenarioId: "preowned_spotlight",
          platformIds: ["instagram_feed"],
          mediaOutputMode: "photo",
          primaryFormatId: "feed_square",
          imageAspectRatio: "1:1",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Advanced options/i }));
    fireEvent.change(screen.getByLabelText("Select template"), {
      target: { value: "t1" },
    });
    expect(
      (screen.getByLabelText("Your caption") as HTMLTextAreaElement).value,
    ).toContain("Alex");

    fireEvent.change(screen.getByLabelText("Customer's name (optional)"), {
      target: { value: "Beth" },
    });
    const reboundCaption = screen.getByLabelText("Your caption") as HTMLTextAreaElement;
    expect(reboundCaption.value).toContain("Beth");
    expect(reboundCaption.value).not.toContain("Alex");

    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate.mock.calls[0]?.[2]).toBe("Beth");
    expect(onGenerate.mock.calls[0]?.[3]).toContain("Beth");
    expect(onGenerate.mock.calls[0]?.[3]).not.toContain("Alex");
  });

  it("keeps clean new-post delivery defaults when no remix seed is supplied", () => {
    render(<PostCustomizer {...baseProps} />);

    expect(
      screen.getByRole("button", { name: /^TikTok9:16 story-ready$/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^GoogleFeed$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("button", { name: /^PhotoExact images$/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Auto$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("lets a salesperson reveal and select a secondary destination", () => {
    render(<PostCustomizer {...baseProps} />);

    const morePlatforms = screen.getByRole("button", {
      name: /More platforms, 0 selected/i,
    });
    expect(morePlatforms).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: /^LinkedIn/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(morePlatforms);
    const linkedIn = screen.getByRole("button", { name: /^LinkedIn/i });
    fireEvent.click(linkedIn);

    expect(linkedIn).toHaveAttribute("aria-pressed", "true");
    expect(linkedIn.querySelector(".lucide-check")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /More platforms, 1 selected/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("offers Website as a distinct private-draft destination", async () => {
    render(<PostCustomizer {...baseProps} />);

    const website = (await screen.findByText("Website")).closest("button");
    expect(website).not.toBeNull();
    expect(website).toBeEnabled();
    expect(website).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Draft only")).toBeInTheDocument();
    expect(screen.getByText(/Private draft for joegallant.me/i)).toBeInTheDocument();

    fireEvent.click(website as HTMLButtonElement);
    expect(website).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /^TikTok9:16 story-ready$/i }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^Feed1080×1080$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Social Feed · 1:1 recommended/i)).toBeVisible();
  });

  it("restores and submits an explicit Website-only destination without TikTok", async () => {
    const onGenerate =
      vi.fn<React.ComponentProps<typeof PostCustomizer>["onGenerate"]>();
    render(
      <PostCustomizer
        {...baseProps}
        onGenerate={onGenerate}
        initialGenerationParams={{
          style: StyleOption.Modern,
          tone: ToneOption.Excited,
          customerName: "",
          scenarioId: "preowned_spotlight",
          platformIds: [],
          websiteEnabled: true,
          mediaOutputMode: "photo",
          primaryFormatId: "feed_square",
          imageAspectRatio: "1:1",
        }}
      />,
    );

    const website = (await screen.findByText("Website")).closest("button");
    expect(website).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /^TikTok9:16 story-ready$/i }),
    ).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate.mock.calls[0]?.[6]).toEqual([]);
    expect(onGenerate.mock.calls[0]?.[5]).toEqual(
      expect.objectContaining({ websiteEnabled: true }),
    );
  });

  it("keeps a legacy Website-only draft Website-only when platform ids are absent", async () => {
    render(
      <PostCustomizer
        {...baseProps}
        initialGenerationParams={{
          style: StyleOption.Modern,
          tone: ToneOption.Excited,
          customerName: "",
          scenarioId: "preowned_spotlight",
          websiteEnabled: true,
          mediaOutputMode: "photo",
          primaryFormatId: "feed_square",
          imageAspectRatio: "1:1",
        }}
      />,
    );

    expect((await screen.findByText("Website")).closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /^TikTok9:16 story-ready$/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  /*
   * Note: The test for a disabled generate button was removed as it is now obsolete.
   * The API key is configured on the server, so the button will never be in this disabled state.
   */
});
