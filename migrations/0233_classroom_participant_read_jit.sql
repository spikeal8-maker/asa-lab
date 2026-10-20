-- Keep JIT local to the two measured participant read boundaries.
-- Existing definitions, privileges and all other function settings are retained.
ALTER FUNCTION public.classroom_participant_roster(uuid, uuid) SET jit = off;
ALTER FUNCTION public.classroom_participant_profile(uuid, uuid, uuid) SET jit = off;
