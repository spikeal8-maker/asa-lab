# GP-R0-006 — Challenge Review

**Issue:** #240  
**Decision:** `R0_006_MINIMUM_CAPABILITIES.md`  
**Verdict:** PASS

## Review questions

### 1. Does the vocabulary preserve GP-R0-003 orthogonality?

PASS. `admission.matchmaking` and `competition.rated` are independent. Quick is matchmaking + casual; rated matchmaking requires both matchmaking and rated capability. Scope remains a Match dimension rather than another capability namespace.

### 2. Can a client or game self-grant access?

PASS. Game support, ASA policy grant and live eligibility are explicitly separate. Client-declared capability values have no authority.

### 3. Does disabling a game create a recovery failure?

PASS. `disabled_new_matches` blocks new admission but not reconnect/history for already authorized matches. Active-match abort remains an explicit GP-R0-004 action.

### 4. Does the design leak education metadata through public stats?

PASS. `profile.public_projection` is limited to an explicitly public-safe projection and cannot expose school/class/learning/internal identity fields.

### 5. Is R0 over-designing Creator permissions?

PASS. Device/browser/filesystem/network/build/sandbox capabilities are explicitly excluded until R7+.

### 6. Does R1 require unnecessary platform systems?

PASS. R1 requires only invite, reconnect, own history and admission gating. Matchmaking/rating/public profile wait for later value stages.

### 7. Can Chess converge without Chess-specific capability names?

PASS. Existing challenge/matchmaking/rated/reconnect concepts map to the same shared keys in R4 after parity.

## Negative-case review

- invite URL used as authentication → rejected;
- rated support mistaken for rated eligibility → rejected;
- game disabled causing active reconnect denial → rejected;
- classroom membership modeled as global capability → rejected;
- Quick and Rated encoded as a new overloaded mode permission → rejected;
- game manifest granting itself public/network access → rejected.

## Review conclusion

The vocabulary is intentionally minimal, policy-safe and sufficient for R1–R4. It does not commit the platform to the much larger Creator/runtime permission catalog.

`GP-R0-006` is accepted. Physical storage/configuration and API DTOs remain implementation-stage concerns.
