import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalkaroundStudio } from "../components/WalkaroundStudio";
import { decodeVin, type DecodedVehicle } from "../services/vinDecoder";
import * as walkarounds from "../services/walkarounds";

vi.mock("../services/vinDecoder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/vinDecoder")>();
  return { ...actual, decodeVin: vi.fn() };
});

const confirmedVehicle: DecodedVehicle = {
  vin: "1HGCM82633A004352",
  year: "2003",
  make: "Honda",
  model: "Accord",
  trim: "EX",
  bodyClass: "Coupe",
  engineDisplacementL: "3.0",
  summary: "2003 Honda Accord EX Coupe",
  empty: false,
};

describe("WalkaroundStudio", () => {
  afterEach(() => {
    localStorage.removeItem("dealer-social:walkaround-current:v1:dealer-1");
    vi.restoreAllMocks();
  });

  it("shows confirmed VIN facts and clears them when the entered vehicle changes", async () => {
    vi.mocked(decodeVin).mockResolvedValue(confirmedVehicle);
    render(
      <WalkaroundStudio
        dealerId="dealer-1"
        dealerName="Example Ford"
        requiresApproval={false}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan VIN" }));
    fireEvent.click(screen.getByRole("button", { name: "Type VIN" }));
    fireEvent.change(screen.getByLabelText("VIN (17 characters)"), {
      target: { value: confirmedVehicle.vin },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decode VIN" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use this vehicle" }));

    expect(screen.getByLabelText("VIN or stock number (optional)")).toHaveValue(
      confirmedVehicle.vin,
    );
    expect(screen.getByLabelText("Confirmed VIN vehicle")).toHaveTextContent(
      "Confirmed vehicle: 2003 Honda Accord EX Coupe",
    );
    expect(screen.getByText("Make:")).toBeInTheDocument();
    expect(screen.getByText("Honda")).toBeInTheDocument();

    const vinInput = screen.getByLabelText("VIN or stock number (optional)");
    fireEvent.change(vinInput, {
      target: { value: ` ${confirmedVehicle.vin.toLowerCase()} ` },
    });
    expect(screen.getByLabelText("Confirmed VIN vehicle")).toBeInTheDocument();
    fireEvent.change(vinInput, { target: { value: "STOCK-84" } });
    await waitFor(() =>
      expect(screen.queryByLabelText("Confirmed VIN vehicle")).not.toBeInTheDocument(),
    );
  });

  it("shows separate capture choices and locks customer processing behind release proof", () => {
    render(
      <WalkaroundStudio
        dealerId="dealer-1"
        dealerName="Example Ford"
        requiresApproval={true}
        onBack={() => undefined}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Vehicle Walkaround Studio" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "One take" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Multiple clips" })).toBeInTheDocument();

    const identifiable = screen.getByRole("checkbox", {
      name: /Does any identifiable customer or non-employee appear or speak/i,
    });
    expect(identifiable).not.toBeChecked();
    fireEvent.click(identifiable);
    expect(
      screen.getByRole("button", { name: "Capture video and voice release" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "customer" }));
    expect(screen.getByText(/require a saved release/i)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Capture video and voice release" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Customer walkaround release" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/approved cloud and AI services/i)).toBeInTheDocument();
    expect(
      screen.getByText(/unlisted video whose link can be forwarded/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Upload and prepare walkaround" }),
    ).toBeDisabled();
  });

  it("reports unsaved capture choices so app navigation can ask before leaving", async () => {
    const onDirtyChange = vi.fn();
    render(
      <WalkaroundStudio
        dealerId="dealer-1"
        dealerName="Example Ford"
        requiresApproval={false}
        onDirtyChange={onDirtyChange}
        onBack={() => undefined}
      />,
    );

    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    fireEvent.click(screen.getByRole("button", { name: "Multiple clips" }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });

  it("hydrates a saved project without a false dirty state and confirms refresh over edits", async () => {
    const savedProject: walkarounds.WalkaroundProject = {
      id: "project-1",
      audience: "inventory",
      captureMode: "one_take",
      productionState: "review_ready",
      publicationState: "not_requested",
      reviewRevision: 1,
      approvalRequired: false,
      metadata: {
        title: "Saved title",
        description: "Saved description",
        tags: [],
        madeForKids: false,
      },
    };
    localStorage.setItem(
      "dealer-social:walkaround-current:v1:dealer-1",
      savedProject.id,
    );
    const getProject = vi
      .spyOn(walkarounds, "getWalkaroundProject")
      .mockImplementation(async () => ({
        ...savedProject,
        metadata: { ...savedProject.metadata! },
      }));
    const onDirtyChange = vi.fn();
    render(
      <WalkaroundStudio
        dealerId="dealer-1"
        dealerName="Example Ford"
        requiresApproval={false}
        onDirtyChange={onDirtyChange}
        onBack={() => undefined}
      />,
    );

    const title = await screen.findByLabelText("YouTube title");
    expect(title).toHaveValue("Saved title");
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);

    fireEvent.change(title, { target: { value: "Unpublished title edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(
      screen.getByRole("dialog", { name: "Replace these unsaved edits?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(title).toHaveValue("Unpublished title edit");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh saved project" }));
    await waitFor(() => expect(title).toHaveValue("Saved title"));
    expect(getProject).toHaveBeenCalledTimes(2);
  });

  it("states that configuration failures cannot publish or start processing", () => {
    render(
      <WalkaroundStudio
        dealerId="dealer-1"
        dealerName="Example Ford"
        requiresApproval={false}
        onBack={() => undefined}
      />,
    );
    expect(
      screen.getByText(
        /Processing never starts if upload, consent, or backend configuration cannot be verified/i,
      ),
    ).toBeInTheDocument();
  });
});
