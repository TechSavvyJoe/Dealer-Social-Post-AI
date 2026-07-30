import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "../components/LoginScreen";
import { ToastProvider } from "../components/ui/Toast";

const enterPersonalCode = async () => {
  // fireEvent flushes each keypad update independently; keeping the four
  // clicks outside one outer act prevents React from batching stale code state.
  for (const digit of ["1", "2", "3", "4"]) {
    fireEvent.click(screen.getByRole("button", { name: `Digit ${digit}` }));
  }
  await act(async () => {
    // Flush the resolved sign-in promise and its state update without relying
    // on wall-clock polling under a busy parallel test run.
    await Promise.resolve();
    await Promise.resolve();
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, "turnstile");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("risk-triggered sign-in UX", () => {
  it("renders the managed challenge only when the backend requests it", async () => {
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: {
        render: vi.fn(() => "widget-1"),
        remove: vi.fn(),
        reset: vi.fn(),
      },
    });
    const onLogin = vi.fn().mockResolvedValue({
      ok: false,
      code: "CHALLENGE_REQUIRED",
    });
    render(
      <ToastProvider>
        <LoginScreen onLogin={onLogin} />
      </ToastProvider>,
    );

    expect(screen.queryByRole("heading", { name: "Security check" })).toBeNull();
    await enterPersonalCode();

    expect(
      await screen.findByRole("heading", { name: "Security check" }),
    ).toBeInTheDocument();
    expect(onLogin).toHaveBeenCalledWith("1234", undefined);
    await waitFor(() => expect(window.turnstile?.render).toHaveBeenCalled());
  });

  it("lets users retry failed or expired challenges and return to edit the code", async () => {
    type TurnstileOptions = Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
    let challengeCallbacks:
      | {
          "error-callback": () => void;
          "expired-callback": () => void;
        }
      | undefined;
    const renderChallenge = vi.fn(
      (_container: HTMLElement, options: TurnstileOptions) => {
        challengeCallbacks = options;
        return `widget-${renderChallenge.mock.calls.length}`;
      },
    );
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: {
        render: renderChallenge,
        remove: vi.fn(),
        reset: vi.fn(),
      },
    });
    const onLogin = vi.fn().mockResolvedValue({
      ok: false,
      code: "CHALLENGE_REQUIRED",
    });
    render(
      <ToastProvider>
        <LoginScreen onLogin={onLogin} />
      </ToastProvider>,
    );

    await enterPersonalCode();
    await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(1));

    act(() => challengeCallbacks?.["error-callback"]());
    expect(
      screen.getAllByText(/security check could not load/i).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry security check" }));
    await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(2));

    act(() => challengeCallbacks?.["expired-callback"]());
    expect(screen.getAllByText(/security check expired/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Retry security check" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Edit access code" }));
    expect(screen.queryByRole("heading", { name: "Security check" })).toBeNull();
    expect(
      screen.getByRole("status", { name: "4 of 4 digits entered" }),
    ).toBeInTheDocument();
  });

  it("remounts a fresh challenge after a consumed token is rejected or unavailable", async () => {
    type TurnstileOptions = Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
    const callbacks: TurnstileOptions[] = [];
    const renderChallenge = vi.fn(
      (_container: HTMLElement, options: TurnstileOptions) => {
        callbacks.push(options);
        return `widget-${callbacks.length}`;
      },
    );
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: {
        render: renderChallenge,
        remove: vi.fn(),
        reset: vi.fn(),
      },
    });
    const onLogin = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "CHALLENGE_REQUIRED" })
      .mockResolvedValueOnce({ ok: false, code: "CHALLENGE_REQUIRED" })
      .mockResolvedValueOnce({
        ok: false,
        code: "UNAVAILABLE",
        message: "Verifier temporarily unavailable.",
      });
    render(
      <ToastProvider>
        <LoginScreen onLogin={onLogin} />
      </ToastProvider>,
    );

    await enterPersonalCode();
    await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(1));

    act(() => callbacks[0]?.callback("consumed-invalid-token"));
    await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(2));
    expect(onLogin).toHaveBeenLastCalledWith("1234", "consumed-invalid-token");

    act(() => callbacks[1]?.callback("consumed-unavailable-token"));
    await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(3));
    expect(onLogin).toHaveBeenLastCalledWith("1234", "consumed-unavailable-token");
    expect(screen.getByRole("heading", { name: "Security check" })).toBeInTheDocument();
    expect(await screen.findByText("Verifier temporarily unavailable.")).toBeVisible();
  });

  it("shows the server lockout countdown instead of calling a bad code invalid", async () => {
    const onLogin = vi.fn().mockResolvedValue({
      ok: false,
      code: "LOCKED",
      retryAfterSeconds: 65,
    });
    render(
      <ToastProvider>
        <LoginScreen onLogin={onLogin} />
      </ToastProvider>,
    );

    await enterPersonalCode();

    expect(
      await screen.findByRole("heading", {
        name: "Sign-in temporarily locked",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1:0[45]/)).toBeInTheDocument();
    expect(screen.queryByText(/not recognized/i)).toBeNull();
  });

  it("labels infrastructure failures as unavailable, not as a bad code", async () => {
    const onLogin = vi.fn().mockResolvedValue({
      ok: false,
      code: "UNAVAILABLE",
      message: "The secure sign-in service is unavailable. Try again.",
    });
    render(
      <ToastProvider>
        <LoginScreen onLogin={onLogin} />
      </ToastProvider>,
    );

    await enterPersonalCode();

    expect(
      await screen.findByText("The secure sign-in service is unavailable. Try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not recognized/i)).toBeNull();
  });
});
