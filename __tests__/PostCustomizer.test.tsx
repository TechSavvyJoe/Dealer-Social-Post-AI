import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";
import { PostCustomizer } from "../components/PostCustomizer";
import { StyleOption, ToneOption } from "../types";

Object.assign(global.navigator, { vibrate: vi.fn() });

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
