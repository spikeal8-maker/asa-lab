-- Extend the existing authorized batch summary. Reuse canonical score calculation;
-- do not cache rankings, change permissions, or alter student identities.
-- A real zero is counted; missing/disabled scores remain null.
CREATE OR REPLACE FUNCTION classroom_observation_summary(p_actor uuid,p_classes uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH classes AS MATERIALIZED(SELECT c.id FROM public.classrooms c WHERE c.id=ANY(p_classes) AND public.classroom_journal_teacher(p_actor,c.id)),
 seats AS MATERIALIZED(SELECT s.id,s.classroom_id FROM public.classroom_student_seats s JOIN classes c ON c.id=s.classroom_id WHERE s.status<>'removed'),
 projects AS MATERIALIZED(SELECT DISTINCT s.classroom_id,p.id FROM seats s CROSS JOIN LATERAL public.classroom_participant_projects(s.id) p),
 counts AS MATERIALIZED(SELECT c.id classroom_id,m.* FROM classes c CROSS JOIN LATERAL public.classroom_observation_seat_counts(c.id) m),
 ratings AS MATERIALIZED(
   SELECT c.id classroom_id, measured.average_rating, measured.rating_participants,
     (public.classroom_participant_settings_json(c.id)->>'periodDays')::integer rating_period_days
   FROM classes c
   CROSS JOIN LATERAL (
     SELECT round(avg((metric.item->>'score')::numeric),2) AS average_rating,
            count(*) FILTER(WHERE metric.item->>'score' IS NOT NULL)::integer AS rating_participants
     FROM public.classroom_participant_metrics(c.id) metric
   ) measured
 ),
 items AS(SELECT c.id,jsonb_build_object('classroomId',c.id,'students',(SELECT count(*) FROM seats s WHERE s.classroom_id=c.id),
  'works',(SELECT count(*) FROM projects p WHERE p.classroom_id=c.id),
  'assigned',COALESCE(sum(m.assigned),0),'submitted',COALESCE(sum(m.submitted),0),'waiting',COALESCE(sum(m.waiting),0),
  'notSubmitted',count(m.seat_id) FILTER(WHERE m.assigned>0 AND m.submitted=0),
  'averageRating',r.average_rating,'ratingParticipants',r.rating_participants,
  'ratingPeriodDays',r.rating_period_days) item
  FROM classes c LEFT JOIN counts m ON m.classroom_id=c.id
  LEFT JOIN ratings r ON r.classroom_id=c.id
  GROUP BY c.id,r.average_rating,r.rating_participants,r.rating_period_days)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(item ORDER BY id) FROM items),'[]'::jsonb),
  'totals',jsonb_build_object('students',(SELECT count(*) FROM seats),'works',(SELECT count(DISTINCT id) FROM projects),
  'assigned',COALESCE(sum(assigned),0),'submitted',COALESCE(sum(submitted),0),'waiting',COALESCE(sum(waiting),0),
  'notSubmitted',count(*) FILTER(WHERE assigned>0 AND submitted=0))) FROM counts
 HAVING cardinality(p_classes)<=200 AND cardinality(p_classes)=(SELECT count(*) FROM classes);
$$;
REVOKE ALL ON FUNCTION classroom_observation_summary(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_observation_summary(uuid,uuid[]) TO asalab_app;
