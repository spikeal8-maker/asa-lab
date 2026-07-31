# ASA Lab — owner reference index

This index is the canonical entry point for owner-provided video evidence and the interface/project structure derived from it.

## Source recordings

The original MP4 files are private evidence and are not committed to Git. Their source filenames, durations, frame counts and available hashes are recorded in the evidence documents below.

## Video evidence

1. [`reference/TINKERCAD_OWNER_VIDEO_2026-07-27.md`](reference/TINKERCAD_OWNER_VIDEO_2026-07-27.md) — creator portal, projects, account/settings, Circuits editor, class workspace and learner project viewer.
2. [`reference/TINKERCAD_REGISTRATION_STUDENT_VIDEO_2026-07-27.md`](reference/TINKERCAD_REGISTRATION_STUDENT_VIDEO_2026-07-27.md) — registration, child approval, registered-student class join, Safe Mode, badges and student portal.
3. [`reference/TINKERCAD_EDUCATOR_CLASSROOM_VIDEO_2026-07-27.md`](reference/TINKERCAD_EDUCATOR_CLASSROOM_VIDEO_2026-07-27.md) — educator registration, capability grant, class creation, StudentSeat provisioning, learner login and teacher supervision.

Each evidence set also includes machine-readable YAML and a CSV timeline. The first recording additionally has a detailed report.

## Product and architecture structure

- [`ASA_TARGET_PLATFORM_BLUEPRINT.md`](ASA_TARGET_PLATFORM_BLUEPRINT.md) and [`ASA_TARGET_PLATFORM_BLUEPRINT.yaml`](ASA_TARGET_PLATFORM_BLUEPRINT.yaml) — complete platform model.
- [`../architecture/ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md`](../architecture/ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md) — non-destructive Account/Principal/Workspace transition.
- [`TINKERCAD_PARITY_SPEC.md`](TINKERCAD_PARITY_SPEC.md), [`TINKERCAD_PARITY_MATRIX.yaml`](TINKERCAD_PARITY_MATRIX.yaml), [`TINKERCAD_PARITY_DEVIATIONS.yaml`](TINKERCAD_PARITY_DEVIATIONS.yaml) — reference parity and permitted deviations.

## Interface structure

- [`ASA_COMPLETE_INTERFACE_BLUEPRINT.md`](ASA_COMPLETE_INTERFACE_BLUEPRINT.md) — Public, Creator Portal, Classroom, Learner, Editor and Admin shells.
- [`ASA_PRODUCT_SURFACE_CATALOG.yaml`](ASA_PRODUCT_SURFACE_CATALOG.yaml) — routes, actors, actions, states and screenshot gates.
- [`interface-catalog.html`](interface-catalog.html) — owner-readable page catalog.
- [`page-wireframes.html`](page-wireframes.html) — generated structural wireframes for the catalogued pages.
- [`ASA_VISUAL_PRODUCT_SYSTEM.md`](ASA_VISUAL_PRODUCT_SYSTEM.md) — visual density, navigation, cards, tables, states and responsive rules.

## Focused specifications

- [`ASA_AUTH_ENTRY_UX_SPEC.md`](ASA_AUTH_ENTRY_UX_SPEC.md) — entry, registration and class access.
- [`ASA_STUDENT_EXPERIENCE_SPEC.md`](ASA_STUDENT_EXPERIENCE_SPEC.md) — registered learner and StudentSeat experience.
- [`TINKERCAD_EDUCATOR_CLASSROOM_PARITY_SPEC.md`](TINKERCAD_EDUCATOR_CLASSROOM_PARITY_SPEC.md) — educator and classroom flow.
- [`ASA_ELECTRONICS_WORKBENCH_COMPLETE_SPEC.md`](ASA_ELECTRONICS_WORKBENCH_COMPLETE_SPEC.md) and [`ASA_ELECTRONICS_TOOL_CATALOG.yaml`](ASA_ELECTRONICS_TOOL_CATALOG.yaml) — complete Electronics workbench/tool scope.
- [`ASA_ADMIN_CONSOLE_SPEC.md`](ASA_ADMIN_CONSOLE_SPEC.md) — school and platform administration.
- [`ASA_TINKERCAD_100_PERCENT_SCOPE.yaml`](ASA_TINKERCAD_100_PERCENT_SCOPE.yaml) — functional-parity claim rules.

## Current R2 rule

`TASK-CREATOR-PORTAL-001` must use the three video reports, the complete interface blueprint, the surface catalog and the Visual Product System as design inputs. It must not reduce the target to the sparse current Account page or invent a new information architecture.
