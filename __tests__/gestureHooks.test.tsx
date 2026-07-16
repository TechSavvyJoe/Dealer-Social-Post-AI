import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useTouchGestures } from "../hooks/useTouchGestures";

const touchEvent = ({
  x,
  y,
  target,
  currentTarget = target,
}: {
  x: number;
  y: number;
  target: Element;
  currentTarget?: Element;
}) =>
  ({
    target,
    currentTarget,
    touches: [{ clientX: x, clientY: y }],
    cancelable: true,
    preventDefault: vi.fn(),
  }) as unknown as TouchEvent;

describe("useTouchGestures", () => {
  it("fires only for a deliberate axis-locked swipe", () => {
    const onSwipeRight = vi.fn();
    const surface = document.createElement("div");
    const { result } = renderHook(() =>
      useTouchGestures({ onSwipeRight, threshold: 50 }),
    );

    act(() => {
      result.current.onTouchStart(
        touchEvent({ x: 120, y: 40, target: surface }),
      );
      result.current.onTouchMove(touchEvent({ x: 40, y: 45, target: surface }));
      result.current.onTouchEnd();
    });

    expect(onSwipeRight).not.toHaveBeenCalled();

    act(() => {
      result.current.onTouchStart(
        touchEvent({ x: 40, y: 40, target: surface }),
      );
      result.current.onTouchMove(
        touchEvent({ x: 120, y: 44, target: surface }),
      );
      result.current.onTouchEnd();
    });

    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it("ignores gestures that start on interactive controls", () => {
    const onSwipeRight = vi.fn();
    const button = document.createElement("button");
    const { result } = renderHook(() => useTouchGestures({ onSwipeRight }));

    act(() => {
      result.current.onTouchStart(touchEvent({ x: 20, y: 20, target: button }));
      result.current.onTouchMove(touchEvent({ x: 140, y: 20, target: button }));
      result.current.onTouchEnd();
    });

    expect(onSwipeRight).not.toHaveBeenCalled();
  });
});

describe("usePullToRefresh", () => {
  it("uses the latest pull distance when deciding to refresh", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const surface = document.createElement("div");
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 80 }),
    );

    act(() => {
      result.current.handlers.onTouchStart(
        touchEvent({ x: 0, y: 0, target: surface, currentTarget: surface }),
      );
      result.current.handlers.onTouchMove(
        touchEvent({ x: 0, y: 200, target: surface, currentTarget: surface }),
      );
    });
    await act(async () => {
      await result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.pullDistance).toBe(0);
    expect(result.current.isRefreshing).toBe(false);
  });

  it("does not hijack a pull that starts on a form control", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const input = document.createElement("input");
    const surface = document.createElement("div");
    const { result } = renderHook(() => usePullToRefresh({ onRefresh }));

    act(() => {
      result.current.handlers.onTouchStart(
        touchEvent({ x: 0, y: 0, target: input, currentTarget: surface }),
      );
      result.current.handlers.onTouchMove(
        touchEvent({ x: 0, y: 220, target: input, currentTarget: surface }),
      );
    });
    await act(async () => {
      await result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
