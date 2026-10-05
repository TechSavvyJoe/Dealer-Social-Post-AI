import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "../components/ApprovalQueue";
import { useAppStore } from "../stores/appStore";
import type { PostRecord } from "../services/posts";

const postMocks = vi.hoisted(() => ({
  listPendingPosts: vi.fn(),
  setApprovalStatus: vi.fn(),
}));
vi.mock("../services/posts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/posts")>()),
  ...postMocks,
}));

const pendingPost: PostRecord = {
  id: "post-1",
  dealer: "dealer-1",
  salesperson_name: "Taylor Morgan",
  generated_at: new Date().toISOString(),
  style: "Showroom",
  caption: "Congratulations on the new truck!",
  creative_image_url: "/api/app/posts/post-1/creative",
  release_required: false,
};

const setDealer = (requires_approval: boolean) =>
  useAppStore.setState({
    role: "dealer_admin",
    currentDealer: { id: "dealer-1", name: "Northside Motors", requires_approval },
  });

beforeEach(() => {
  vi.clearAllMocks();
  postMocks.listPendingPosts.mockResolvedValue([]);
  postMocks.setApprovalStatus.mockResolvedValue(undefined);
  setDealer(true);
});

describe("ApprovalQueue", () => {
  it("uses plain sentence-case copy for the heading and the approver field", async () => {
    render(<ApprovalQueue />);
    expect(await screen.findByText("All caught up")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: "Waiting for approval" });
    expect(heading.querySelector("svg")).toBeNull();
    expect(screen.queryByText("Pending Approvals")).toBeNull();
    const name = screen.getByLabelText("Your name");
    expect(name).toHaveAccessibleDescription(
      "Saved with each approve or reject decision.",
    );
    expect(screen.queryByText(/Reviewing as/)).toBeNull();
  });

  it("stays hidden for a store without approval and nothing pending", async () => {
    setDealer(false);
    const { container } = render(<ApprovalQueue />);
    await waitFor(() => expect(postMocks.listPendingPosts).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("logs the approver's name with the decision and labels the review sections without eyebrows", async () => {
    postMocks.listPendingPosts.mockResolvedValue([pendingPost]);
    render(<ApprovalQueue />);
    const caption = await screen.findByText("Submitted caption");
    expect(caption.className).toContain("text-caption");
    expect(caption.className).not.toMatch(/uppercase|tracking-/);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/Enter your name first/)).toBeInTheDocument();
    expect(postMocks.setApprovalStatus).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Joe G." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(postMocks.setApprovalStatus).toHaveBeenCalledWith(
        "post-1",
        "approved",
        "Joe G.",
        undefined,
      ),
    );
  });

  it("shows progress only on the decision being sent", async () => {
    let finish: () => void = () => undefined;
    postMocks.setApprovalStatus.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    postMocks.listPendingPosts.mockResolvedValue([pendingPost]);
    render(<ApprovalQueue />);
    await screen.findByText("Submitted caption");
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Joe G." },
    });

    // Approving: Approve spins; Reject is only held still.
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve" })).toHaveAttribute(
        "aria-busy",
        "true",
      ),
    );
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(reject).toBeDisabled();
    expect(reject).not.toHaveAttribute("aria-busy");
    finish();
    await waitFor(() => expect(screen.queryByText("Submitted caption")).toBeNull());
  });

  it("spins only Send rejection while a rejection is sent", async () => {
    let finish: () => void = () => undefined;
    postMocks.setApprovalStatus.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    postMocks.listPendingPosts.mockResolvedValue([pendingPost]);
    render(<ApprovalQueue />);
    await screen.findByText("Submitted caption");
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Joe G." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Caption is off-brand" }));
    fireEvent.click(screen.getByRole("button", { name: "Send rejection" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send rejection" })).toHaveAttribute(
        "aria-busy",
        "true",
      ),
    );
    for (const name of ["Approve", "Reject"]) {
      const other = screen.getByRole("button", { name });
      expect(other).toBeDisabled();
      expect(other).not.toHaveAttribute("aria-busy");
    }
    finish();
    await waitFor(() => expect(screen.queryByText("Submitted caption")).toBeNull());
  });
});
