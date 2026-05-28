/**
 * Re-export of services/modelConfig.
 *
 * Pre-existing imports throughout the codebase point at `../utils/modelConfig`
 * even though the actual file lives at `services/modelConfig`. Rather than
 * rewrite all the call sites (and re-touch every PR they appear in), this
 * file proxies the canonical module so both import paths resolve to the same
 * exports.
 *
 * If you ever consolidate locations, delete this file and update the 3 import
 * sites in services/geminiClient.ts, services/geminiService.ts, and
 * services/geminiService.test.ts.
 */
export { MODELS, getModel } from "../services/modelConfig";
