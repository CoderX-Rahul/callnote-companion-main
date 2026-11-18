REVOKE ALL ON public.report_competitors,public.report_barriers FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.report_competitors,public.report_barriers TO service_role;