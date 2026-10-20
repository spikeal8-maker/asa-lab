-- E1-FIX-06: read exact historical dependencies without rewriting a release.
-- The caller cannot supply an arbitrary activity pin: every candidate comes
-- from this author's exact immutable CourseVersion. Archived owned content is
-- historical evidence; current assignment/module availability is irrelevant.
CREATE OR REPLACE FUNCTION public.course_author_versions(p_principal uuid,p_course uuid)
RETURNS TABLE(id uuid,version_number integer,outline jsonb,published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT release.id,release.version_number,release.outline,release.published_at
    FROM public.courses course
    JOIN public.course_versions release ON release.course_id=course.id
      AND release.tenant_id=course.tenant_id
   WHERE course.id=p_course AND course.owner_principal_id=p_principal
     AND public.learning_author_can_use_tenant(p_principal,course.tenant_id)
   ORDER BY release.version_number DESC;
$$;
REVOKE ALL ON FUNCTION public.course_author_versions(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_author_versions(uuid,uuid) TO asalab_app;

CREATE FUNCTION public.course_author_version_pins(
  p_principal uuid, p_course uuid, p_course_version uuid
)
RETURNS TABLE (
  pointer text, pin_kind varchar, available boolean,
  activity_id uuid, version_id uuid, version_number integer,
  title varchar, instructions varchar, goal varchar, blocks jsonb,
  module_key varchar, result_mode varchar, max_points integer,
  policy_snapshot jsonb, content_digest varchar
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  WITH owned AS (
    SELECT release.outline, course.tenant_id, course.owner_principal_id
      FROM public.courses course
      JOIN public.course_versions release ON release.course_id = course.id
        AND release.tenant_id = course.tenant_id
     WHERE course.id = p_course AND release.id = p_course_version
       AND course.owner_principal_id = p_principal
       AND public.learning_author_can_use_tenant(p_principal, course.tenant_id)
  ), lessons AS (
    SELECT owned.tenant_id, owned.owner_principal_id, lesson.value AS body,
      '/sections/' || (section.ordinality - 1) || '/lessons/' ||
        (lesson.ordinality - 1) AS lesson_pointer
      FROM owned
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(owned.outline->'sections') = 'array'
          THEN owned.outline->'sections' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS section(value, ordinality)
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(section.value->'lessons') = 'array'
          THEN section.value->'lessons' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS lesson(value, ordinality)
  ), pointers AS (
    SELECT tenant_id, owner_principal_id, lesson_pointer || '/assignment' AS pointer,
      'project'::varchar AS pin_kind,
      CASE WHEN body ? 'learningActivityVersionId'
                  AND body->'learningActivityVersionId' <> 'null'::jsonb
        THEN body->'learningActivityVersionId'
        ELSE body->'assignment'->'learningActivityVersionId' END AS raw_version
      FROM lessons
     WHERE body->>'kind' = 'assignment'
        OR jsonb_typeof(body->'assignment') = 'object'
        OR body->'learningActivityVersionId' <> 'null'::jsonb
    UNION ALL
    SELECT tenant_id, owner_principal_id,
      lesson_pointer || '/blocks/' || (block.ordinality - 1),
      CASE WHEN block.value->>'type' = 'manual-material'
        THEN 'manual' ELSE 'project' END::varchar,
      block.value->'learningActivityVersionId'
      FROM lessons
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(body->'blocks') = 'array'
          THEN body->'blocks' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS block(value, ordinality)
     WHERE block.value->>'type' IN ('activity', 'manual-material')
  ), pins AS (
    SELECT pointers.*,
      CASE WHEN jsonb_typeof(raw_version) = 'string'
        AND (raw_version #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (raw_version #>> '{}')::uuid END AS requested_version
      FROM pointers
  )
  SELECT pin.pointer, pin.pin_kind, exact.version_id IS NOT NULL,
    exact.activity_id, exact.version_id, exact.version_number,
    exact.title, exact.instructions, exact.goal, exact.blocks,
    exact.module_key, exact.result_mode, exact.max_points,
    exact.policy_snapshot, exact.content_digest
    FROM pins pin
    LEFT JOIN LATERAL (
      SELECT version.activity_id, version.id AS version_id, version.version_number,
        version.title, version.instructions, version.goal, version.blocks,
        version.module_key, version.result_mode, version.max_points,
        version.policy_snapshot, version.content_digest
        FROM public.learning_activity_versions version
        JOIN public.learning_activities activity ON activity.id = version.activity_id
          AND activity.tenant_id = version.tenant_id
          AND activity.owner_principal_id = pin.owner_principal_id
          AND activity.reusable_authored_content
          AND activity.authoring_origin <> 'legacy_runtime'
       WHERE version.id = pin.requested_version AND version.tenant_id = pin.tenant_id
         AND version.canonical_contract_version = 1
         AND version.canonical_kind = pin.pin_kind
         AND version.published_at IS NOT NULL
         AND jsonb_typeof(version.policy_snapshot) = 'object'
    ) exact ON true
   ORDER BY pin.pointer;
$$;

REVOKE ALL ON FUNCTION public.course_author_version_pins(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_author_version_pins(uuid,uuid,uuid) TO asalab_app;
