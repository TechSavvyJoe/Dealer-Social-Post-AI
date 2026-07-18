import "@testing-library/jest-dom/vitest";

// Keep animation-heavy component tests deterministic and mirror the product's
// accessibility path. Individual tests can still replace matchMedia when they
// specifically need to exercise motion-enabled behavior.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string) => ({
    matches: query.includes("prefers-reduced-motion: reduce"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
