import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WalkaroundStudio } from "../components/WalkaroundStudio";

describe("WalkaroundStudio", () => {
  it("shows separate capture choices and locks customer processing behind release proof", () => {
    render(
      <WalkaroundStudio
        dealerId="dealer-1"
        dealerName="Example Ford"
        requiresApproval={true}
        onBack={() => undefined}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Vehicle Walkaround Studio" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "One take" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Multiple clips" })).toBeInTheDocument();

    const identifiable = screen.getByRole("checkbox", {
      name: /Does any identifiable customer or non-employee appear or speak/i,
    });
    expect(identifiable).not.toBeChecked();
    fireEvent.click(identifiable);
    expect(
      screen.getByRole("button", { name: "Capture video and voice release" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "customer" }));
    expect(screen.getByText(/require a saved release/i)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Capture video and voice release" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Customer walkaround release" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/approved cloud and AI services/i)).toBeInTheDocument();
    expect(
      screen.getByText(/unlisted video whose link can be forwarded/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Upload and prepare walkaround" }),
    ).toBeDisabled();
  });

  it("states that configuration failures cannot publish or start processing", () => {
    render(
      <WalkaroundStudio
        dealerId="dealer-1"
        dealerName="Example Ford"
        requiresApproval={false}
        onBack={() => undefined}
      />,
    );
    expect(
      screen.getByText(
        /Processing never starts if upload, consent, or backend configuration cannot be verified/i,
      ),
    ).toBeInTheDocument();
  });
});
