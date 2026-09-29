# Narrow customer-name guard fix — parked 2026-09-23

Scope: only the six Codex findings on PR #35 (F1 America as a name, F2 ambiguous names in
person-action phrases, F3 vocabulary surnames after the approved name, F4 collective
participial openers — the ONE allowed relaxation, F5 brands after explicit person labels,
F6 all-caps title abbreviations). Branch `fix/name-guard-codex-narrow` (this commit) holds
round 1 of the fix in `utils/captionQuality.ts` + `pb_hooks/websitePublications.js`.

State: NOT ready to merge. Round 1 passed the hard gate, but two independent reviewers then
reported still-leaking cases — America as subject ("America is all smiles!"), "Helping Hunter
with a new F-150!" (customer Michelle), "MICHELLE YOUNG IS ALL SMILES!", "New owner Ford drove
home today!" — plus regressions: all-caps street abbreviations now joining as titles
("Stop by 123 Main ST. Sarah Johnson…"), "Celebrating Each Hero Thomas Jones!" and
"Celebrating Local Heroes Charles Rogers!" (the F4 relaxation must never carry a real name),
and a client/server digit-class parity gap (\p{N} on the client). The reviewers' caption lists are
in the workflow journal (`wf_4657363f-075`) and were appended to the gate's extra rows.

HARD GATE (keep it): production's guard vs the fix over the oracle rows fails on ANY caption
production REFUSES that the fix ACCEPTS (only F4 rows with expected ACCEPT may relax), and on any
NEW client/server disagreement beyond production's 27 known astral-plane ones.
Files here: `guard-oracle-gate.test.ts.txt` (copy to `__tests__/__scratch__/oracle/oracle.test.ts`),
`guard-oracle-vitest.config.ts.txt`, `guard-oracle-corpus-5850.json`, `guard-oracle-extra-rows.json`,
`guard-oracle-baseline-parity.txt`, `guard-oracle-base.tgz` (production's guard copies, extract to
`__tests__/__scratch__/oracle/base/`). Run: `npx vitest run --config __tests__/__scratch__/oracle/vitest.oracle.config.ts`.

Resume: fix only what the reviewers listed, one round; re-review; Goja smoke (admin pre-created —
see the pocketbase installer memory); then PR + reply on PR #35 threads 4051555390/398/402/408/417/422.
The 13-round `guard-round-8` branch stays parked; do not copy its sign-off machinery.
