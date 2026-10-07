import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The retired result screen put its secondary actions (Video, Fun mode,
 * Schedule) in a 3-column grid on phones, where `truncate` rendered them as
 * "Vi…", "Fu…" and "Sc…" in a 390px render. Its fix hid the label below 400px
 * and kept an aria-label; that screen is gone.
 *
 * The Post screen avoids the problem by layout instead: its action rows are at
 * most two columns wide (Try another / Add video / Playful wrap onto a second
 * row) and no action label is ever cut short, so a long channel name in
 * "Share to {channel}" wraps rather than losing its ending. These checks keep
 * it that way. Measured cell widths still belong in a real render; this guard
 * only stops the two shapes that produced the "Vi…" tiles.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Code, not comments: `://` survives so a URL is not cut short. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** A grid of three or more equal columns, at any breakpoint. */
const WIDE_GRID = /\bgrid-cols-(?:[3-9]|1[0-2])\b/g;

/** Classes that cut a label short instead of letting it wrap. */
const CLIPS_LABEL = /\b(?:truncate|whitespace-nowrap|text-ellipsis|line-clamp-\d)\b/;

/**
 * Every `<Button ...>...</Button>` element in the file, opening tag through
 * its close. The opening tag ends at the first `>` outside `{...}`, so an icon
 * prop such as `leftIcon={<Share2 />}` does not end it early.
 */
const buttonElements = (code: string): string[] => {
  const out: string[] = [];
  for (
    let at = code.indexOf("<Button");
    at >= 0;
    at = code.indexOf("<Button", at + 7)
  ) {
    let depth = 0;
    let end = -1;
    for (let i = at + 7; i < code.length; i += 1) {
      const ch = code[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (depth === 0 && ch === ">") {
        end =
          code[i - 1] === "/"
            ? i + 1
            : code.indexOf("</Button>", i) + "</Button>".length;
        break;
      }
    }
    out.push(code.slice(at, end > at ? end : undefined));
  }
  return out;
};

const narrowPhoneFaults = (postScreen: string, button: string): string[] => {
  const code = withoutComments(postScreen);
  const faults: string[] = [];
  const wide = [...code.matchAll(WIDE_GRID)].map((m) => m[0]);
  if (wide.length > 0)
    faults.push(`three-or-more-column action grid: ${wide.join(", ")}`);
  const creativeTools = code.slice(
    code.indexOf("const creativeTools ="),
    code.indexOf("const statusLine ="),
  );
  if (!/className="grid grid-cols-2 gap-2"/.test(creativeTools)) {
    faults.push("the creative tools are no longer two to a row");
  }
  const buttons = buttonElements(code);
  if (buttons.length === 0) faults.push("no <Button> elements found to check");
  for (const element of buttons) {
    if (CLIPS_LABEL.test(element)) {
      faults.push(`a Button clips its label: ${element.slice(0, 80)}…`);
    }
  }
  if (CLIPS_LABEL.test(withoutComments(button))) {
    faults.push("components/ui/Button.tsx clips every label");
  }
  return faults;
};

describe("Post screen action buttons on narrow phones", () => {
  const postScreen = read("components/PostScreen.tsx");
  const button = read("components/ui/Button.tsx");

  it("keeps action rows at two columns and never clips an action label", () => {
    expect(narrowPhoneFaults(postScreen, button)).toEqual([]);
  });

  it.each([
    {
      regression: "puts the creative tools three to a row",
      from: '<div className="grid grid-cols-2 gap-2">\n          <Button\n            variant="secondary"\n            size="md"\n            leftIcon={<RefreshCw />}',
      to: '<div className="grid grid-cols-3 gap-2">\n          <Button\n            variant="secondary"\n            size="md"\n            leftIcon={<RefreshCw />}',
    },
    {
      regression: "truncates the Share button's label",
      from: "aria-label={`Share to ${selectedChannel.label}`}",
      to: 'className="truncate"\n              aria-label={`Share to ${selectedChannel.label}`}',
    },
  ])("the guard fails when the screen $regression (planted mutant)", ({ from, to }) => {
    expect(postScreen, `PostScreen.tsx no longer contains ${from}`).toContain(from);
    const mutated = postScreen.replace(from, to);
    expect(mutated).not.toBe(postScreen);
    expect(narrowPhoneFaults(mutated, button).length).toBeGreaterThan(0);
  });
});
