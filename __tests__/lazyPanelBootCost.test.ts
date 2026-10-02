import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
describe("heavy panels stay off the login boot path", () => {
  const app = readFileSync(resolve(process.cwd(), "App.tsx"), "utf8");
  const main = readFileSync(
    resolve(process.cwd(), "components/MainContent.tsx"),
    "utf8",
  );
  it("defers Settings until first use and keeps it mounted afterward", () => {
    expect(app).toContain("settingsEverOpened &&");
    expect(app).toContain("if (open) setMounted(true);");
    expect(app).toContain("return mounted || open;");
  });
  it("warms Details only after sign-in", () => {
    const at = app.indexOf('import("./components/PostDetails")');
    expect(at).toBeGreaterThan(0);
    expect(app.slice(at - 200, at)).toContain("if (!isSignedIn) return;");
    expect(main).toContain('import("./PostDetails")');
  });
  it("shows the selected photo and status while Details loads", () => {
    expect(main).toContain("Opening details…");
    expect(main).toContain('alt="Your selected photo"');
    expect(main).toContain('role="status"');
    expect(app).not.toContain("LazyImageCropModal");
    expect(main).not.toContain('import("./PostCustomizer")');
  });
});
