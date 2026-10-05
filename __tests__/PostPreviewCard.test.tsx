import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  PostPreviewCard,
  outboundPreviewParts,
  type PostPreviewCardProps,
} from "../components/post/PostPreviewCard";
import { fitPublishCaptionToBudget } from "../services/publishTargets";

const PREFIX = "Posted by a Bob Maxey Ford of Howell team member.";
const BODY =
  "Congratulations to Maria on her new Bronco! Ask about 0.9% APR financing.";
const DISCLOSURES =
  "— Disclosures —\nFinancing subject to credit approval through dealer-participating lenders.";

const baseProps: PostPreviewCardProps = {
  salespersonName: "Joe Gallant",
  dealerName: "Bob Maxey Ford of Howell",
  image: "data:image/jpeg;base64,aW1hZ2U=",
  caption: BODY,
  outboundText: BODY,
  employeeDisclosure: PREFIX,
  disclosures: DISCLOSURES,
  editing: false,
  canEdit: true,
  onEdit: vi.fn(),
  onCaptionChange: vi.fn(),
  onCaptionBlur: vi.fn(),
};

const renderCard = (overrides: Partial<PostPreviewCardProps> = {}) =>
  render(<PostPreviewCard {...baseProps} {...overrides} />);

const outboundNodes = () =>
  Array.from(
    screen
      .getByTestId("post-outbound-preview")
      .querySelectorAll<HTMLElement>("[data-outbound-part]"),
  );

const previewText = () =>
  outboundNodes()
    .map((node) => node.textContent)
    .join("\n\n");

describe("PostPreviewCard", () => {
  it("puts the team-member disclosure first, then the caption, then the disclosures", () => {
    renderCard();
    const nodes = outboundNodes();
    expect(nodes.map((node) => node.dataset.outboundPart)).toEqual([
      "prefix",
      "body",
      "disclosures",
    ]);
    expect(nodes[0]).toHaveTextContent(PREFIX);
    expect(nodes[1]).toHaveTextContent(BODY);
    expect(nodes[2].textContent).toBe(DISCLOSURES);
    // DOM order, not just data order: the prefix precedes the body precedes the footer.
    expect(
      nodes[0].compareDocumentPosition(nodes[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      nodes[1].compareDocumentPosition(nodes[2]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    ["a plain caption", BODY, DISCLOSURES],
    ["a caption with the dealership mention", `${BODY}\n\n@bobmaxeyford`, DISCLOSURES],
    ["an unheaded disclosure", BODY, "Financing subject to credit approval."],
    ["no disclosures", BODY, undefined],
    [
      "a caption that already opens with the disclosure",
      `${PREFIX}\n\n${BODY}`,
      undefined,
    ],
  ])("reads exactly like the delivered caption for %s", (_label, text, disclosures) => {
    renderCard({ outboundText: text, disclosures });
    expect(previewText()).toBe(
      fitPublishCaptionToBudget({ text, disclosures, requiredPrefix: PREFIX }, 100_000),
    );
  });

  it("does not show the disclosure twice when the caption already starts with it", () => {
    renderCard({ outboundText: `${PREFIX}\n\n${BODY}` });
    expect(outboundNodes().map((node) => node.dataset.outboundPart)).toEqual([
      "body",
      "disclosures",
    ]);
  });

  it("keeps the wording of every disclosure line unchanged", () => {
    const parts = outboundPreviewParts(BODY, `  ${PREFIX}  `, DISCLOSURES);
    expect(parts).toEqual({ prefix: PREFIX, body: BODY, disclosureBlock: DISCLOSURES });
    expect(outboundPreviewParts(BODY, PREFIX, "Line one.").disclosureBlock).toBe(
      "— Disclosures —\nLine one.",
    );
  });

  it("edits only the body and keeps the disclosure lines outside the field", async () => {
    const user = userEvent.setup();
    const onCaptionChange = vi.fn();
    renderCard({ editing: true, onCaptionChange });
    const field = screen.getByRole("textbox", { name: "Caption" });
    expect(field).toHaveValue(BODY);
    expect(field).toHaveFocus();
    expect(screen.getByText(PREFIX)).toBeInTheDocument();
    expect((field as HTMLTextAreaElement).value).not.toContain(PREFIX);
    expect(
      screen.getByText(PREFIX).compareDocumentPosition(field) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.type(field, "!");
    expect(onCaptionChange).toHaveBeenLastCalledWith(`${BODY}!`);
    expect(screen.queryByTestId("post-outbound-preview")).toBeNull();
  });

  it("offers Edit caption only when the caption can be edited", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { rerender } = renderCard({ onEdit });
    await user.click(screen.getByRole("button", { name: "Edit caption" }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    rerender(<PostPreviewCard {...baseProps} canEdit={false} editing />);
    expect(screen.queryByRole("button", { name: "Edit caption" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Caption" })).toBeNull();
    expect(screen.getByTestId("post-outbound-preview")).toBeInTheDocument();
  });
});
