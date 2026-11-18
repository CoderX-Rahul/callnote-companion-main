-- Phase 4A-2: reporting hierarchy and scoped team access.
ALTER TABLE public.mr_profiles
  DROP CONSTRAINT mr_profiles_role_check;

ALTER TABLE public.mr_profiles
  ADD CONSTRAINT mr_profiles_role_check
    CHECK (role IN ('mr', 'asm', 'rsm', 'zsm', 'nsm', 'manager', 'admin')),
  ADD COLUMN reports_to uuid,
  ADD CONSTRAINT mr_profiles_id_organization_id_key UNIQUE (id, organization_id),
  ADD CONSTRAINT mr_profiles_reports_to_organization_fkey
    FOREIGN KEY (reports_to, organization_id)
    REFERENCES public.mr_profiles (id, organization_id);

CREATE INDEX mr_profiles_reports_to_idx ON public.mr_profiles (reports_to);

CREATE OR REPLACE FUNCTION public.validate_mr_reporting_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  child_rank integer;
  parent_rank integer;
  parent_role text;
  direct_report record;
BEGIN
  IF NEW.role IN ('admin', 'manager') AND NEW.reports_to IS NOT NULL THEN
    RAISE EXCEPTION 'Administrative and legacy manager profiles cannot have a reporting parent.' USING ERRCODE = '23514';
  END IF;
  IF NEW.role = 'nsm' AND NEW.reports_to IS NOT NULL THEN
    RAISE EXCEPTION 'National Sales Managers cannot have a reporting parent.' USING ERRCODE = '23514';
  END IF;

  child_rank := CASE NEW.role
    WHEN 'mr' THEN 1 WHEN 'asm' THEN 2 WHEN 'rsm' THEN 3 WHEN 'zsm' THEN 4 WHEN 'nsm' THEN 5
    ELSE NULL
  END;

  IF NEW.reports_to IS NOT NULL THEN
    SELECT p.role INTO parent_role
    FROM public.mr_profiles AS p
    WHERE p.id = NEW.reports_to AND p.organization_id = NEW.organization_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reporting parent must exist in the same organization.' USING ERRCODE = '23514';
    END IF;
    IF parent_role IN ('admin', 'manager') THEN
      RAISE EXCEPTION 'Administrative and legacy manager profiles cannot be reporting parents.' USING ERRCODE = '23514';
    END IF;
    parent_rank := CASE parent_role
      WHEN 'mr' THEN 1 WHEN 'asm' THEN 2 WHEN 'rsm' THEN 3 WHEN 'zsm' THEN 4 WHEN 'nsm' THEN 5
      ELSE NULL
    END;
    IF child_rank IS NULL OR parent_rank IS NULL OR parent_rank <= child_rank THEN
      RAISE EXCEPTION 'A reporting parent must have a strictly higher sales hierarchy rank.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    FOR direct_report IN
      SELECT child.role FROM public.mr_profiles AS child WHERE child.reports_to = OLD.id
    LOOP
      child_rank := CASE direct_report.role
        WHEN 'mr' THEN 1 WHEN 'asm' THEN 2 WHEN 'rsm' THEN 3 WHEN 'zsm' THEN 4 WHEN 'nsm' THEN 5
        ELSE NULL
      END;
      parent_rank := CASE NEW.role
        WHEN 'mr' THEN 1 WHEN 'asm' THEN 2 WHEN 'rsm' THEN 3 WHEN 'zsm' THEN 4 WHEN 'nsm' THEN 5
        ELSE NULL
      END;
      IF parent_rank IS NULL OR child_rank IS NULL OR parent_rank <= child_rank THEN
        RAISE EXCEPTION 'Role change would invalidate a direct report hierarchy link.' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_mr_reporting_hierarchy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mr_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mr_profiles TO service_role;

CREATE TRIGGER validate_mr_reporting_hierarchy
BEFORE INSERT OR UPDATE ON public.mr_profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_mr_reporting_hierarchy();
