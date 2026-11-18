-- Phase 4A hardening (additive; 0003-0009 are not edited).
--
-- 1. Grant consistency: 0009 created organizations and mr_profiles with RLS and no policy but, unlike
--    0003/0006/0008, did not explicitly revoke the default browser-role grants. Only service_role
--    (server functions, after requireMrProfile) may touch them.
REVOKE ALL ON public.organizations, public.mr_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.organizations, public.mr_profiles TO service_role;

-- 2. Audit actor: the projection triggers wrote report_edits rows without actor_user_id (added in 0009),
--    so intelligence/effectiveness changes had no actor. The actor is NEW.updated_by, which the server
--    sets from the verified Auth user id on every write, the same source audit_report_update() uses for
--    field/status/follow-up rows. Function bodies are otherwise identical to 0005 and 0007.
CREATE OR REPLACE FUNCTION public.project_report_intelligence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb; b jsonb; n integer;
BEGIN
 IF TG_OP='UPDATE' AND NEW.intelligence IS NOT DISTINCT FROM OLD.intelligence THEN RETURN NEW; END IF;
 DELETE FROM public.report_competitors WHERE report_id=NEW.id;
 DELETE FROM public.report_barriers WHERE report_id=NEW.id;
 n:=0;
 FOR c IN SELECT value FROM jsonb_array_elements(NEW.intelligence->'competitors') LOOP
  INSERT INTO public.report_competitors(report_id,position,original_mention,brand_discussed,product_id,sentiment,reason_for_preference,preference_detail,evidence,ambiguous,identity_confirmed,candidate_ids)
  VALUES(NEW.id,n,c->>'original_mention',c->>'brand_discussed',NULLIF(c->>'product_id',''),c->>'sentiment',c->>'reason_for_preference',c->>'preference_detail',c->>'evidence',COALESCE((c->>'ambiguous')::boolean,false),COALESCE((c->>'identity_confirmed')::boolean,false),ARRAY(SELECT jsonb_array_elements_text(c->'candidate_ids'))); n:=n+1;
 END LOOP;
 n:=0;
 FOR b IN SELECT value FROM jsonb_array_elements(NEW.intelligence->'barriers') LOOP
  INSERT INTO public.report_barriers(report_id,position,category,status,is_primary,evidence,suggested_followup_action)
  VALUES(NEW.id,n,b->>'category',b->>'status',COALESCE((b->>'primary')::boolean,false),b->>'evidence',b->>'suggested_followup_action'); n:=n+1;
 END LOOP;
 IF TG_OP='UPDATE' THEN
  INSERT INTO public.report_edits(report_id,field,old_value,new_value,actor_user_id) VALUES(NEW.id,'intelligence',OLD.intelligence::text,NEW.intelligence::text,NEW.updated_by);
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.project_report_effectiveness() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s jsonb; c jsonb; m jsonb; n integer;
BEGIN
 IF TG_OP='UPDATE' AND NEW.effectiveness IS NOT DISTINCT FROM OLD.effectiveness THEN RETURN NEW; END IF;
 DELETE FROM public.report_samples WHERE report_id=NEW.id;
 DELETE FROM public.report_collateral WHERE report_id=NEW.id;
 DELETE FROM public.report_commitments WHERE report_id=NEW.id;
 n:=0;
 FOR s IN SELECT value FROM jsonb_array_elements(NEW.effectiveness->'samples') LOOP
  INSERT INTO public.report_samples(report_id,position,product_mention,product_id,quantity,distribution_status,evidence)
  VALUES(NEW.id,n,s->>'product_mention',NULLIF(s->>'product_id',''),NULLIF(s->>'quantity','')::integer,s->>'distribution_status',s->>'evidence'); n:=n+1;
 END LOOP;
 n:=0;
 FOR m IN SELECT value FROM jsonb_array_elements(NEW.effectiveness->'collateral') LOOP
  INSERT INTO public.report_collateral(report_id,position,material_type,detail)
  VALUES(NEW.id,n,m->>'material_type',m->>'detail'); n:=n+1;
 END LOOP;
 n:=0;
 FOR c IN SELECT value FROM jsonb_array_elements(NEW.effectiveness->'commitments') LOOP
  INSERT INTO public.report_commitments(report_id,position,commitment_date,trial_patient_count,status,follow_up_outcome,evidence)
  VALUES(NEW.id,n,NULLIF(c->>'commitment_date','')::date,NULLIF(c->>'trial_patient_count','')::integer,c->>'status',c->>'follow_up_outcome',c->>'evidence'); n:=n+1;
 END LOOP;
 IF TG_OP='UPDATE' THEN
  INSERT INTO public.report_edits(report_id,field,old_value,new_value,actor_user_id) VALUES(NEW.id,'effectiveness',OLD.effectiveness::text,NEW.effectiveness::text,NEW.updated_by);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.project_report_intelligence(), public.project_report_effectiveness() FROM PUBLIC, anon, authenticated;
