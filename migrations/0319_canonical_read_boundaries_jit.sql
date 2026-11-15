-- Keep JIT local to the measured class-rating and canonical read boundaries.
-- Preserve function bodies, identity, privileges and every other setting.
ALTER FUNCTION public.classroom_participant_metrics(uuid) SET jit = off;
ALTER FUNCTION public.learning_canonical_evidence_for_seat(uuid) SET jit = off;
ALTER FUNCTION public.learning_canonical_evidence_for_account(uuid) SET jit = off;
ALTER FUNCTION public.learning_canonical_evidence_for_teacher(uuid, uuid) SET jit = off;
