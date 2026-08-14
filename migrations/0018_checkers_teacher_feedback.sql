-- Checkers-specific teacher guidance. Feedback is a fixed educational
-- allowlist rather than child-authored messaging and is isolated per learner.

CREATE TABLE IF NOT EXISTS checkers_teacher_feedback (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    project_id      uuid NOT NULL,
    classroom_id    uuid NOT NULL,
    student_user_id uuid NOT NULL,
    teacher_user_id uuid NOT NULL,
    feedback_id     varchar(32) NOT NULL
                    CHECK (feedback_id IN ('great-progress', 'retry-capture',
                                           'review-turning-point', 'ready-next')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id),
    FOREIGN KEY (tenant_id, student_user_id) REFERENCES users (tenant_id, id),
    FOREIGN KEY (tenant_id, teacher_user_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS checkers_teacher_feedback_student_idx
    ON checkers_teacher_feedback (tenant_id, project_id, student_user_id, created_at DESC);

GRANT SELECT, INSERT ON checkers_teacher_feedback TO asalab_app;
ALTER TABLE checkers_teacher_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkers_teacher_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY checkers_teacher_feedback_tenant ON checkers_teacher_feedback
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
