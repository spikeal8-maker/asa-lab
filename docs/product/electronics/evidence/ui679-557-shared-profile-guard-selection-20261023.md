# UI679/557: separate published profile-guard baseline repair

Dated selection, 23 October 2026. Status remains canonical only in current.yaml.
This selection supplements the existing six-case technical qualification; it does
not repeat or widen the product/test repair selection.

## Concrete independent baseline mismatch

The original published `.github/workflows/electronics-r4-m1-focused.yml` now
includes `arduino-editor-error`, introduced by foreign Arduino editor work
8fa79c0c. Its original transport guard in `tools/test_ci_image_transport.py`
retains QUALIFICATION_INPUT with only strict-real-time, classroom-d13-v2 and
classroom-d13-v3. The guard's self-test reports Missing/narrowed mandatory trigger.
The scoped infrastructure author and the authorized Arduino controller independently
confirmed this categoryC shared test-guard mismatch. Do not fix it by deleting the
published profile, modifying the original workflow or spoofing workflow identity.

Fresh snapshot for this docs selection: main a22d4007ea4e89d16c97bfe540984374a382d21d;
General6c95 is cancelled E, not PASS; newer main CI is in_progress/queued and is
not inferred successful. Mobile-status was clean and fast-forwarded; all74 worktrees
had zero dirty overlaps with these two docs. Foreign project-snapshot/classroom
baseline changes remain preserved. This is not runtime or product acceptance.

## One separate bounded repair author

The scoped infrastructure author remains the only writer of its new six-case
workflow/browser identity pair. Freeze that author before any second author
writes the shared guard. Then select ONE baseline author for the exact published
original workflow four-profile declaration and strict meaningful tests in
`tools/test_ci_image_transport.py`. Preserve the scoped identity pair byte-exact
and all original image, PostgreSQL, source/runtime and artifact restrictions.

The accepted declaration is exactly strict-real-time, classroom-d13-v2,
classroom-d13-v3 and arduino-editor-error, with strict-real-time still the default.
Retain existing v2/v3 behavior. Add unknown-profile, narrowed-profile and changed-
default negative controls; broad acceptance of arbitrary profile strings is
forbidden. No original workflow changes, product changes, assertion weakening,
cap change, dependency edit or new native qualification run belongs to this repair.

Fresh real target-overlap checks and explicit single-writer handoff apply. A stale
foreign worktree's already-published guard blob is not a license to overwrite any
new unpublished change. One separate baseline commit, meaningful self-tests and a
NEW independent exact-source review precede integration with the scoped candidate.
Do not create a competing guard author while the scoped author is editing it.

Full six-case native technical acceptance, full General/focused/RAW budget and NEW
actual review remain required; global Electronics cancellation remains non-PASS,
with no release/deployment/physical owner acceptance claim. OwnerKEEP544/547,
548 blocker, accepted541, foreign682 and every protected source remain unchanged.
Only current679/557 qualification notes and this receipt are selected now.
