import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

// Reproducible self-hosted assets. No runtime CDN or third-party footage upload.
const target = resolve("public/vehicle-spin-v1");
const model = resolve(target, "interactive_segmentation.task");
const sha = "38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03";
const matches = (bytes) => createHash("sha256").update(bytes).digest("hex") === sha;
await mkdir(target, { recursive: true });
let existing;
try {
  existing = await readFile(model);
} catch {}
if (!existing || !matches(existing)) {
  const response = await fetch(
    "https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task",
    { signal: AbortSignal.timeout(120000) },
  );
  if (!response.ok) throw new Error("Vehicle segmentation model download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!matches(bytes)) throw new Error("Vehicle segmentation model checksum mismatch");
  await writeFile(model, bytes);
}
for (const name of [
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
])
  await copyFile(
    resolve("node_modules/@mediapipe/tasks-vision/wasm", name),
    resolve(target, name),
  );
console.log("Vehicle Spin model verified; MediaPipe 1.1.0 runtime copied.");
