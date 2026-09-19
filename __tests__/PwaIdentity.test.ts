import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path));
const pngSize = (path: string) => {
  const buffer = read(path);
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};
const pngIsOpaque = (path: string) => {
  const buffer = read(path);
  const colorType = buffer[25];
  if (colorType === 4 || colorType === 6) return false;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (chunkType === "tRNS") return false;
    offset += chunkLength + 12;
  }
  return true;
};

describe("installable product identity", () => {
  it("publishes descriptive install metadata and separate maskable icons", () => {
    const manifest = JSON.parse(
      read("public/manifest.webmanifest").toString("utf8"),
    ) as {
      id?: string;
      name?: string;
      short_name?: string;
      description?: string;
      display?: string;
      icons?: Array<{ src: string; sizes: string; purpose?: string }>;
      screenshots?: Array<{
        src: string;
        sizes: string;
        type: string;
        form_factor: string;
      }>;
    };

    expect(manifest.id).toBe("/");
    expect(manifest.name).toBe("Dealer Social Post AI");
    expect(manifest.short_name).toBe("Dealer Social");
    expect(manifest.description?.length).toBeGreaterThan(60);
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/dealer-social-dsp-v4-512.png",
          sizes: "512x512",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/dealer-social-dsp-v4-maskable-512.png",
          sizes: "512x512",
          purpose: "maskable",
        }),
        expect.objectContaining({
          src: "/dealer-social-dsp-v4-maskable-1024.png",
          sizes: "1024x1024",
          purpose: "maskable",
        }),
        expect.objectContaining({
          src: "/dsp-brand-mark-v4-monochrome.svg",
          sizes: "any",
          purpose: "monochrome",
        }),
      ]),
    );
    expect(manifest.screenshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/screenshots/login-mobile.webp",
          sizes: "390x844",
          type: "image/webp",
          form_factor: "narrow",
        }),
        expect.objectContaining({
          src: "/screenshots/login-desktop.webp",
          sizes: "1440x900",
          type: "image/webp",
          form_factor: "wide",
        }),
      ]),
    );
  });

  it("ships correctly sized browser, Apple, and desktop app artwork", () => {
    for (const [path, size] of [
      ["public/dealer-social-favicon-v4-32.png", 32],
      ["public/dealer-social-dsp-v4-180.png", 180],
      ["public/dealer-social-dsp-v4-192.png", 192],
      ["public/dealer-social-dsp-v4-512.png", 512],
      ["public/dealer-social-dsp-v4-1024.png", 1024],
      ["public/dealer-social-dsp-v4-maskable-192.png", 192],
      ["public/dealer-social-dsp-v4-maskable-512.png", 512],
      ["public/dealer-social-dsp-v4-maskable-1024.png", 1024],
    ] as const) {
      expect(existsSync(resolve(process.cwd(), path))).toBe(true);
      expect(pngSize(path)).toEqual({ width: size, height: size });
    }
    for (const path of [
      "public/dealer-social-dsp-v4-180.png",
      "public/dealer-social-dsp-v4-192.png",
      "public/dealer-social-dsp-v4-512.png",
      "public/dealer-social-dsp-v4-1024.png",
      "public/dealer-social-dsp-v4-maskable-192.png",
      "public/dealer-social-dsp-v4-maskable-512.png",
      "public/dealer-social-dsp-v4-maskable-1024.png",
    ]) {
      expect(pngIsOpaque(path)).toBe(true);
    }
    for (const size of [192, 512, 1024]) {
      expect(
        read(`public/dealer-social-dsp-v4-${size}.png`).equals(
          read(`public/dealer-social-dsp-v4-maskable-${size}.png`),
        ),
      ).toBe(false);
    }
  });

  it("advertises the vector favicon, install manifest, and Apple app identity", () => {
    const html = read("index.html").toString("utf8");
    expect(html).toContain('name="application-name" content="Dealer Social Post AI"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="Dealer Social"');
    expect(html).toContain(
      'rel="icon" type="image/svg+xml" href="/dsp-brand-mark-v4-micro.svg"',
    );
    expect(html).toContain('href="/dealer-social-dsp-v4-180.png"');
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain("viewport-fit=cover");
  });

  it("keeps vector identity self-contained and structurally scalable", () => {
    for (const [path, viewBox] of [
      ["public/dsp-brand-mark-v4.svg", "0 0 120 120"],
      ["public/dsp-brand-mark-v4-app.svg", "0 0 120 120"],
      ["public/dsp-brand-mark-v4-micro.svg", "0 0 16 16"],
      ["public/dsp-brand-mark-v4-maskable.svg", "0 0 120 120"],
      ["public/dsp-brand-mark-v4-monochrome.svg", "0 0 120 120"],
    ] as const) {
      const svg = read(path).toString("utf8");
      expect(svg).toContain(`viewBox="${viewBox}"`);
      expect(svg).not.toMatch(/(?:href|src)=["'](?:https?:|\/\/|data:)/i);
      expect(svg).not.toMatch(/@import|url\(\s*(?:https?:|\/\/)/i);
      expect(svg).not.toMatch(/<script|<foreignObject|\son[a-z]+\s*=/i);
    }
    // The maskable safe zone: home-screen mask shapes crop to an inscribed
    // circle 80% of the icon's size, so the glyph is scaled down and
    // recentered within that zone to survive any mask shape uncropped.
    expect(read("public/dsp-brand-mark-v4-maskable.svg").toString("utf8")).toContain(
      "scale(0.78)",
    );
  });

  it("keeps the full product name in the runtime lockup", () => {
    const logo = read("components/Logo.tsx").toString("utf8");
    const symbol = read("public/dsp-brand-mark-v4.svg").toString("utf8");

    expect(logo).toContain('aria-label="Dealer Social Post AI"');
    expect(logo).toContain('href="/dsp-brand-mark-v4.svg"');
    expect(logo).toContain("DEALER SOCIAL");
    expect(logo).toContain("POST ");
    expect(logo).toContain(">AI</tspan>");
    expect(symbol).toContain(">Dealer Social Post AI</title>");
    expect(symbol).toContain("photo print");
  });

  it("stacks the real update prompt inside mobile shell chrome", () => {
    const app = read("App.tsx").toString("utf8");
    const entrypoint = read("index.tsx").toString("utf8");
    const styles = read("styles/globals.css").toString("utf8");
    const impersonation = app.indexOf("<ImpersonationBanner />");
    const updatePrompt = app.indexOf("<PwaUpdatePrompt />");
    const header = app.indexOf("<Header");

    expect(impersonation).toBeGreaterThan(-1);
    expect(updatePrompt).toBeGreaterThan(impersonation);
    expect(header).toBeGreaterThan(updatePrompt);
    expect(entrypoint).not.toContain("<PwaUpdatePrompt />");
    expect(styles).toContain("@media (min-width: 1200px) and (min-height: 600px)");
  });

  it("fails service-worker installation when the required offline shell is missing", () => {
    const worker = read("public/sw.js").toString("utf8");
    const installHandler = worker.slice(
      worker.indexOf('self.addEventListener("install"'),
      worker.indexOf('self.addEventListener("message"'),
    );
    expect(worker).toContain('const APP_SHELL = ["/", "/index.html"');
    expect(installHandler).toContain("cache.addAll(APP_SHELL)");
    expect(installHandler).not.toContain(".catch(");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('url.pathname === "/manifest.webmanifest"');
  });
});
