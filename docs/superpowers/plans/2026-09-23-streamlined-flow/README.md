# Streamlined salesperson flow — build kit (saved 2026-09-23)

Everything needed to resume PR2a/PR2b without the session that produced it.

- `../../specs/2026-09-22-streamlined-posting-flow-design.md` (on main) — the approved flow.
- `pr2-blueprint.json` — Opus architect's 22-unit plan (`blueprint.units[]`: creates/modifies/
  retires/reuses/behaviours_preserved/tests/acceptance/depends_on; `step_machine`, `data_flow`,
  `e2e_plan`) and the coverage critic's findings (`critique`).
- `pr2-amendments.md` — BINDING overrides of the blueprint (A1–A5 high, B1–B15, C1–C2).
  Where it conflicts with the blueprint, the amendments win.
- `audit-results.json` — the five-area workflow audit (capture, details, publish, variants,
  history-admin): steps, friction with file:line evidence, KEEP lists, variants/gates.
- `artboards/` — the approved hi-fi designs (`Home`, `Details`, `Post` phone prototype;
  `*Desk` desktop; `Flow` = today vs proposed; the shipped login is on the canvas).
  Live canvas: https://claude.ai/artifact/MG9T8X83CRWD4XBELJhnwB

Done: U01–U08 (PR2-0, merged as #37 → 56cf03c, deployed).
Next: PR2a = U09 step machine → U10 storeDefaults, U13 Creating → U11 Home, U12 Details →
U14 shell wiring + deletions → U15 e2e. PR2b = U16 usePostShare, U18 creative tools →
U17 PostScreen → U19 Shared/leave guard, U20 My work → U21 deletions → U22 e2e.
Joe chose "Faster": one review pass per unit, legal/privacy checks still fully tested.
