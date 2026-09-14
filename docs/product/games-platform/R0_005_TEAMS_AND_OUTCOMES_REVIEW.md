# GP-R0-005 — Challenge review

**Decision:** `R0_005_TEAMS_AND_OUTCOMES.md`  
**Issue:** #238  
**Verdict:** PASS  
**Runtime changes:** none

## Challenges applied

### 1. Why not create teams for every topology?

Rejected. Synthetic one-player teams add storage/noise and make `teamId` meaningless for duel/FFA. Duel/FFA participant outcomes are already sufficient.

### 2. Why not store only participant outcomes and reconstruct teams?

Rejected. In 2v2/4v4 the team result is a domain fact. Reconstructing it from participant rows creates inferential truth and can drift when an individual disconnects, is disqualified or has a different personal score.

### 3. Why not copy the team win/loss to every participant?

Rejected as a source of truth. A projection can derive a participant's team result. Persisting both as independently authoritative values invites contradictions.

### 4. Does this force Checkers/Chess to change?

No. Both map to `duel`, keep zero team rows and retain side/color as opaque `seatKey`. Their rules/state remain game-owned.

### 5. Does FFA require teams?

No. FFA uses participant placement/score/outcome directly. Eight racers do not become eight teams.

### 6. Is coop representable?

Yes. One match team captures the shared objective and team `objectiveResult=success|failure`. Individual completion/score remains optional. Competing co-op groups use `teams` topology instead.

### 7. Does this cover Arena 2v2/4v4?

Yes. Two team rows plus participant membership are sufficient. Team score/result is canonical once; individual combat metrics stay game-specific.

### 8. Are Party/Classroom/Tournament teams reused?

No. They are mutable admission/social structures. Match team rows are immutable match-scoped snapshots, preventing historical rewrites.

### 9. Can a player change teams mid-match?

Not in V1 after `active`. Games needing substitutions require an explicit later capability and protocol version. This keeps initial Match Core deterministic.

### 10. Is the outcome vocabulary over-generalized?

No. Competitive result, shared objective result, completion status, placement and one optional primary score cover common platform projections without importing kills/captures/FEN/etc. Rich metrics remain game-owned.

## Compatibility verdict

- Checkers: PASS — duel, zero teams, no rule/save changes.
- Chess: PASS — duel, zero teams, no current table changes.
- Arena FFA: PASS — participant outcomes, zero teams.
- Arena 2v2/4v4: PASS — first-class teams/outcomes.
- Coop: PASS — one shared team/objective outcome.

## Review verdict

`PASS`.

GP-R0-005 may be marked `accepted` in `R0_TRACEABILITY.yaml`.

This review does **not** authorize SQL/runtime implementation and does not start GP-R0-006.
