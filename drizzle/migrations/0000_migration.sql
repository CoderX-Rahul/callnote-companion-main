CREATE TABLE public.doctors (
  id text PRIMARY KEY,
  name text NOT NULL,
  specialty text,
  clinic text,
  city text
);
GRANT ALL ON public.doctors TO service_role;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.products (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text
);
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.call_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_name text NOT NULL DEFAULT 'Demo MR',
  call_datetime timestamptz,
  doctor_id text REFERENCES public.doctors(id),
  doctor_name text,
  specialty text,
  clinic text,
  product_ids text[] NOT NULL DEFAULT '{}',
  product_names text[] NOT NULL DEFAULT '{}',
  purpose text,
  feedback text,
  materials_requested text,
  follow_up_action text,
  follow_up_due date,
  follow_up_done boolean NOT NULL DEFAULT false,
  original_note text NOT NULL,
  ai_unknown_fields text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  edit_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);
GRANT ALL ON public.call_reports TO service_role;
ALTER TABLE public.call_reports ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.report_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.call_reports(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  edited_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.report_edits TO service_role;
ALTER TABLE public.report_edits ENABLE ROW LEVEL SECURITY;

INSERT INTO public.doctors (id, name, specialty, clinic, city) VALUES
('DR-1001','Dr. Anita Sharma','Cardiology','Heartline Clinic','Pune'),
('DR-1002','Dr. Rohan Sharma','General Medicine','Sunrise Family Care','Pune'),
('DR-1003','Dr. Meera Iyer','Endocrinology','Lotus Diabetes Centre','Mumbai'),
('DR-1004','Dr. Vikram Rao','Pulmonology','BreathWell Chest Clinic','Bengaluru'),
('DR-1005','Dr. Priya Nair','Dermatology','SkinFirst Clinic','Kochi'),
('DR-1006','Dr. Arjun Mehta','Orthopaedics','OrthoPlus Hospital','Ahmedabad'),
('DR-1007','Dr. Kavita Rao','Paediatrics','Little Steps Clinic','Hyderabad'),
('DR-1008','Dr. Sanjay Gupta','Gastroenterology','DigestCare Centre','Delhi');

INSERT INTO public.products (id, name, category) VALUES
('PR-201','Cardiovex 10 mg','Antihypertensive'),
('PR-202','Cardiovex Plus','Antihypertensive combination'),
('PR-203','Glucorin XR','Antidiabetic'),
('PR-204','Respiraflo Inhaler','Respiratory'),
('PR-205','Dermacalm Cream','Dermatology'),
('PR-206','Ostiflex D3','Bone health'),
('PR-207','Gastrozen 40','Gastro-protective');

INSERT INTO public.call_reports (call_datetime, doctor_id, doctor_name, specialty, clinic, product_ids, product_names, purpose, feedback, materials_requested, follow_up_action, follow_up_due, original_note, status, created_at, approved_at) VALUES
('2026-10-26 10:30+05:30','DR-1003','Dr. Meera Iyer','Endocrinology','Lotus Diabetes Centre','{PR-203}','{Glucorin XR}','Product detailing','Asked about once-daily dosing tolerance.','Dosing leaflet','Send Glucorin XR dosing leaflet','2026-11-02','Met Dr Meera Iyer on 26 Oct morning, detailed Glucorin XR. She asked about once-daily tolerance. Wants dosing leaflet, send by 2 Nov.','approved','2026-10-26 12:00+05:30','2026-10-26 12:10+05:30'),
('2026-10-27 16:00+05:30','DR-1004','Dr. Vikram Rao','Pulmonology','BreathWell Chest Clinic','{PR-204}','{Respiraflo Inhaler}','Follow-up visit','Positive about inhaler device usability.',NULL,'Revisit with device demo kit','2026-11-05','Visited Dr Vikram Rao 27 Oct 4pm about Respiraflo. He liked device usability. Revisit with demo kit by 5 Nov.','approved','2026-10-27 17:00+05:30','2026-10-27 17:05+05:30');