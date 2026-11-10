# Immutable learner file answers

TASK-LRN-COURSE-001 / LRN-IMMUTABLE-FILE-ANSWERS. Source baseline 28a39f4c.

## DB-000

The existing activity draft and version already accept the file kind. Course pins,
participations, learner identity, attempts, submissions, assessment results and
journal stay canonical. Essay drafts cannot represent a verified object or
enforce an attempt-scoped object foreign key. Blocks metadata authorizes editor
assets, and AI metadata binds files to an AI actor and lifecycle. Neither is
an appropriate authority for a course response. Reuse the configured private
bucket, not either subsystem's metadata or public delivery path.

One file per draft revision. Replacements create immutable metadata versions.
A submitted manifest contains the exact file descriptor and revision and binds
it to the same Attempt. Rework starts with an empty file slot. A download
resolves through the learner's exact current draft or submitted Attempt, or an
educator's authorized exact submission. A client cannot supply an object key.
Submission and review never write the bytes or copy them across tenants.

Physical schema for forward migration 0316. The composite primary and foreign
keys also support attempt-scoped lookup; deletes use the default NO ACTION.
No new row receives an application-role table grant.

```sql
CREATE TABLE public.learning_file_versions (
  tenant_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 255 AND octet_length(name)<=1020),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND CASE
    WHEN content_type='application/pdf' THEN 25000000
    WHEN content_type LIKE 'image/%' THEN 20000000 ELSE 50000000 END),
  content_type varchar(80) NOT NULL CHECK (content_type IN (
    'application/pdf','text/plain','text/csv','image/png','image/jpeg','image/webp',
    'application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/x.scratch.sb3','model/stl')),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,attempt_id,id),
  FOREIGN KEY (tenant_id,attempt_id) REFERENCES public.learning_attempts(tenant_id,id)
);
CREATE TABLE public.learning_file_drafts (
  tenant_id uuid NOT NULL,
  attempt_id uuid PRIMARY KEY,
  revision integer NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 2147483646),
  file_id uuid,
  saved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,attempt_id) REFERENCES public.learning_attempts(tenant_id,id),
  FOREIGN KEY (tenant_id,attempt_id,file_id) REFERENCES public.learning_file_versions(tenant_id,attempt_id,id)
);
CREATE TABLE public.learning_file_command_receipts (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  actor_principal_id uuid NOT NULL REFERENCES public.principals(id),
  request_id varchar(128) NOT NULL CHECK (request_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
  request_digest varchar(64) NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  activity_run_id uuid NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY(actor_principal_id,request_id),
  FOREIGN KEY(tenant_id,activity_run_id) REFERENCES public.activity_runs(tenant_id,id)
);
CREATE TRIGGER learning_file_versions_immutable BEFORE UPDATE OR DELETE ON public.learning_file_versions
FOR EACH ROW EXECUTE FUNCTION public.learning_immutable_row();
CREATE TRIGGER learning_file_receipts_immutable BEFORE UPDATE OR DELETE ON public.learning_file_command_receipts
FOR EACH ROW EXECUTE FUNCTION public.learning_immutable_row();
DO $$
DECLARE item text;
BEGIN
  FOREACH item IN ARRAY ARRAY['learning_file_versions','learning_file_drafts','learning_file_command_receipts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',item);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',item);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,asalab_app',item);
  END LOOP;
END $$;
```

## Transport

Seat or Account authority precedes bounded binary ingestion. Admit only
independently validated allowlist formats. PDF 25,000,000 bytes, supported images
20,000,000 bytes, other supported formats 50,000,000 bytes. Store under
learning/answers/v1/tenants/{tenant}/attempts/{attempt}/{sha256} via conditional
write with content checksum. Read verifies exact size and digest. No object
key, bucket URL or client MIME acts as authorization. Attachments download with
private/no-store, nosniff and sandbox; no automatic preview or execution.

An object write precedes its immutable DB receipt. Retry addresses the same
content key and uses request fingerprint and expected revision at DB commit.
An unconfirmed object is unreachable without a successful metadata commit.
No deletion is attempted for uncertain writes. Preserve the existing limits,
read authorization and activity status policies.


## Enabled formats

PDF, DOCX, PPTX, XLSX, TXT, CSV, SB3, STL, INO, ZIP, PNG, JPEG and WebP.
Archives have a bounded, single-volume central directory, matched local entries,
a 50,000,000-byte expanded entry cap, a 200,000,000-byte aggregate expansion
cap and a path and entry policy. Every entry is streamed to verify its exact
expanded length and CRC without retaining its expanded bytes. Only the small
bounded manifest is interpreted for Office or Scratch. Standard Scratch media remain inert
inside the downloaded attachment. No container is extracted to disk or
executed. Standalone active formats and macro-enabled Office archives are
rejected.
