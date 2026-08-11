# ASA Lab — Development Program

Machine contract: [`EXECUTION_MANIFEST.yaml`](EXECUTION_MANIFEST.yaml)

Current state: [`../execution/current.yaml`](../execution/current.yaml)

Project map: [`../project-map/project-map.yaml`](../project-map/project-map.yaml)

Stable tests: [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml)

Active tests: [`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml)

## Current executable queue

```text
TASK-PRODUCT-DOC-001              done
→ TASK-PORTAL-001                 done
→ TASK-ACCOUNT-C1-001             done
→ TASK-CREATOR-PORTAL-001         done
→ TASK-R3A-ELECTRONICS-GATEWAY-001 done
→ TASK-ELECTRONICS-M1-001         blocked / owner-paused
→ TASK-3D-M0-001                  blocked / owner-paused
→ TASK-CHECKERS-M1-001            in_progress
→ owner review / stop
```

Active branch: `agent/checkers-education-m1`. Issue: #98. Draft PR: #101.

## R11-M1 user result

```text
Student opens Checkers
→ sees current learning, assignments, games, bot ladder and review queue
→ completes self-learning or teacher work
→ plays a legal Russian-draughts game
→ receives review and concept mastery update
→ teacher sees activity and exact move-level evidence
→ class play uses predefined reactions without free-form chat
```

## Product boundary

The task builds one independent first-party Checkers module. It may reuse stable
ASA contracts and visual patterns, including the Electronics project-header
pattern, but it does not import Chess subject logic or modify Chess,
Electronics or 3D behaviour.

The first ruleset is official Russian draughts-64 on an 8×8 board. Additional
regional variants remain future work.

## Delivery checkpoints

1. market and product contract;
2. rules and Project Core vertical slice;
3. curriculum, assignments and progress;
4. bots and post-game review;
5. safe class play;
6. hardening and owner acceptance.

## Safety boundary

- no child-authored chat, messages, links, images, voice or video;
- no global child directory or unrestricted public matchmaking;
- class-scoped challenges only;
- server-defined reactions with rate limits, mute and audit;
- teacher feedback is an authorised assignment record, not a chat channel.

## Gate

```bash
pnpm gate:governance
pnpm gate:checkers-m1
pnpm gate:checkers-m1:browser
pnpm gate:repository
```

The focused commands become PASS only when real executable tests and browser
journeys pass on one exact SHA. The repository gate still requires PostgreSQL.

## Browser evidence

Student and educator, desktop/tablet/mobile, live API/PostgreSQL, project
persistence, assignment evidence, bot progression and a safe class game.

```text
console errors = 0
pageerror = 0
unexpected requestfailed = 0
unexpected HTTP 5xx = 0
```

## Stop

PR #101 remains Draft until focused and general gates, evidence and owner review
are complete. Merge, tag and activation of another task require a separate owner
decision.
