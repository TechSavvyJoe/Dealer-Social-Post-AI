import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DealerSetupWizard } from "../components/DealerSetupWizard";

describe("DealerSetupWizard", () => {
  it("shows real completion and lets a manager jump directly to any setup step", () => {
    render(
      <DealerSetupWizard
        dealer={{
          id: "dealer123456789",
          name: "Northside Motors",
          website: "https://northside.example",
          phone: "517-555-0100",
          address: "Howell, MI",
        }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 of 8 complete/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Voice" }));
    expect(screen.getByLabelText("Brand voice")).toBeInTheDocument();
  });
});
