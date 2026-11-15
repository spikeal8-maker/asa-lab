-- The browser uses V2 envelopes for module sessions and direct editor visits.
-- Extend only the canonical event enumerations; preserve authority, receipts,
-- validation, function identity and grants from the existing implementation.
DO $migration$
DECLARE
    definition text;
    updated text;
BEGIN
    definition := pg_get_functiondef('public.analytics_ingest_v2(uuid,character varying,uuid,uuid,uuid,uuid,uuid,character varying,jsonb,jsonb,timestamp with time zone)'::regprocedure);
    updated := replace(definition,
        $old$'electronics','three-d','chess','checkers','blocks'$old$,
        $new$'electronics','three-d','chess','checkers','blocks','robotics'$new$);
    IF updated = definition THEN RAISE EXCEPTION 'robotics V2 module allowlist baseline changed'; END IF;
    definition := updated;
    updated := replace(definition,
        $old$'home','projects','editor.electronics','editor.three-d','editor.chess','editor.checkers','editor.blocks','games','classes','learning','account','admin','public','unknown'$old$,
        $new$'home','projects','editor.electronics','editor.three-d','editor.chess','editor.checkers','editor.blocks','editor.robotics','games','classes','learning','account','admin','public','unknown'$new$);
    IF updated = definition THEN RAISE EXCEPTION 'robotics V2 entry route allowlist baseline changed'; END IF;
    EXECUTE updated;
END;
$migration$;
