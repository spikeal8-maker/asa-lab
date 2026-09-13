# Preview-as-Learner — CHALLENGE_REVIEW

Historical first-stage receipt. The total-SQL-read-only interpretation and 0137 below were superseded by [stabilization 02](LRN_PREVIEW_STABILIZATION_02_2026_09_13.md), which is the current bounded technical review. These earlier test results are preserved as history, not a statement about the final branch.


Separate critical self-review after the implementation pass. This is not an independent reviewer verdict or owner acceptance.

| Challenge | Evidence and result |
| --- | --- |
| Counts could conceal UPDATE or insert/delete pairs | During actual HTTP Preview calls, statement triggers reject INSERT/UPDATE/DELETE/TRUNCATE on every public table of the isolated test DB. Exact draft/published reads and negative cases pass with the guard. This covers Account, Seat, Enrollment, Participation, Attempt, Submission, Completion storage, Results/revisions, Gradebook, notifications, author and learner sessions, and audit. |
| Authentication itself might write | The guard initially failed on session last_seen_at. The optional read-only mode now selects session_v2_context_read_only; existing session resolver, cookies, hashing, legacy read fallback and authorization model remain. Browser Preview does not auto-refresh on 401. |
| Read-only resolver might weaken access | PostgreSQL regression compares read context with ordinary resolver and denies revoked/expired session, suspended account and revoked workspace membership. The new SQL preserves active session/account/workspace/membership and tenant-link predicates from 0011. |
| Arbitrary client activity/version IDs might reveal another author's content | The STABLE author function requires exact principal/tenant ownership and reusable authored source. Published version requires the same activity/tenant and canonical contract. HTTP uses a real second author and version; requests are denied with 404. |
| Unsaved draft or newer server draft could masquerade as the requested source | UI requires savedPayload equality; endpoint requires exact integer revision and returns 409 on drift. Published version remains pinned after editing the draft, including a repeatable content digest. |
| Late network responses might replace the selected source | Browser test delays a real published response, opens saved draft, delivers the old response and waits for completion/render frames. Draft remains selected. |
| Preview could create a learner session or expose answers | Response is a learner presentation DTO with source identity and learnerRuntime=false, not participation/attempt/session/private-answer data. Existing AssignmentView is reused; there are no start/save/submit commands in Preview. All-table HTTP write guards pass. |
| DB/API rollout could break old clients | 0137 adds a helper only; existing session_v2_context signature and touch behavior stay unchanged and tested. Apply E1 DB changes before the new app; the new app requires its expected schema. No deployment was performed, and full mixed-data E1 rollout remains a separate prerequisite. |
| Focused results could be mistaken for E1 completion | Recovery ancestry is preserved, no main convergence/merge or release candidate is claimed, full E1 gates/upgrade/journey and owner acceptance remain outstanding. |

Verdict: PASS for the bounded Preview implementation and its focused checks. Independent review and owner acceptance remain pending. No other E1 slice is selected by this receipt.
