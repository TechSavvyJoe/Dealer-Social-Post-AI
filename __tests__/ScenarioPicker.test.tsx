import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioPicker } from "../components/ScenarioPicker";
import { useAppStore } from "../stores/appStore";

beforeEach(() => {
  useAppStore.setState({ currentDealer: null });
});

describe("ScenarioPicker keyboard behavior", () => {
  it("opens from the keyboard and supports roving option focus", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ScenarioPicker onChange={onChange} />);

    const trigger = screen.getByRole("button", {
      name: "Post type Customer Delivery",
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const customerDelivery = await screen.findByRole("option", {
      name: /Customer Delivery/,
    });
    await waitFor(() => expect(customerDelivery).toHaveFocus());

    fireEvent.keyDown(customerDelivery, { key: "ArrowDown" });
    const preOwned = screen.getByRole("option", { name: /Pre-Owned Spotlight/ });
    await waitFor(() => expect(preOwned).toHaveFocus());

    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "preowned_spotlight" }),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes with Escape and restores focus to its trigger", async () => {
    render(<ScenarioPicker onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", {
      name: "Post type Customer Delivery",
    });

    fireEvent.click(trigger);
    const customerDelivery = await screen.findByRole("option", {
      name: /Customer Delivery/,
    });
    await waitFor(() => expect(customerDelivery).toHaveFocus());
    fireEvent.keyDown(customerDelivery, { key: "Escape" });

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
