import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppStep } from "../types";
import { useAppStore } from "../stores/appStore";
import { useUrlStepSync } from "../hooks/useUrlStepSync";

const Harness: React.FC<{ onBlocked?: () => void }> = ({ onBlocked }) => {
  useUrlStepSync({ onBlockedResultBack: onBlocked });
  return null;
};

const popTo = (hash: string) => {
  window.location.hash = hash;
  window.dispatchEvent(new PopStateEvent("popstate"));
};

describe("useUrlStepSync", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#/");
    useAppStore.setState({
      step: AppStep.CAPTURE,
      generatedPost: null,
      currentDealer: null,
    });
  });

  it("mirrors step changes into hash history entries", () => {
    render(<Harness />);
    expect(window.location.hash).toBe("#/capture");

    act(() => {
      useAppStore.getState().setStep(AppStep.CUSTOMIZE);
    });
    expect(window.location.hash).toBe("#/customize");
  });

  it("translates Back into the same in-flow transition the UI allows", () => {
    render(<Harness />);
    act(() => {
      useAppStore.getState().setStep(AppStep.CUSTOMIZE);
    });

    act(() => {
      popTo("#/capture");
    });
    expect(useAppStore.getState().step).toBe(AppStep.CAPTURE);
    expect(window.location.hash).toBe("#/capture");
  });

  it("never discards a generated result on Back — it restores the URL and surfaces the guard", () => {
    const onBlocked = vi.fn();
    render(<Harness onBlocked={onBlocked} />);
    act(() => {
      useAppStore.setState({ step: AppStep.RESULT });
    });
    expect(window.location.hash).toBe("#/result");

    act(() => {
      popTo("#/customize");
    });
    expect(useAppStore.getState().step).toBe(AppStep.RESULT);
    expect(window.location.hash).toBe("#/result");
    expect(onBlocked).toHaveBeenCalledOnce();
  });

  it("refuses URL-driven trips into or out of the login step", () => {
    render(<Harness />);
    act(() => {
      popTo("#/login");
    });
    expect(useAppStore.getState().step).toBe(AppStep.CAPTURE);
    expect(window.location.hash).toBe("#/capture");

    act(() => {
      useAppStore.setState({ step: AppStep.LOGIN });
    });
    act(() => {
      popTo("#/admin");
    });
    expect(useAppStore.getState().step).toBe(AppStep.LOGIN);
  });

  it("blocks forward navigation into RESULT without a creative", () => {
    render(<Harness />);
    act(() => {
      popTo("#/result");
    });
    expect(useAppStore.getState().step).toBe(AppStep.CAPTURE);
    expect(window.location.hash).toBe("#/capture");
  });
});
