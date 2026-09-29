-- A4-2a: Attempt numbers belong to one ActivityParticipation. Legacy rows
-- without a participation keep their original handout/seat number identity.
-- No historical Attempt is rewritten or assigned inferred participation.

CREATE UNIQUE INDEX learning_attempts_legacy_handout_seat_number_idx
    ON public.learning_attempts (classroom_assignment_id, seat_id, attempt_number)
    WHERE activity_participation_id IS NULL;

CREATE UNIQUE INDEX learning_attempts_participation_number_idx
    ON public.learning_attempts (activity_participation_id, attempt_number)
    WHERE activity_participation_id IS NOT NULL;

-- PostgreSQL truncates the implicit 0077 constraint name to 63 bytes. Resolve
-- the exact old UNIQUE by its ordered columns and fail closed if it changed.
DO $$
DECLARE
    v_constraint text;
    v_count integer;
BEGIN
    SELECT count(*), min(candidate.conname::text)
      INTO v_count, v_constraint
      FROM pg_catalog.pg_constraint candidate
     WHERE candidate.conrelid = 'public.learning_attempts'::regclass
       AND candidate.contype = 'u'
       AND (
           SELECT array_agg(attribute.attname::text ORDER BY column_key.ordinality)
             FROM unnest(candidate.conkey) WITH ORDINALITY AS column_key(attnum, ordinality)
             JOIN pg_catalog.pg_attribute attribute
               ON attribute.attrelid = candidate.conrelid
              AND attribute.attnum = column_key.attnum
       ) = ARRAY['classroom_assignment_id', 'seat_id', 'attempt_number'];

    IF v_count <> 1 THEN
        RAISE EXCEPTION 'expected one legacy learning_attempts handout/seat/number UNIQUE, found %',
            v_count;
    END IF;

    EXECUTE format('ALTER TABLE public.learning_attempts DROP CONSTRAINT %I', v_constraint);
END;
$$;
