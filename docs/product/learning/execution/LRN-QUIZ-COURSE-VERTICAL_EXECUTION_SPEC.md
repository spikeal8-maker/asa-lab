# LRN-QUIZ-COMPLETE-COURSE-VERTICAL — Execution Spec

Task: TASK-LRN-COURSE-001 / Issue 179. Selected on canonical main 99fac4578.
Implementation baseline: 2d97266087b1cd11d8388cbfe02804e35eb8cb83 (approved Essay + Q1/Q2).
Requirement IDs: QUIZ-001–005, QUIZ-101–109, DB-000; existing result-selection, immutable submission and Course-completion contracts.

## Goal and existing authority

A compact eight-type Quiz can be authored, reopened, published, pinned in a Course,
answered by Seat/Account, submitted from its exact saved Attempt, graded automatically
or finished by teacher, and shown in the existing journal. Preserve Project and Essay.
No student file-answer storage, owner ClassroomPage changes or installation action.

Reuse question_bank_items / question_versions / separate question_answer_keys;
quiz_versions / mappings; learning_activities draft_revision/draft_payload;
Q2 quiz_attempt_states and its stable learner/optimistic concurrency;
learning_submissions / learning_evaluations / assessment_results;
learning_selected_result_internal / learning_gradebook_projection_sync_internal.
Legacy quiz_submission_create creates an Attempt at submit and cannot finalize Q2.
Its five grading rules are retained in one deterministic helper, extended with exact
matching/ordering. Manual questions have no automatic final grade.

## Physical schema decision (DB-000)

Existing immutable versions cannot store incomplete questions or Quiz composition.
Add only author draft/lineage/receipt storage from preserved Q3; do not create another
Attempt, Submission, gradebook or identity engine. The exact additive DDL below is
the approved design for the new forward migration (number provisional 0306).
Draft payloads hold bounded incomplete content. Publication validates complete definitions.
Author Quiz references stay in learning_activities.draft_payload.quizDraftId, not a
new bridge table. Published LAVs contain only an exact immutable quizVersionId.
Draft save keeps existing activity revision authority. Quiz content commands have
independent expected draft revisions and immutable scoped replay receipts.

```sql
-- Q3a: existing Question bank and private Quiz content roots/drafts/versions.
-- Draft numbering is provisional. No learner delivery or public publication.
-- Existing immutable rows/digests are never rewritten.
ALTER TABLE quiz_versions ALTER COLUMN learning_activity_version_id DROP NOT NULL;
ALTER TABLE quiz_versions ALTER COLUMN attempt_limit DROP NOT NULL;
ALTER TABLE quiz_versions ALTER COLUMN pass_threshold_basis_points DROP NOT NULL;
ALTER TABLE quiz_versions ALTER COLUMN feedback_release_policy DROP NOT NULL;
ALTER TABLE quiz_versions ADD CONSTRAINT quiz_versions_content_contract_check CHECK (
 (learning_activity_version_id IS NOT NULL AND attempt_limit IS NOT NULL AND pass_threshold_basis_points IS NOT NULL AND feedback_release_policy IS NOT NULL)
 OR (learning_activity_version_id IS NULL AND attempt_limit IS NULL AND time_limit_minutes IS NULL AND pass_threshold_basis_points IS NULL AND feedback_release_policy IS NULL)
);
CREATE TABLE quizzes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 owner_principal_id uuid NOT NULL REFERENCES principals(id), scope_kind varchar(16) NOT NULL DEFAULT 'personal' CHECK(scope_kind IN('personal','school')),
 legacy_origin_version_id uuid, created_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
 UNIQUE(tenant_id,id), UNIQUE(legacy_origin_version_id),
 FOREIGN KEY(tenant_id,legacy_origin_version_id) REFERENCES quiz_versions(tenant_id,id)
);
CREATE TABLE question_author_drafts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), question_id uuid PRIMARY KEY,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 base_version_id uuid, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,question_id) REFERENCES question_bank_items(tenant_id,id),
 FOREIGN KEY(tenant_id,base_version_id) REFERENCES question_versions(tenant_id,id)
);
CREATE TABLE quiz_author_drafts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), quiz_id uuid PRIMARY KEY,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 base_version_id uuid, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,quiz_id) REFERENCES quizzes(tenant_id,id),
 FOREIGN KEY(tenant_id,base_version_id) REFERENCES quiz_versions(tenant_id,id)
);
CREATE TABLE quiz_version_lineage (
 tenant_id uuid NOT NULL REFERENCES tenants(id), quiz_id uuid NOT NULL, version_number integer NOT NULL CHECK(version_number>0),
 quiz_version_id uuid NOT NULL, representation varchar(16) NOT NULL CHECK(representation IN('legacy','content')),
 content_flags jsonb NOT NULL DEFAULT '{"shuffleQuestions":false,"shuffleOptions":false}'::jsonb,
 PRIMARY KEY(quiz_id,version_number), UNIQUE(quiz_version_id),
 FOREIGN KEY(tenant_id,quiz_id) REFERENCES quizzes(tenant_id,id),
 FOREIGN KEY(tenant_id,quiz_version_id) REFERENCES quiz_versions(tenant_id,id)
);
CREATE TABLE learning_content_command_receipts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), owner_principal_id uuid NOT NULL REFERENCES principals(id),
 command_scope varchar(64) NOT NULL, operation varchar(32) NOT NULL,
 request_id varchar(128) NOT NULL, question_id uuid, quiz_id uuid, source_revision integer,
 expected_head_id uuid, payload_digest varchar(64) NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,owner_principal_id,command_scope,operation,request_id),
 CHECK(num_nonnulls(question_id,quiz_id)=1),
 CHECK(operation IN('question.create','question.save','question.publish','question.publish.in_quiz','quiz.create','quiz.save','quiz.publish')),
 CHECK(source_revision IS NULL OR source_revision>0),
 FOREIGN KEY(tenant_id,question_id) REFERENCES question_bank_items(tenant_id,id),
 FOREIGN KEY(tenant_id,quiz_id) REFERENCES quizzes(tenant_id,id)
);
CREATE UNIQUE INDEX question_content_published_draft_idx ON learning_content_command_receipts(question_id,source_revision)
 WHERE operation IN('question.publish','question.publish.in_quiz');
CREATE UNIQUE INDEX quiz_content_published_draft_idx ON learning_content_command_receipts(quiz_id,source_revision)
 WHERE operation='quiz.publish';
CREATE TRIGGER quiz_version_lineage_immutable BEFORE UPDATE OR DELETE ON quiz_version_lineage
 FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
CREATE TRIGGER learning_content_command_receipts_immutable BEFORE UPDATE OR DELETE ON learning_content_command_receipts
 FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['quizzes','question_author_drafts','quiz_author_drafts','quiz_version_lineage','learning_content_command_receipts'] LOOP
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,asalab_app',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON public.%I USING (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',t||'_tenant',t);
 END LOOP;
END $$;

```

All new tenant-scoped draft/lineage/receipt tables use FORCE RLS, tenant equality,
no direct asalab_app SELECT/UPDATE grants, and narrow SECURITY DEFINER RPCs with
fixed search_path. FK pairs prevent cross-tenant references. Existing question and
Quiz immutable versions/digests remain byte-identical. Legacy bridge inserts only
new lineage; never updates an old published version. No destructive rollback:
unpublished source may be reverted; once applied this is forward-only.

## Runtime storage and transactions

Reuse immutable learning_submissions.payload_manifest for frozen Quiz content,
confirmed saved answers, sourceRevision, scoring evidence and pending-manual markers.
Do not insert fictitious correctness for manual items into attempt_answers.
Automatic evaluation uses existing learning_evaluations evidence. Final assessment
revision is created only after all manual work is complete, through existing review.
No new runtime table is needed. Submit request (actor, Attempt, expectedVersion,
requestId) locks Attempt then quiz_attempt_states; duplicate replay verifies same
request and revision. Save/submit/expiry serialize on the same Attempt row.

attemptPolicy.expirationPolicy = auto_submit | expire_without_submission;
missing normalizes to auto_submit. Freeze it in existing Q2 policy_snapshot. Existing
expires_at is the authority. Extend existing LearningRemindersService with a bounded
idempotent SQL expiry sweep (FOR UPDATE SKIP LOCKED); no new service. Saved server
answers only. No answer mutation after expiry. Client timestamps never authorize.

Matching uses stable left IDs paired with stable right IDs, rejects duplicate/foreign
IDs, and awards full points only for exact complete matching. Ordering uses a stable
ID sequence, rejects duplicates/foreign IDs, awards full points only for exact order.
Existing single/multiple/boolean/numeric/short-text rules retain their behavior.
long_text_manual is bounded text; automatic points are provisional until teacher
final review. Learner DTO excludes keys until server-enforced feedback release.
Legacy five-type finalizer rejects unsupported content before any write.

## API / UI boundaries

Existing author capability/tenant checks guard content draft commands; question
ownership is checked independently of Quiz ownership. Publish validates/locks all
references before producing versions, with scoped revision/idempotency checks.
Extend LearningActivitiesController draft read/write and publication bridge;
LearningQuizAttemptsController start/read/save/submit; exact teacher reader in
LearningAssessmentsController. No generic verification bypass.

AuthoredMaterialsPage + compact Quiz editor share existing Save/Publish/Add-to-lesson
buttons and CourseEditorDialog. SeatCourses dispatches a compact Quiz player with
autosave, reload, conflict recovery and server timer. ClassroomGradebook exact typed
reader renders immutable questions/answers and manual pending review. api.ts and
OpenAPI carry typed contracts. Relevant helpers are part of this logical slice;
this path inventory is not a permission lease.

## Acceptance and preservation

Focused PG: eight types, bank ACL/key isolation, draft reopen and invalid publish,
exact published pins, frozen Start, save/reload/conflict, same Attempt submit replay,
submit/expiry races, both expiry policies, feedback modes, provisional exclusion,
manual final revision/journal/completion, legacy five-type preservation.
Actual browser: author→save→reopen→publish→Course→Seat/Account answer→reload→submit→
auto/manual review→journal at the existing four widths including 320/390, no page
overflow, existing Project/Essay journeys retained. All gates retain full assertions.
Final dependency convergence happens once, then exact-SHA focused and General gates
and independent review. No installed/owner acceptance claim from CI alone.
