import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Switch, type SwitchProps } from "../components/ui/Switch";

/** A controlled switch, the way every settings row uses it. */
const Controlled: React.FC<Partial<SwitchProps> & { initial?: boolean }> = ({
  initial = false,
  onChange,
  ...props
}) => {
  const [checked, setChecked] = useState(initial);
  return (
    <Switch
      aria-label="Video"
      {...props}
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        onChange?.(next);
      }}
    />
  );
};

describe("Switch", () => {
  it("is a switch that reports its state", () => {
    const { rerender } = render(
      <Switch aria-label="Playful style" checked onChange={() => {}} />,
    );
    const control = screen.getByRole("switch", { name: "Playful style" });
    expect(control.tagName).toBe("BUTTON");
    expect(control).toHaveAttribute("type", "button");
    expect(control).toHaveAttribute("aria-checked", "true");
    rerender(<Switch aria-label="Playful style" checked={false} onChange={() => {}} />);
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  it("toggles on click and reports the next value", () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Video" });
    fireEvent.click(control);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(control).toHaveAttribute("aria-checked", "true");
    fireEvent.click(control);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  it("toggles with Space and Enter from the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await user.tab();
    const control = screen.getByRole("switch", { name: "Video" });
    expect(control).toHaveFocus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith(true);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("does not toggle while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled disabled onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Video" });
    expect(control).toBeDisabled();
    fireEvent.click(control);
    await user.click(control);
    expect(onChange).not.toHaveBeenCalled();
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  it("does not toggle while busy, but keeps focus and announces aria-busy", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled busy initial onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Video" });
    expect(control).toHaveAttribute("aria-busy", "true");
    expect(control).not.toBeDisabled();
    await user.tab();
    expect(control).toHaveFocus();
    fireEvent.click(control);
    await user.keyboard(" ");
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("shows On or Off beside the track, hidden from assistive technology", () => {
    const { rerender } = render(
      <Switch aria-label="Video" checked onChange={() => {}} />,
    );
    const control = screen.getByRole("switch", { name: "Video" });
    const word = control.querySelector("span[aria-hidden='true']");
    expect(word).toHaveTextContent("On");
    expect(control).toHaveAccessibleName("Video");
    rerender(<Switch aria-label="Video" checked={false} onChange={() => {}} />);
    expect(word).toHaveTextContent("Off");
    rerender(
      <Switch
        aria-label="Video"
        checked={false}
        onChange={() => {}}
        showState={false}
      />,
    );
    expect(control).not.toHaveTextContent(/On|Off/);
  });

  it("takes its accessible name and description from the label props", () => {
    render(
      <>
        <span id="disclosure-label">Add the disclosure to every post</span>
        <span id="disclosure-help">This line is added to the top of every post.</span>
        <Switch
          aria-labelledby="disclosure-label"
          aria-describedby="disclosure-help"
          checked
          onChange={() => {}}
        />
      </>,
    );
    const control = screen.getByRole("switch", {
      name: "Add the disclosure to every post",
    });
    expect(control).toHaveAccessibleDescription(
      "This line is added to the top of every post.",
    );
  });

  it("forwards its ref to the button", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Switch ref={ref} aria-label="Video" checked={false} onChange={() => {}} />);
    expect(ref.current).toBe(screen.getByRole("switch", { name: "Video" }));
  });

  it("paints on and off with tokens only and does not animate under reduced motion", () => {
    const { container, rerender } = render(
      <Switch aria-label="Video" checked onChange={() => {}} />,
    );
    const track = container.querySelector("[data-switch-track]") as HTMLElement;
    const knob = container.querySelector("[data-switch-knob]") as HTMLElement;
    expect(track).toHaveClass("bg-brand-fill", "border-brand-ink", "h-7", "w-12");
    expect(knob).toHaveClass("bg-brand-foreground", "translate-x-5");
    expect(knob).toHaveClass("duration-120", "motion-reduce:transition-none");
    rerender(<Switch aria-label="Video" checked={false} onChange={() => {}} />);
    expect(track).toHaveClass("bg-panel-raised", "border-strong");
    expect(knob).toHaveClass("bg-ink-2", "translate-x-0");
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|text-white/i);
  });
});
