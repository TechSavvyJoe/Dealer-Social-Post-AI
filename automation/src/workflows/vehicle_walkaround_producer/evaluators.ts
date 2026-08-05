import { evaluator, EvaluationBooleanResult } from "@outputai/core";

import { PackageEvaluationSchema } from "./types.js";

export const evaluateWalkaroundAcceptance = evaluator({
  name: "evaluate_walkaround_acceptance",
  description: "Fail closed unless every deterministic and AI quality gate passes",
  inputSchema: PackageEvaluationSchema,
  fn: async (input) => {
    const passed =
      input.groundingPassed &&
      input.privacyPassed &&
      input.continuityPassed &&
      input.audioPassed &&
      input.visualPassed &&
      input.youtubeReady &&
      !input.reshootRequired;
    return new EvaluationBooleanResult({
      value: passed,
      confidence: passed ? 0.99 : 1,
      reasoning: passed
        ? "All walkaround package gates passed"
        : input.reasons.join("; "),
    });
  },
});
