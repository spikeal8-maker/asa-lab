-- Robotics stores one authored circuit/program/world document in Project Core.
-- Existing ownership, draft CAS, versions, RLS and learning capabilities stay intact.
ALTER TABLE public.projects
    DROP CONSTRAINT projects_module_key_check,
    ADD CONSTRAINT projects_module_key_check
    CHECK (module_key IN ('electronics', 'chess', 'three-d', 'checkers', 'blocks', 'robotics'));

-- Match the module registry's project creation capability without making
-- Robotics assignable, editable evidence or a learning-version submission.
UPDATE public.module_learning_capabilities
   SET creatable = true
 WHERE module_key = 'robotics';

ALTER TABLE public.product_analytics_events
    DROP CONSTRAINT product_analytics_events_module_key_check,
    ADD CONSTRAINT product_analytics_events_module_key_check
    CHECK (module_key IS NULL OR module_key IN ('electronics', 'three-d', 'chess', 'checkers', 'blocks', 'robotics'));

ALTER TABLE public.product_module_sessions
    DROP CONSTRAINT product_module_sessions_module_key_check,
    ADD CONSTRAINT product_module_sessions_module_key_check
    CHECK (module_key IN ('electronics', 'three-d', 'chess', 'checkers', 'blocks', 'robotics'));

-- Only the reviewed module enumerations change. CREATE OR REPLACE preserves
-- signatures, OIDs and grants; actor/context checks and historical rows remain.
DO $migration$
DECLARE
    definition text;
    updated text;
BEGIN
    definition := pg_get_functiondef('public.analytics_record_event(character varying,uuid,uuid,uuid,uuid,character varying,character varying,character varying,character varying,uuid,inet,character varying)'::regprocedure);
    updated := replace(definition,
        $old$'electronics', 'three-d', 'chess', 'checkers', 'blocks'$old$,
        $new$'electronics', 'three-d', 'chess', 'checkers', 'blocks', 'robotics'$new$);
    IF updated = definition THEN RAISE EXCEPTION 'robotics analytics event allowlist baseline changed'; END IF;
    EXECUTE updated;

    definition := pg_get_functiondef('public.analytics_start_module_session(uuid,character varying,uuid,uuid,uuid,uuid,character varying,uuid,inet,character varying,character varying)'::regprocedure);
    updated := replace(definition,
        $old$'electronics', 'three-d', 'chess', 'checkers', 'blocks'$old$,
        $new$'electronics', 'three-d', 'chess', 'checkers', 'blocks', 'robotics'$new$);
    IF updated = definition THEN RAISE EXCEPTION 'robotics analytics session allowlist baseline changed'; END IF;
    EXECUTE updated;

    definition := pg_get_functiondef('public.admin_get_product_dashboard(uuid,character varying,uuid,timestamp with time zone,timestamp with time zone,integer)'::regprocedure);
    updated := replace(definition,
        $old$('electronics'), ('three-d'), ('chess'), ('checkers'), ('blocks')$old$,
        $new$('electronics'), ('three-d'), ('chess'), ('checkers'), ('blocks'), ('robotics')$new$);
    IF updated = definition THEN RAISE EXCEPTION 'robotics analytics dashboard allowlist baseline changed'; END IF;
    EXECUTE updated;
END;
$migration$;
