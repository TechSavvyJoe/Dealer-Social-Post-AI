import React, { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonEditModal } from "../components/PersonEditModal";
import type { Person } from "../services/salespeople";

const serviceMocks = vi.hoisted(() => ({
  configureManagerLogin: vi.fn(),
  disableManagerLogin: vi.fn(),
}));

vi.mock("../services/salespeople", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/salespeople")>()),
  ...serviceMocks,
}));

const manager: Person = {
  id: "manager-1",
  dealer: "dealer-1",
  name: "Jordan Lee",
  role: "manager",
  active: true,
  hasPin: true,
  pinNeedsDistribution: false,
  hasManagerLogin: true,
  managerUsername: "jordan.lee",
};

const salesperson: Person = {
  ...manager,
  id: "salesperson-1",
  name: "Taylor Morgan",
  role: "salesperson",
  hasManagerLogin: false,
  managerUsername: undefined,
};

interface HarnessProps {
  initialPerson?: Person;
  allowManagerLoginEdit?: boolean;
  allowRoleEdit?: boolean;
  onCommitted?: (person: Person) => void;
  onClose?: () => void;
}

const Harness: React.FC<HarnessProps> = ({
  initialPerson = manager,
  allowManagerLoginEdit = true,
  allowRoleEdit = false,
  onCommitted,
  onClose = vi.fn(),
}) => {
  const [person, setPerson] = useState(initialPerson);
  return (
    <PersonEditModal
      isOpen
      person={person}
      storeName="Northside Motors"
      allowManagerLoginEdit={allowManagerLoginEdit}
      allowRoleEdit={allowRoleEdit}
      onClose={onClose}
      onSaved={setPerson}
      onCommitted={(updated) => {
        setPerson(updated);
        onCommitted?.(updated);
      }}
    />
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  serviceMocks.configureManagerLogin.mockResolvedValue(manager);
  serviceMocks.disableManagerLogin.mockResolvedValue({
    ...manager,
    hasManagerLogin: false,
    managerUsername: undefined,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("super-admin manager username and password controls", () => {
  it("updates the displayed username, preserves the exact password payload, and clears the write-only fields", async () => {
    const exactPassword = "  Exact Manager Passphrase 42!  ";
    const updated = {
      ...manager,
      managerUsername: "new.manager",
      hasManagerLogin: true,
    };
    serviceMocks.configureManagerLogin.mockResolvedValue(updated);
    const onCommitted = vi.fn();

    render(<Harness onCommitted={onCommitted} />);

    const username = screen.getByLabelText("Manager username");
    const password = screen.getByLabelText("New password");
    const confirmation = screen.getByLabelText("Confirm password");
    expect(username).toHaveValue("jordan.lee");
    expect(password).toHaveValue("");
    expect(confirmation).toHaveValue("");
    expect(screen.queryByRole("button", { name: /copy.*password/i })).toBeNull();

    fireEvent.change(username, { target: { value: "  New.Manager  " } });
    fireEvent.change(password, { target: { value: exactPassword } });
    fireEvent.change(confirmation, { target: { value: exactPassword } });
    fireEvent.click(screen.getByRole("button", { name: "Replace manager login" }));

    await waitFor(() =>
      expect(serviceMocks.configureManagerLogin).toHaveBeenCalledWith("manager-1", {
        username: "new.manager",
        password: exactPassword,
      }),
    );
    expect(onCommitted).toHaveBeenCalledWith(updated);
    await waitFor(() => expect(username).toHaveValue("new.manager"));
    expect(password).toHaveValue("");
    expect(confirmation).toHaveValue("");
    expect(screen.queryByDisplayValue(exactPassword)).toBeNull();
  });

  it("shows field-local password length and mismatch errors before calling the service", async () => {
    render(
      <Harness
        initialPerson={{
          ...manager,
          hasManagerLogin: false,
          managerUsername: undefined,
        }}
      />,
    );

    const username = screen.getByLabelText("Manager username");
    const password = screen.getByLabelText("Password");
    const confirmation = screen.getByLabelText("Confirm password");
    const submit = screen.getByRole("button", { name: "Enable manager login" });

    expect(password).toHaveAttribute("minlength", "15");
    expect(password).toHaveAttribute("maxlength", "128");
    fireEvent.change(username, { target: { value: "manager.one" } });
    fireEvent.change(password, { target: { value: "too short" } });
    fireEvent.change(confirmation, { target: { value: "too short" } });
    fireEvent.click(submit);
    expect(
      await screen.findByText(
        "Manager password must be between 15 and 128 characters.",
      ),
    ).toHaveAttribute("role", "alert");
    expect(password).toHaveFocus();
    expect(password).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(password, { target: { value: "123456789012345" } });
    fireEvent.change(confirmation, { target: { value: "123456789012346" } });
    fireEvent.click(submit);
    expect(await screen.findByText("Manager passwords do not match.")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(confirmation).toHaveFocus();
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    expect(serviceMocks.configureManagerLogin).not.toHaveBeenCalled();
  });

  it("rejects an invalid username before sending a valid-length password", async () => {
    render(
      <Harness
        initialPerson={{
          ...manager,
          hasManagerLogin: false,
          managerUsername: undefined,
        }}
      />,
    );

    const validPassword = "fifteen-chars-ok!";
    fireEvent.change(screen.getByLabelText("Manager username"), {
      target: { value: "1-invalid" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: validPassword },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: validPassword },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enable manager login" }));

    expect(
      await screen.findByText(
        "Username must be 3 to 32 characters, start with a letter, and use only letters, numbers, periods, dashes, or underscores.",
      ),
    ).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText("Manager username")).toHaveFocus();
    expect(screen.getByLabelText("Manager username")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(serviceMocks.configureManagerLogin).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before disabling manager login", async () => {
    const disabled = {
      ...manager,
      hasManagerLogin: false,
      managerUsername: undefined,
    };
    serviceMocks.disableManagerLogin.mockResolvedValue(disabled);
    const onCommitted = vi.fn();
    render(<Harness onCommitted={onCommitted} />);

    fireEvent.click(screen.getByRole("button", { name: /^Disable$/ }));
    expect(serviceMocks.disableManagerLogin).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Disable username and password sign-in?",
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep enabled" }));
    expect(screen.queryByText("Disable username and password sign-in?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Disable$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Disable manager login" }));

    await waitFor(() =>
      expect(serviceMocks.disableManagerLogin).toHaveBeenCalledWith("manager-1"),
    );
    expect(onCommitted).toHaveBeenCalledWith(disabled);
    await waitFor(() =>
      expect(screen.getByLabelText("Manager username")).toHaveValue(""),
    );
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("requires the manager role to be committed before exposing credential setup", () => {
    render(<Harness initialPerson={salesperson} allowManagerLoginEdit allowRoleEdit />);

    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "manager" },
    });

    expect(screen.getByText(/save the manager role first/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Manager username")).toBeNull();
    expect(screen.queryByRole("button", { name: /enable manager login/i })).toBeNull();
  });

  it("locks dismissal and profile actions until credential setup commits, then keeps a success receipt", async () => {
    let resolveConfigure: ((person: Person) => void) | undefined;
    serviceMocks.configureManagerLogin.mockImplementation(
      () =>
        new Promise<Person>((resolve) => {
          resolveConfigure = resolve;
        }),
    );
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Manager username"), {
      target: { value: "jordan.updated" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "A valid manager password 2026" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "A valid manager password 2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace manager login" }));

    await waitFor(() =>
      expect(serviceMocks.configureManagerLogin).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveConfigure?.({
        ...manager,
        managerUsername: "jordan.updated",
      });
    });

    expect(
      await screen.findByText(
        "Manager login replaced. Existing manager sessions have ended.",
      ),
    ).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(
      cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(cancel.parentElement).not.toHaveClass("flex-col-reverse");
  });

  it.each([
    ["an unauthorized manager editor", manager, false],
    ["an authorized non-manager editor", salesperson, true],
  ])("does not expose manager-login controls to %s", (_label, person, authorized) => {
    render(
      <Harness
        initialPerson={person as Person}
        allowManagerLoginEdit={authorized as boolean}
      />,
    );

    expect(screen.queryByText("Manager username & password")).toBeNull();
    expect(screen.queryByLabelText("Manager username")).toBeNull();
    expect(screen.queryByRole("button", { name: /manager login/i })).toBeNull();
  });
});
