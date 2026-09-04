import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";
import {
  composeGenerationCreativeBrief,
  PostCustomizer,
} from "../components/PostCustomizer";
import { useAppStore } from "../stores/appStore";
import { StyleOption, ToneOption, type Dealer } from "../types";

Object.assign(global.navigator, { vibrate: vi.fn() });

describe("composeGenerationCreativeBrief", () => {
  it("keeps the dealer brand voice inside the 900-character caption window", () => {
    const voice = `Brand voice (match this exactly): ${"warm, factual, polished, never salesy ".repeat(5)}`;
    const brief = composeGenerationCreativeBrief({
      dealershipName: "Bob Maxey Ford of Howell",
      scenarioBlock: `Post scenario: ${"custom scenario prose ".repeat(20)}`,
      vehicleBlock: `Vehicle facts (do not contradict): ${"2026 Ford F-150 Lariat ".repeat(12)}`,
      oemBlock: `OEM affiliation: Ford. ${"Respect brand tone. ".repeat(6)}`,
      designBlock: "Design DNA: editorial spotlight",
      voiceBlock: voice,
      supportingBlocks: ["Required footer: Visit us today."],
      platformBlock: "Target platforms: Instagram Feed.",
    });
    const window = brief.slice(0, 900);
    expect(window).toContain("Brand voice (match this exactly)");
    expect(brief.indexOf("Brand voice")).toBeLessThan(brief.indexOf("Post scenario"));
  });

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
    useAppStore.setState({ currentDealer: null });
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
    useAppStore.setState({ currentDealer: null });
  });

  it("announces each customizer section as a named group", () => {
    render(<PostCustomizer {...baseProps} />);

    // These headings used to be bare <label> elements with no control
    // association, so assistive tech announced the controls with no section
    // context at all.
    for (const name of [
      "Vehicle",
      "Design Style",
      "Share to",
      "Tone",
      "Caption",
    ] as const) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("group", { name: /^Photo release/ })).toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// Brand-consistent creative system (spec 2026-09-02 §4, §8)
// ---------------------------------------------------------------------------

const LEGACY_DEALER = {
  id: "dealer-legacy",
  name: "Test Motors",
} as Dealer;

/** Hometown Look = Fun & Friendly image treatment + Family caption voice. */
const CREATIVE_DEALER = {
  id: "dealer-brand",
  name: "Test Motors",
  creative_system_v2: true,
  signature_look: "hometown",
  playful_style: "pixar",
} as Dealer;

describe("PostCustomizer creative system", () => {
  const baseProps = {
    imageSrc: "data:image/png;base64,xyz",
    dealershipName: "Test Motors",
    onBack: vi.fn(),
    onGenerate: vi.fn(),
    onStyleToneChange: vi.fn(),
    // Deliberately conflicting per-device memory: an enabled dealership must
    // ignore it and use the Look instead.
    defaultStyle: StyleOption.DepthPop,
    defaultTone: ToneOption.Humorous,
    isDesktopLayout: true,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    useAppStore.setState({ currentDealer: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useAppStore.setState({ currentDealer: null });
  });

  const renderCustomizer = (
    dealer: Dealer | null,
    overrides: Partial<React.ComponentProps<typeof PostCustomizer>> = {},
  ) => {
    useAppStore.setState({ currentDealer: dealer });
    const onGenerate =
      vi.fn<React.ComponentProps<typeof PostCustomizer>["onGenerate"]>();
    render(<PostCustomizer {...baseProps} onGenerate={onGenerate} {...overrides} />);
    return onGenerate;
  };

  it("leaves a dealership without the flag on today's exact control set", async () => {
    const onGenerate = renderCustomizer(LEGACY_DEALER, {
      initialGenerationParams: {
        style: StyleOption.Sporty,
        tone: ToneOption.Professional,
        customerName: "",
        scenarioId: "preowned_spotlight",
        platformIds: ["gbp"],
        mediaOutputMode: "photo",
        primaryFormatId: "gbp",
        imageAspectRatio: "4:3",
      },
    });

    // Every control group the creative system hides is still here.
    for (const name of ["Design Style", "Share to", "Tone", "Caption"] as const) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: "Post type Pre-Owned Spotlight" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^PhotoExact images$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Auto$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Advanced options/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Add a personal line/i)).not.toBeInTheDocument();

    // ...and the saved generation params are byte-for-byte today's values.
    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate).toHaveBeenCalledWith(
      StyleOption.Sporty,
      ToneOption.Professional,
      "",
      undefined,
      expect.any(String),
      expect.objectContaining({ scenarioId: "preowned_spotlight" }),
      ["gbp"],
      expect.objectContaining({
        primaryFormatId: "gbp",
        imageAspectRatio: "4:3",
      }),
      "photo",
    );
  });

  it("drops the customize screen to category, who/what, and one optional toggle", () => {
    renderCustomizer(CREATIVE_DEALER);

    for (const name of ["Design Style", "Tone", "Caption"] as const) {
      expect(screen.queryByRole("group", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("group", { name: "Share to" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^PhotoExact images$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^BothFull campaign$/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Auto$/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Marketplace1200×628$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /More platforms/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Advanced options/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Write My Own" }),
    ).not.toBeInTheDocument();

    // What is left: the six categories, who/what, and the optional toggles.
    for (const category of [
      "Delivery",
      "Inventory",
      "Service",
      "Promotions",
      "Community",
      "Team",
    ] as const) {
      expect(screen.getByRole("button", { name: category })).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/Customer's name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Add a personal line/i)).toBeInTheDocument();

    // Compliance controls are untouched.
    expect(screen.getByRole("group", { name: /^Photo release/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Vehicle" })).toBeInTheDocument();
  });

  it("generates with the Look style and tone and the category destinations", async () => {
    const onGenerate = renderCustomizer(CREATIVE_DEALER);

    // Inventory needs no photo release, so this exercises the whole happy path.
    fireEvent.click(screen.getByRole("button", { name: "Inventory" }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    const call = onGenerate.mock.calls[0];
    // Hometown Look — not the DepthPop/Humorous per-device memory.
    expect(call?.[0]).toBe(StyleOption.Friendly);
    expect(call?.[1]).toBe(ToneOption.Family);
    // CATEGORY_OUTPUTS.inventory, not the legacy "Share to" defaults.
    expect(call?.[6]).toEqual(["instagram_feed", "facebook_feed", "marketplace"]);
    expect(call?.[7]).toEqual(
      expect.objectContaining({
        primaryFormatId: "feed_portrait",
        imageAspectRatio: "4:5",
      }),
    );
    expect(call?.[8]).toBe("photo");
  });

  it("keeps a scenario's style and tone defaults away from the Look", async () => {
    const onGenerate = renderCustomizer(CREATIVE_DEALER);

    // Pre-Owned Spotlight declares Modern + Promotional.
    fireEvent.click(screen.getByRole("button", { name: "Inventory" }));
    expect(
      screen.getByRole("button", { name: /Pre-Owned Spotlight/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate.mock.calls[0]?.[0]).not.toBe(StyleOption.Modern);
    expect(onGenerate.mock.calls[0]?.[1]).not.toBe(ToneOption.Promotional);
    expect(onGenerate.mock.calls[0]?.[0]).toBe(StyleOption.Friendly);
    expect(onGenerate.mock.calls[0]?.[1]).toBe(ToneOption.Family);
  });

  it("still applies a scenario's style and tone defaults while the flag is off", () => {
    renderCustomizer(LEGACY_DEALER);

    fireEvent.click(
      screen.getByRole("button", { name: "Post type Customer Delivery" }),
    );
    fireEvent.click(screen.getByRole("option", { name: /Pre-Owned Spotlight/ }));

    expect(screen.getByText("Modern").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(ToneOption.Promotional).closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("offers Add video and Playful when the dealership allows them", () => {
    renderCustomizer(CREATIVE_DEALER);
    expect(screen.getByRole("button", { name: /^Add video/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Make it playful/ }),
    ).toBeInTheDocument();
  });

  it("hides Add video and Playful when the dealership revokes them", () => {
    renderCustomizer({
      ...CREATIVE_DEALER,
      feature_permissions: {
        video: { team: false, people: {} },
        playful: { team: false, people: {} },
      },
    } as Dealer);

    expect(
      screen.queryByRole("button", { name: /^Add video/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Make it playful/ }),
    ).not.toBeInTheDocument();
  });

  it("hides Add video for a category that cannot carry motion", () => {
    renderCustomizer(CREATIVE_DEALER);

    // Service is photo-only in CATEGORY_OUTPUTS.
    fireEvent.click(screen.getByRole("button", { name: "Service" }));
    expect(
      screen.queryByRole("button", { name: /^Add video/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Make it playful/ }),
    ).toBeInTheDocument();
  });

  it("turns Add video into the video half of the media plan", async () => {
    const onGenerate = renderCustomizer(CREATIVE_DEALER);

    fireEvent.click(screen.getByRole("button", { name: "Inventory" }));
    fireEvent.click(screen.getByRole("button", { name: /^Add video/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate.mock.calls[0]?.[8]).toBe("both");
  });

  it("appends a personal line to the caption instead of replacing it", async () => {
    const onGenerate = renderCustomizer(CREATIVE_DEALER);

    fireEvent.click(screen.getByRole("button", { name: "Inventory" }));
    fireEvent.change(screen.getByLabelText(/Add a personal line/i), {
      target: { value: "Stop by and say hi on the lot." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    // customText replaces the caption; the personal line must never use it.
    expect(onGenerate.mock.calls[0]?.[3]).toBeUndefined();
    expect(onGenerate.mock.calls[0]?.[4]).toContain(
      'Personal line (append verbatim after the caption body): "Stop by and say hi on the lot."',
    );
  });

  it("caps the personal line at 140 characters", () => {
    renderCustomizer(CREATIVE_DEALER);

    const input = screen.getByLabelText(/Add a personal line/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(200) } });
    expect(input.value).toHaveLength(140);
  });

  it("holds the personal line to the same customer-identity lock", async () => {
    const onGenerate = renderCustomizer(CREATIVE_DEALER);

    fireEvent.click(screen.getByRole("button", { name: "Inventory" }));
    fireEvent.change(screen.getByLabelText(/Customer's name/i), {
      target: { value: "Alex" },
    });
    fireEvent.change(screen.getByLabelText(/Add a personal line/i), {
      target: { value: "Congrats Jordan on the new truck!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate Post/i }));

    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("personal line");
  });
});
