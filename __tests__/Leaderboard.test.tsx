import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Leaderboard } from "../components/Leaderboard";
import { useAppStore } from "../stores/appStore";
import type { LeaderboardEntry } from "../services/posts";

const postMocks = vi.hoisted(() => ({ getLeaderboard: vi.fn() }));
vi.mock("../services/posts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/posts")>()),
  ...postMocks,
}));

const entries: LeaderboardEntry[] = [
  {
    salesperson: "Taylor Morgan",
    count: 2,
    videoCount: 1,
    releaseCount: 1,
    lastPostedAt: "2026-10-01T15:00:00.000Z",
  },
  {
    salesperson: "Jamie Lee",
    count: 1,
    videoCount: 0,
    releaseCount: 0,
    lastPostedAt: "2026-10-02T15:00:00.000Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  postMocks.getLeaderboard.mockResolvedValue(entries);
  useAppStore.setState({
    role: "dealer_admin",
    currentDealer: { id: "dealer-1", name: "Northside Motors" },
  });
});

describe("Leaderboard", () => {
  it("names the active range in the summary instead of 'in window'", async () => {
    render(<Leaderboard />);
    expect(await screen.findByText("3 posts this week")).toBeInTheDocument();
    expect(screen.queryByText(/in window/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    expect(await screen.findByText("3 posts in the last 30 days")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(await screen.findByText("3 posts all time")).toBeInTheDocument();
  });

  it("ranks every row with the same neutral numeral tile and no medal colours", async () => {
    render(<Leaderboard />);
    const list = await screen.findByRole("list", { name: "Salespeople by posts" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    rows.forEach((row, index) => {
      const tile = row.firstElementChild as HTMLElement;
      expect(tile).toHaveTextContent(String(index + 1));
      expect(tile.className).toContain("bg-panel-raised");
      expect(tile.className).toContain("tabular-nums");
    });
    const markup = list.outerHTML;
    expect(markup).not.toMatch(/amber|orange|uppercase|tracking-/);
    // The heading carries no trophy icon or brand bar.
    const heading = screen.getByRole("heading", { name: "Salesperson leaderboard" });
    expect(heading.querySelector("svg")).toBeNull();
    expect(within(rows[0]).getByText("posts").className).toContain("text-caption");
  });

  it("says which range is empty", async () => {
    postMocks.getLeaderboard.mockResolvedValue([]);
    render(<Leaderboard />);
    expect(await screen.findByText("No posts this week")).toBeInTheDocument();
  });
});
