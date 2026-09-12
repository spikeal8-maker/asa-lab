# Electronics deployment task template

Use only after implementation/integration is accepted. Deployment is never an automatic continuation of coding.

## Target

```text
Exact GitHub SHA: <immutable commit>
Reason for deployment: <accepted milestone/fix>
Current deployed revision: <read from /api/version>
```

If `main` advances while this task runs, the target SHA does not silently change.

## Preflight audit

Record:

```text
code delta
compose/env delta
migration/schema delta
new/removed services
ports/network changes
secrets/config requirements
current container/image provenance
```

Unexpected destructive persistence/RLS/schema change is STOP/CRITICAL review.

## Candidate proof

Where practical:

```text
build candidate API/Web images with exact revision label
run docker compose config
start isolated candidate stack/database
run migration entrypoint
verify health/version/schema
verify Electronics browser journey / worker asset when relevant
```

## Rollback prepared before switch

```text
DB logical dump if persistence is in scope/risk warrants it
DB globals/restore metadata where relevant
copy private env/local compose overrides
record old image IDs/tags
record old deployed SHA/schema
write exact rollback command/path
```

No live switch before rollback evidence exists.

## Live switch

Use only the canonical deployment checkout identified by running Compose labels. Do not deploy from a feature worktree or stale clone.

Preserve PostgreSQL volume/container unless an explicit migration task requires otherwise.

## Acceptance

Verify after switch:

```text
container health
/api/version exact target SHA
schemaVersion == expectedSchemaVersion when guard is configured
health endpoints
external public route
one relevant user journey
Electronics Worker asset/browser path when this release changes simulation execution
```

Any required acceptance failure triggers rollback, not ad-hoc live debugging that changes product code.

## Evidence report

```text
TARGET_SHA
PREVIOUS_SHA
MIGRATIONS_APPLIED
DB_RESTARTED: yes/no
BACKUP_PATH
ROLLBACK_IMAGE_TAGS
LOCAL_HEALTH
EXTERNAL_HEALTH
VERSION_SCHEMA
USER_FLOW
ROLLBACK_USED: yes/no
```

## Forbidden

```text
no deploy of moving main
no git pull && compose up without exact target audit
no destructive volume reset
no product-code edits during deployment
no deletion of rollback package immediately after success
```

## Stop

After post-deploy acceptance, STOP. New development starts as a new task/context.