# Documentation Foundation — challenge review

**Scope:** DOC-M0, DOC-M0.5 and the Learning vertical pilot of DOC-M1.

This is a review receipt, not live execution state and not owner acceptance.

## What was challenged

The review attempted to disprove the safety and usefulness of the new maintenance-documentation layer rather than merely confirm the happy path.

Checked boundaries:
- document authority and exact revision drift;
- Domain Contract → Master/ADR traceability;
- Surface/Control ID uniqueness;
- implementation-path and executable-test existence;
- targeted context by path, surface and control;
- context-size fail-closed behavior;
- wrong-scope and path-traversal rejection;
- historical-document routing;
- UTF-8 integrity of modified documentation/tooling.
## Defects found and fixed

1. `LRN_COURSE_01.md` still instructed agents to update current checkpoint in a second file. It now explicitly keeps mutable state in `docs/execution/current.yaml` only.
2. Early PowerShell edits corrupted Unicode in documentation and the governance shell. A byte/codepoint audit exposed this; affected files were restored from clean Git bytes and reapplied with UTF-8-safe tooling.
3. Compact master references were only syntactically non-empty. They now fail if an `ATT/ASM/...` anchor or numbered `§` heading does not exist in the registered Master/ADR.
4. `agent:context` initially knew the registry but not addressed surfaces. It now resolves `--path`, `--surface` and `--control` and fails instead of guessing an unmapped path.
5. Surface tests could have named invented `TST-*` IDs. They now must resolve to an executable test registry entry.
6. A registered-but-not-routed ADR was incorrectly labelled unregistered. Regression coverage now distinguishes registration from current routing.

## Negative evidence

Confirmed failures for:
- stale canonical revision on an active strict task;
- unknown registered document reference;
- missing Master anchor;
- missing implementation path;
- unknown invariant;
- unregistered test ID;
- unsafe `../` repository path;
- target forced into the wrong bounded-context scope;
- targeted context exceeding the 8,000-character budget.
## Verified result

A Learning change can now resolve a compact context pack without reading the full Learning Master by default. The real `ClassroomGradebook.tsx` path resolves to the Learning surface, implementation files, stable invariant IDs, executable tests and precise escalation sections. L3 controls require both post-step and challenge review.

The tested real Learning packs remain below the 8,000-character targeted budget; unmapped paths fail closed instead of silently broadening context.

Full `gate:governance` passed after the fixes, including control-plane, document-registry, task-document revision, targeted-context, maintenance-doc, architecture, project-map, test-catalog and owner-asset checks.

## Intentionally not completed in this slice

- Identity/Access compact contract and surfaces;
- root-policy cleanup of `AGENTS.md`;
- conversion of the registry from partial to full coverage;
- rollout to Projects, Electronics, 3D, Chess, Admin and Visual Programming;
- any Learning E1 product-code repair;
- publication, merge or production deployment.

## Verdict

**PASS for the Documentation Foundation + Learning routing pilot.** Continue with the documented rollout order; this receipt does not authorize product deployment or claim that Learning E1 is complete.
