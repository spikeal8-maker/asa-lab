-- Avoid JIT compilation cost in the full-class teacher canonical projection.
-- Function-local setting preserves the body, SECURITY DEFINER, grants and search_path.
ALTER FUNCTION public.learning_canonical_evidence_for_teacher_account(uuid) SET jit = off;
