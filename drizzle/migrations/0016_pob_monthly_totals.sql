-- Part B3: bounded, organization-scoped monthly POB aggregation in IST.
CREATE OR REPLACE FUNCTION public.pob_monthly_totals(
  p_organization_id uuid,
  p_profile_ids uuid[],
  p_from date,
  p_to date
) RETURNS TABLE(
  mr_profile_id uuid,
  approved_calls bigint,
  booked_calls bigint,
  booked_lines bigint,
  booked_value numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH requested_profiles AS (
    SELECT DISTINCT unnest(COALESCE(p_profile_ids, ARRAY[]::uuid[])) AS id
  ), report_totals AS (
    SELECT r.mr_profile_id,
      count(*) FILTER (WHERE r.status='approved') AS approved_calls,
      count(DISTINCT i.report_id) FILTER (WHERE r.status='approved' AND i.status='Booked') AS booked_calls,
      count(i.position) FILTER (WHERE r.status='approved' AND i.status='Booked') AS booked_lines,
      CASE
        WHEN count(i.position) FILTER (WHERE r.status='approved' AND i.status='Booked' AND i.line_value IS NULL)>0 THEN NULL
        ELSE COALESCE(sum(i.line_value) FILTER (WHERE r.status='approved' AND i.status='Booked'),0)::numeric
      END AS booked_value
    FROM public.call_reports r
    LEFT JOIN public.report_pob_items i ON i.report_id=r.id
    WHERE r.organization_id=p_organization_id
      AND r.deleted_at IS NULL
      AND r.status='approved'
      AND COALESCE(r.call_date_only,(r.call_datetime AT TIME ZONE 'Asia/Kolkata')::date) BETWEEN p_from AND p_to
      AND (p_profile_ids IS NULL OR r.mr_profile_id=ANY(p_profile_ids))
    GROUP BY r.mr_profile_id
  )
  SELECT rp.id,
    COALESCE(t.approved_calls,0)::bigint,
    COALESCE(t.booked_calls,0)::bigint,
    COALESCE(t.booked_lines,0)::bigint,
    CASE WHEN t.mr_profile_id IS NULL THEN 0::numeric ELSE t.booked_value END
  FROM requested_profiles rp
  LEFT JOIN report_totals t ON t.mr_profile_id=rp.id
  WHERE p_from <= p_to
  ORDER BY rp.id;
$$;
REVOKE ALL ON FUNCTION public.pob_monthly_totals(uuid,uuid[],date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pob_monthly_totals(uuid,uuid[],date,date) TO service_role;
