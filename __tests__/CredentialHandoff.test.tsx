import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DealerTeamCard } from "../components/DealerAdminDashboard";
import { PersonEditModal } from "../components/PersonEditModal";
import type { CredentialResult, Person } from "../services/salespeople";
import { useAppStore } from "../stores/appStore";

const serviceMocks = vi.hoisted(() => ({
  acknowledgePinDistribution: vi.fn(),
  addSalesperson: vi.fn(),
  listSalespeople: vi.fn(),
  revealPersonPin: vi.fn(),
  rotatePersonPin: vi.fn(),
  updatePerson: vi.fn(),
  updateSalesperson: vi.fn(),
}));

vi.mock("../services/salespeople", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/salespeople")>()),
  ...serviceMocks,
}));

const person: Person = {
  id: "person-1",
  dealer: "dealer-1",
  name: "Taylor Morgan",
  role: "salesperson",
  active: true,
  hasPin: true,
  pinNeedsDistribution: false,
  hasManagerLogin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  serviceMocks.listSalespeople.mockResolvedValue([]);
  serviceMocks.updatePerson.mockResolvedValue(person);
  serviceMocks.updateSalesperson.mockResolvedValue(person);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }),
  );
  useAppStore.setState({
    currentDealer: {
      id: "dealer-1",
      name: "Northside Motors",
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("secure credential handoff", () => {
  it("associates the editable role label with its select control", () => {
    render(
      <PersonEditModal
        isOpen
        person={person}
        allowRoleEdit
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Role")).toHaveValue("salesperson");
  });

  it("notifies the parent on rotation and keeps the one-time code after the modal closes", async () => {
    const rotated: CredentialResult = {
      person: { ...person, pinNeedsDistribution: true },
      pin: "4826",
    };
    serviceMocks.rotatePersonPin.mockResolvedValue(rotated);
    const onCommitted = vi.fn();

    const Harness = () => {
      const [open, setOpen] = useState(true);
      const [credential, setCredential] = useState<CredentialResult | null>(null);
      return (
        <>
          <PersonEditModal
            isOpen={open}
            person={person}
            onClose={() => setOpen(false)}
            onSaved={vi.fn()}
            onCommitted={onCommitted}
            onCredentialIssued={setCredential}
          />
          {credential ? (
            <output aria-label="Preserved one-time code">{credential.pin}</output>
          ) : null}
        </>
      );
    };

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Generate new code" }));
    expect(serviceMocks.rotatePersonPin).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "current code stops working and all active sessions end immediately",
    );
    fireEvent.click(screen.getByRole("button", { name: "Replace code" }));

    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith(rotated.person));
    expect(screen.getByLabelText("Preserved one-time code")).toHaveTextContent("4826");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Account settings" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Preserved one-time code")).toHaveTextContent("4826");
  });

  it("notifies the parent immediately after distribution is acknowledged", async () => {
    const rotated: CredentialResult = {
      person: { ...person, pinNeedsDistribution: true },
      pin: "4826",
    };
    const acknowledged = { ...person, pinNeedsDistribution: false };
    serviceMocks.rotatePersonPin.mockResolvedValue(rotated);
    serviceMocks.acknowledgePinDistribution.mockResolvedValue(acknowledged);
    const onCommitted = vi.fn();

    render(
      <PersonEditModal
        isOpen
        person={person}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onCommitted={onCommitted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate new code" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace code" }));
    await screen.findByText("4826");
    fireEvent.click(screen.getByRole("button", { name: "Mark code as shared" }));

    await waitFor(() => expect(onCommitted).toHaveBeenLastCalledWith(acknowledged));
    expect(screen.queryByText("4826")).not.toBeInTheDocument();
  });

  it("gives managers Copy and Mark as shared controls and reflects roster handoff state", async () => {
    const migrated = { ...person, pinNeedsDistribution: true };
    const created: CredentialResult = {
      person: {
        ...person,
        id: "person-2",
        name: "Jamie Lee",
        pinNeedsDistribution: true,
      },
      pin: "7319",
    };
    serviceMocks.listSalespeople.mockResolvedValue([migrated]);
    serviceMocks.addSalesperson.mockResolvedValue(created);
    serviceMocks.acknowledgePinDistribution.mockResolvedValue({
      ...created.person,
      pinNeedsDistribution: false,
    });

    render(<DealerTeamCard />);
    expect(await screen.findByText("Code to share")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("e.g. Sarah Chen"), {
      target: { value: "Jamie Lee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("Jamie Lee's access code is ready"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("7319"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark as shared" }));
    await waitFor(() =>
      expect(serviceMocks.acknowledgePinDistribution).toHaveBeenCalledWith("person-2"),
    );
    expect(
      screen.queryByText("Jamie Lee's access code is ready"),
    ).not.toBeInTheDocument();
  });
});
