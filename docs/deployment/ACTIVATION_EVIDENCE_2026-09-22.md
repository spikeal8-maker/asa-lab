# Portable activation evidence — 22 September 2026

The owner authorized merging the portable mechanism, enabling Sunday maintenance,
repairing release blockers and testing an update of the existing installation.
[PR 379](https://github.com/spikeal8-maker/asa-lab/pull/379) was merged.
Technical activation completed; this record does not grant owner acceptance of
unrelated product milestones or authorize a live database restore.

## Verified release

Application revision: `f150219098d5f2a92239cf438d52dc063def5359`, schema 159.

- [General CI](https://github.com/spikeal8-maker/asa-lab/actions/runs/35663513172): PASS.
- [Portable delivery checks](https://github.com/spikeal8-maker/asa-lab/actions/runs/35663513177): PASS, including Windows/Linux contracts and image backup/restore smoke tests.
- [Actual publication](https://github.com/spikeal8-maker/asa-lab/actions/runs/35664282187): PASS; every build and publish job completed, none was skipped.
- [Electronics focused checks](https://github.com/spikeal8-maker/asa-lab/actions/runs/35660288630): PASS on production repair `8c4a6fa9`, including benchmark and browser. Later changes were bounded test/manager repairs, also covered by final general CI.
- Independent reviews of `8c4a6fa9`, `d6b50706` and `f1502190`: PASS.

The first publication exposed GitHub's dynamic run name in REST metadata. The
client correction is documented in [RELEASE_ACTIVATION_REPAIR.md](RELEASE_ACTIVATION_REPAIR.md).
The corrected client verified real published metadata without bypassing the gate.
All five package names were confirmed anonymously readable from the registry;
installation does not require a GitHub Packages credential.

## Existing Windows installation

The canonical SSD installation was updated using `asa_manager.py update --profile dev`.
From invocation to successful completion: **91.3 seconds**, with Docker layers
already cached by release preparation. This is one measured update, not a guaranteed
time for a clean machine, a larger database or a slower connection.

- A complete pre-update backup was created and verified: 49 files, running source
  revision `62787aa5f8addf1e1e5c6e3b242f53ee7aa851d8`.
- The migration preflight found zero pending migrations. Schema stayed at 159.
- Web, API and Scratch all reported `f1502190` and passed readiness checks.
- The PostgreSQL container identity and both persistent volume identities matched
  the recorded pre-update state. The working database was not restored or replaced.
- No unfinished maintenance or failed-switch marker remained.
- A second `update` returned `NO_CHANGE`, without another backup or restart.
- Automatic updates stayed enabled for Sunday 03:00–05:00 Moscow. Windows Task
  Scheduler executions outside that window exited successfully without updating.

Local backup paths, private settings and operational logs are kept on the owner's
computer and are not included in this repository. Old-computer data migration and
cloud backup are outside this completed activation.

## Observed build cache benefit

The Scratch image job took 6m 06s in the first publication
([run 35662408770](https://github.com/spikeal8-maker/asa-lab/actions/runs/35662408770)),
then 38s in the second publication with unchanged upstream build inputs. This
measures the Scratch job, not the duration of all CI or an end-user installation.
The operator installation downloads ready images and does not compile Scratch.

Use [PORTABLE_OPERATIONS.md](PORTABLE_OPERATIONS.md) for fresh installation,
maintenance, export and recovery checks. Windows scheduling requires the user's
session and running Docker Desktop; Linux uses systemd and Docker Engine.
