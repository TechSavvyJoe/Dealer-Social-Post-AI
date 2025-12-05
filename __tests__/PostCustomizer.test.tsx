import { fireEvent, render, screen } from "@testing-library/react";
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
  });

  it("invokes onStyleToneChange when selecting a new style", () => {
    render(<PostCustomizer {...baseProps} />);

    // Find by the simplified label "Sporty" (not the full enum value "Sporty & Dynamic")
    const sportyCard = screen.getByText("Sporty");
    fireEvent.click(sportyCard);

    expect(baseProps.onStyleToneChange).toHaveBeenCalledWith(
      StyleOption.Sporty,
      ToneOption.Excited
    );
  });

  /*
   * Note: The test for a disabled generate button was removed as it is now obsolete.
   * The API key is configured on the server, so the button will never be in this disabled state.
   */
});
