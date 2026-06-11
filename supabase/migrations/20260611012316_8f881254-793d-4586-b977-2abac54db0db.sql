CREATE OR REPLACE FUNCTION public.increment_ai_usage(_user_id uuid, _limit integer)
RETURNS TABLE(allowed boolean, used integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _period date := (date_trunc('month', now()))::date;
  _new_count integer;
BEGIN
  INSERT INTO public.ai_usage (user_id, period_start, used_count, updated_at)
  VALUES (_user_id, _period, 1, now())
  ON CONFLICT (user_id) DO UPDATE
    SET used_count = CASE
          WHEN public.ai_usage.period_start <> _period THEN 1
          WHEN public.ai_usage.used_count < _limit THEN public.ai_usage.used_count + 1
          ELSE public.ai_usage.used_count
        END,
        period_start = _period,
        updated_at = now()
  RETURNING used_count INTO _new_count;

  IF _new_count > _limit THEN
    RETURN QUERY SELECT false, _new_count;
  ELSE
    RETURN QUERY SELECT true, _new_count;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_ai_usage(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_ai_usage(uuid, integer) TO service_role;

ALTER TABLE public.ai_usage ADD CONSTRAINT ai_usage_user_id_key UNIQUE (user_id);
