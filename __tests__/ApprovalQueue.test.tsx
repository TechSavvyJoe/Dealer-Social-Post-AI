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
    currentPerson: { id: "person-1", name: "Joe G." } as any,
    currentDealer: { id: "dealer-1", name: "Northside Motors", requires_approval },
  });

beforeEach(() => {
  vi.clearAllMocks();
  postMocks.listPendingPosts.mockResolvedValue([]);
  postMocks.setApprovalStatus.mockResolvedValue(undefined);
  setDealer(true);
});

describe("ApprovalQueue", () => {
  it("keeps an initial failure unknown until a retry succeeds", async () => {
    postMocks.listPendingPosts.mockRejectedValueOnce(new Error("offline"));
    render(<ApprovalQueue />);
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.queryByText("All caught up")).toBeNull();
    expect(screen.queryByText(/0 posts awaiting/)).toBeNull();
    postMocks.listPendingPosts.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("All caught up")).toBeInTheDocument();
  });

  it("retains loaded posts after a failed refresh and labels them stale", async () => {
    postMocks.listPendingPosts
      .mockResolvedValueOnce([pendingPost])
      .mockRejectedValueOnce(new Error("offline"));
    render(<ApprovalQueue />);
    await screen.findByText("Submitted caption");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(
      await screen.findByText(/Showing previously loaded posts/),
    ).toBeInTheDocument();
    expect(screen.getByText("Submitted caption")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("clears the previous dealer queue and ignores its late response", async () => {
    let finishOld: (items: PostRecord[]) => void = () => undefined;
    postMocks.listPendingPosts.mockImplementationOnce(
      () =>
        new Promise<PostRecord[]>((resolve) => {
          finishOld = resolve;
        }),
    );
    const { rerender } = render(<ApprovalQueue />);
    await waitFor(() => expect(postMocks.listPendingPosts).toHaveBeenCalledTimes(1));
    useAppStore.setState({
      currentDealer: {
        id: "dealer-2",
        name: "Southside Motors",
        requires_approval: true,
      } as any,
    });
    postMocks.listPendingPosts.mockResolvedValueOnce([]);
    rerender(<ApprovalQueue />);
    await screen.findByText("All caught up");
    finishOld([pendingPost]);
    await waitFor(() => expect(screen.queryByText("Submitted caption")).toBeNull());
  });

  it("shows signed-in reviewer identity and plain sentence-case copy", async () => {
    render(<ApprovalQueue />);
    expect(await screen.findByText("All caught up")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: "Waiting for approval" });
    expect(heading.querySelector("svg")).toBeNull();
    expect(screen.queryByText("Pending Approvals")).toBeNull();
    expect(screen.getByText("Reviewing as Joe G.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it("stays hidden for a store without approval and nothing pending", async () => {
    setDealer(false);
    const { container } = render(<ApprovalQueue />);
    await waitFor(() => expect(postMocks.listPendingPosts).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("logs the signed-in approver's name and labels review sections without eyebrows", async () => {
    postMocks.listPendingPosts.mockResolvedValue([pendingPost]);
    render(<ApprovalQueue />);
    const caption = await screen.findByText("Submitted caption");
    expect(caption.className).toContain("text-caption");
    expect(caption.className).not.toMatch(/uppercase|tracking-/);

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
