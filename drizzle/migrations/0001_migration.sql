ALTER TABLE public.call_reports
  ADD COLUMN ai_doctor_choices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN ai_product_choices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN ai_questions text[] NOT NULL DEFAULT '{}';