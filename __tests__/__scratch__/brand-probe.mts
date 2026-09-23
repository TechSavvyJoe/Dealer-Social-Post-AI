import { deriveBrandTokens } from "../../utils/brandColor.ts";
for (const theme of ["dark", "light"] as const) {
  const t: any = deriveBrandTokens("#1e40af", theme);
  console.log(`${theme}: ink=${t.ink} inkRgb=${t.inkRgb} r300=${t.ramp300Rgb} r400=${t.ramp400Rgb} r500=${t.ramp500Rgb} r600=${t.ramp600Rgb} r700=${t.ramp700Rgb}`);
}
