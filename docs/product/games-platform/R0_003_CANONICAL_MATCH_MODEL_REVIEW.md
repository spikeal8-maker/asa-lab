# GP-R0-003 — Review Receipt

**Issue:** #226  
**Decision:** `R0_003_CANONICAL_MATCH_MODEL.md`  
**Change class:** L3_CRITICAL architecture/model  
**Runtime/schema changes:** none

## POST_STEP_REVIEW

- **STEP:** replace overloaded per-game match modes with one game-independent Match envelope.
- **USER_RESULT:** future Checkers/Chess/XO/Arena integrations can share match identity/lifecycle metadata without sharing game rules/state.
- **INVARIANTS:** GP-R0-001 stable gaming subject; GP-R0-002 platform-scoped Games security domain.
- **EVIDENCE:** current `contexts/checkers/application/game-service.ts`, `apps/web/src/checkers/checkers-match-session.ts`, `contexts/chess-live/domain/model.ts`.
- **NEGATIVE CHECKS:** rated is not admission; classroom is not competition; white/light are not schema columns; lesson semantics do not enter Games Core; realtime state is not forced into command-state storage.
- **UNVERIFIED:** exact lifecycle transitions, team outcome persistence and SQL representation are deliberately deferred to GP-R0-004/005/R1.
- **VERDICT:** PASS.

## CHALLENGE_REVIEW

### Challenge 1 — are five axes over-engineering?

No. Existing Checkers already proves one enum is overloaded: `friend`, `quick`, `rated`, `class`, `bot`, `local`, `lesson` describe different concerns. Chess separately carries challenge/matchmaking source plus `rated`. Keeping those concerns independent removes combinations rather than creating them.

### Challenge 2 — do event/tournament values duplicate each other across admission and scope?

They represent different facts. `admission=tournament` says the participant entered because a tournament paired them. `scope=tournament` says tournament membership/policy controls visibility/access. A classroom event can therefore be `admission=event + scope=classroom` without inventing a new mode.

### Challenge 3 — is `seatKey` leaking game-specific schema into Core?

No. The Core stores an opaque participant slot and never interprets `white`, `dark`, `p1`, etc. This removes fixed color columns while preserving deterministic participant-to-game-role mapping.

### Challenge 4 — should generic Match store one universal JSON state?

No. That would recreate coupling under a JSON column. Chess FEN/clocks, Checkers documents and realtime worlds have different authority/recovery models. The Match pins versions and references game-owned configuration/state boundaries only.

### Challenge 5 — could `lesson` require another generic dimension?

No. Lesson is an educational context, not an admission/competition/runtime/topology property. Learning may reference a real match externally; Games must not absorb Learning semantics.

### Challenge 6 — does this survive Arena 2v2?

Yes at the envelope level: `runtime=realtime_room`, `topology=teams`. Participant-to-team semantics are intentionally completed by GP-R0-005 before SQL exists.

## Compatibility verdict

- **Checkers:** every current competitive/social mode decomposes without changing Russian-64 rules or current saves. `lesson` remains external context.
- **Chess:** `rated`, challenge/matchmaking origin and white/black participants map without moving FEN/moves/clocks into generic storage. Existing Chess Live stays untouched until R4.

**Final verdict: PASS.**
