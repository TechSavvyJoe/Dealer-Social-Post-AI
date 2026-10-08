import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PrivateInvitationEntry } from "../components/PrivateInvitationEntry";
import { dealershipInvitationToken } from "../utils/dealershipInvitationLink";

const token = "a".repeat(64);
const origin = "https://dealer-social-post-ai.vercel.app";

describe("invitation link destinations", () => {
  it("accepts this app's absolute or relative invitation without navigation", () => {
    expect(dealershipInvitationToken(`  ${origin}/join#${token}  `, origin)).toBe(
      token,
    );
    expect(dealershipInvitationToken(`/join#${token}`, origin)).toBe(token);
  });
  it.each([
    `https://other.example/join#${token}`,
    `https://dealer-social-post-ai.vercel.app@other.example/join#${token}`,
    `${origin}/other#${token}`,
    `${origin}/join?token=${token}`,
    `${origin}/join?tracking=private#${token}`,
    `${origin}/join#${token}extra`,
    `${origin}/join#${token.toUpperCase()}`,
    `javascript:alert(1)#${token}`,
    "invalid",
  ])("rejects foreign, malformed and query-bearing links", (value) => {
    expect(dealershipInvitationToken(value, origin)).toBeNull();
  });
});

describe("invitation entry inside an installed app", () => {
  it("opens only the validated token and clears the private input", () => {
    const onOpen = vi.fn();
    render(<PrivateInvitationEntry configured={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Use a private invitation" }));
    const field = screen.getByLabelText("Private invitation link");
    expect(screen.getByRole("button", { name: "Open invitation" })).toBeDisabled();
    fireEvent.change(field, { target: { value: `${location.origin}/join#${token}` } });
    fireEvent.click(screen.getByRole("button", { name: "Open invitation" }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(token);
    expect(field).toHaveValue("");
  });
  it("keeps a foreign link on the current screen and offers a correction", () => {
    const onOpen = vi.fn();
    render(<PrivateInvitationEntry configured={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Use a private invitation" }));
    fireEvent.change(screen.getByLabelText("Private invitation link"), {
      target: { value: `https://other.example/join#${token}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open invitation" }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Private invitation link")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.getByText(/Enter this app’s private dealership invitation/),
    ).toBeVisible();
  });
  it("allows changing a configured device and discards a closed draft", () => {
    render(<PrivateInvitationEntry configured />);
    const change = screen.getByRole("button", { name: "Change dealership" });
    fireEvent.click(change);
    fireEvent.change(screen.getByLabelText("Private invitation link"), {
      target: { value: `${location.origin}/join#${token}` },
    });
    fireEvent.click(change);
    expect(screen.queryByLabelText("Private invitation link")).toBeNull();
    fireEvent.click(change);
    expect(screen.getByLabelText("Private invitation link")).toHaveValue("");
  });
});
