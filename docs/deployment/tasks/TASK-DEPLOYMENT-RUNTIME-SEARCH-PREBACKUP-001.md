# Separate installed-runtime backup from target search requirements

Repair the portable manager's update preparation when a release introduces
search into an existing installation. `apply_release_environment` must continue
to pin and validate the target images, but those images must not become service
requirements of the previous runtime's pre-backup or backup-finally readiness.

Keep a separate installed-runtime Installation for the required backup. Preserve
the same installation root, Compose project/profile, private configuration,
backup/restore guards, source ancestry, exact release/CI/image validation and
post-switch search revision and health checks. Existing installed search remains
part of the old runtime's readiness. No Electronics, database schema, service,
port, release-policy or deployment changes belong to this source repair.

Regression evidence must exercise actual backup entry and finally/readiness for
old runtimes with and without search after target image selection; prove missing,
wrong-revision and unhealthy target search still fail. Verify an externally
located manager with an already-selected operational source retains the same
canonical source-history guard and does not cause a source switch.

Validation: `python -m unittest discover -s tools/deployment -p "test_*.py" -v`
and `node --test tools/blocks/deployment.test.mjs`. Tests use temporary files and
mock Docker/HTTP; they do not operate an installation. Independent review and
exact candidate CI precede any separately authorized update. Source author
reports the bounded result and stops.
