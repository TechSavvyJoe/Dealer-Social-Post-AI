/** Strict, shared identity checks for isolated Hub release-canary evidence. */
export const HUB_CANARY_DRAFT_ID = /^dspc_[a-f0-9]{32}$/;
const IDENTITY_KEYS = [
  "draftId",
  "eventId",
  "payloadHash",
  "sourceDealerId",
  "sourcePostId",
  "sourceRevision",
];

export function validHubCanaryIdentity(identity) {
  return (
    !!identity &&
    HUB_CANARY_DRAFT_ID.test(identity.draftId || "") &&
    /^wp_s_[a-f0-9]{32}_[a-f0-9]{40}$/.test(identity.eventId || "") &&
    /^[a-f0-9]{64}$/.test(identity.payloadHash || "") &&
    /^[A-Za-z0-9_-]{10,40}$/.test(identity.sourceDealerId || "") &&
    /^[A-Za-z0-9_-]{10,40}$/.test(identity.sourcePostId || "") &&
    Number.isSafeInteger(identity.sourceRevision) &&
    identity.sourceRevision > 0
  );
}

export function hubCanaryIdentityMatches(candidate, expected) {
  return (
    validHubCanaryIdentity(candidate) &&
    validHubCanaryIdentity(expected) &&
    IDENTITY_KEYS.every((key) => candidate[key] === expected[key])
  );
}

export function validHubPurgeResult(
  result,
  identity,
  earliestCompletedAt,
  now = Date.now(),
) {
  const completedAt = Date.parse(result?.completedAt || "");
  const earliest = Date.parse(earliestCompletedAt || "");
  return (
    hubCanaryIdentityMatches(result, identity) &&
    result.schemaVersion === 1 &&
    result.status === "purged" &&
    Number.isFinite(completedAt) &&
    Number.isFinite(earliest) &&
    completedAt >= earliest &&
    completedAt <= now + 300_000 &&
    !Object.hasOwn(result, "capability") &&
    result.contentAbsent === true &&
    result.mediaAbsent === true &&
    result.replayBlocked === true
  );
}
