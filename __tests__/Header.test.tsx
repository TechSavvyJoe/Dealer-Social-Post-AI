import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Header } from "../components/Header";
import type { Dealer } from "../types";
import type { PersonSummary } from "../services/salespeople";

/**
 * JSDOM has no layout, so the phone/desktop split is asserted through the
 * breakpoint classes that implement it (spec §5.5, vis-18).
 */
const dealer = {
  id: "dealer-1",
  name: "Bob Maxey Ford of Howell",
  requires_approval: true,
} as Dealer;
const person: PersonSummary = {
  id: "person-1",
  dealer: "dealer-1",
  name: "Joe Gallant",
  role: "salesperson",
  active: true,
};

const renderHeader = (props: Partial<React.ComponentProps<typeof Header>> = {}) =>
  render(
    <Header
      dealer={dealer}
      person={person}
      onLogout={vi.fn()}
      onShowSettings={vi.fn()}
      onShowHistory={vi.fn()}
      {...props}
    />,
  );

describe("Header", () => {
  it("is 56 px tall and drops its account menu from that edge", () => {
    renderHeader();
    expect(screen.getByRole("banner")).toHaveClass("h-14");
    expect(screen.getByRole("banner")).not.toHaveClass("h-16");
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    expect(screen.getByRole("navigation", { name: "Account menu" })).toHaveClass(
      "top-14",
    );
  });

  it("on a flow screen titles a phone with the step instead of the store", () => {
    const onBack = vi.fn();
    renderHeader({ onBack, flowTitle: "Delivery" });

    const title = screen.getByText("Delivery");
    expect(title).toHaveClass("font-display", "text-[17px]", "md:hidden");
    expect(screen.getByText(dealer.name)).toHaveClass("max-md:hidden");
    expect(screen.getByText("B")).toHaveClass("max-md:hidden");

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("keeps the store identity on Home, where there is no Back", () => {
    renderHeader();
    expect(screen.getByText(dealer.name)).not.toHaveClass("max-md:hidden");
    expect(screen.getByText("B")).not.toHaveClass("max-md:hidden");
    expect(screen.queryByRole("button", { name: "Go back" })).not.toBeInTheDocument();
  });

  it("says approval is on in words a salesperson cannot misread", () => {
    renderHeader();
    expect(screen.getByText("Approval required")).toHaveClass("max-sm:hidden");
    expect(screen.getByText("Approval on")).toHaveClass("sm:hidden");
    expect(screen.queryByText("Review")).not.toBeInTheDocument();
    expect(screen.getByText("Approval on").parentElement).not.toHaveClass(
      "max-sm:hidden",
    );
  });

  it("gives a phone flow screen's title the room the approval badge would take", () => {
    renderHeader({ onBack: vi.fn(), flowTitle: "New arrival" });
    // The badge itself steps aside below sm; sm and up still show it.
    const badge = screen.getByText("Approval on").parentElement;
    expect(badge).toHaveClass("max-sm:hidden");
    expect(badge).toContainElement(screen.getByText("Approval required"));
  });

  it("draws the phone avatar as a 36 px disc inside a 44 px target", () => {
    renderHeader();
    const avatar = screen.getByRole("button", { name: "Open account menu" });
    expect(avatar).toHaveClass("min-h-[44px]", "min-w-[44px]");
    expect(avatar).not.toHaveClass("bg-brand-fill");
    expect(screen.getByText("JG")).toHaveClass("h-9", "w-9", "bg-brand-fill");
  });

  it("locks every exit while a post is being created", () => {
    renderHeader({ onBack: vi.fn(), flowTitle: "Delivery", navigationDisabled: true });
    expect(screen.getByRole("button", { name: "Go back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open my work" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Log out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeDisabled();
  });
});
