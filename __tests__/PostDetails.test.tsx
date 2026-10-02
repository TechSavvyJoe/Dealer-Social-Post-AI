import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostDetails } from "../components/PostDetails";
import { useAppStore } from "../stores/appStore";

vi.mock("../services/websitePublishing", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../services/websitePublishing")>();
  return { ...original, listWebsiteDestinations: vi.fn().mockResolvedValue([]) };
});

describe("PostDetails", () => {
  beforeEach(() => {
    useAppStore.setState({
      currentDealer: { id: "dealer123456789", name: "Bob Maxey Ford" },
      currentPerson: null,
      postDraft: { categoryId: "deliveries", scenarioId: "customer_delivery" },
      pendingRelease: null,
    });
  });

  it("fails closed on a delivery until the customer has signed", () => {
    render(
      <PostDetails
        imageSrc="data:image/jpeg;base64,photo"
        onGenerate={vi.fn()}
        onBack={vi.fn()}
        onChangePhoto={vi.fn()}
      />,
    );
    const create = screen.getByRole("button", { name: "Create post" });
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).toHaveAttribute("aria-describedby", "create-post-reason");
    expect(
      screen.getByText("Needs the customer's signature first"),
    ).toBeInTheDocument();
  });

  it("hides the signature row for a non-customer category", () => {
    useAppStore.setState({
      postDraft: { categoryId: "service", scenarioId: "service_promotion" },
    });
    render(
      <PostDetails
        imageSrc="data:image/jpeg;base64,photo"
        onGenerate={vi.fn()}
        onBack={vi.fn()}
        onChangePhoto={vi.fn()}
      />,
    );
    expect(screen.queryByText("Customer's signature")).not.toBeInTheDocument();
  });

  it("passes the exact pending release object into generation", async () => {
    const pendingRelease = {
      customerName: "Maria Lopez",
      signaturePngDataUrl: "data:image/png;base64,signed",
      linked: false,
    };
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ pendingRelease });
    render(
      <PostDetails
        imageSrc="data:image/jpeg;base64,photo"
        onGenerate={onGenerate}
        onBack={vi.fn()}
        onChangePhoto={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create post" }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate.mock.calls[0][5].capturedRelease).toBe(pendingRelease);
  });

  it("rejects a release already linked to another post", () => {
    useAppStore.setState({
      pendingRelease: {
        customerName: "Maria Lopez",
        signaturePngDataUrl: "data:image/png;base64,signed",
        releaseId: "release-1",
        linked: true,
      },
    });
    render(
      <PostDetails
        imageSrc="data:image/jpeg;base64,photo"
        onGenerate={vi.fn()}
        onBack={vi.fn()}
        onChangePhoto={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Create post" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByText("Needs the customer's signature first"),
    ).toBeInTheDocument();
  });
});
