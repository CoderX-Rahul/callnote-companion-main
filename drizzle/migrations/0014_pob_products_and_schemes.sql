-- Part B1: fictional MRP reference prices and controlled product schemes.
ALTER TABLE public.products ADD COLUMN mrp numeric(10,2);
UPDATE public.products
SET mrp = CASE id
  WHEN 'PR-201' THEN 125.00
  WHEN 'PR-202' THEN 180.00
  WHEN 'PR-203' THEN 95.00
  ELSE 110.00
END
WHERE mrp IS NULL;
ALTER TABLE public.products ADD CONSTRAINT products_mrp_nonnegative CHECK (mrp IS NULL OR mrp >= 0);

CREATE TABLE public.product_schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL REFERENCES public.products(id),
  label text NOT NULL,
  scheme_type text NOT NULL CHECK (scheme_type IN ('free_goods','discount_percent')),
  buy_qty integer,
  free_qty integer,
  discount_pct numeric(5,2),
  active boolean NOT NULL DEFAULT true,
  valid_from date,
  valid_to date,
  CONSTRAINT product_schemes_type_values CHECK (
    (scheme_type = 'free_goods' AND buy_qty > 0 AND free_qty > 0 AND discount_pct IS NULL)
    OR (scheme_type = 'discount_percent' AND buy_qty IS NULL AND free_qty IS NULL AND discount_pct > 0 AND discount_pct <= 100)
  ),
  CONSTRAINT product_schemes_valid_dates CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
);
ALTER TABLE public.product_schemes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_schemes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.product_schemes TO service_role;
INSERT INTO public.product_schemes(product_id,label,scheme_type,buy_qty,free_qty,discount_pct,active)
SELECT 'PR-201','10+1','free_goods',10,1,NULL,true
WHERE EXISTS (SELECT 1 FROM public.products WHERE id='PR-201');
INSERT INTO public.product_schemes(product_id,label,scheme_type,buy_qty,free_qty,discount_pct,active)
SELECT 'PR-202','5% introductory trade discount','discount_percent',NULL,NULL,5.00,true
WHERE EXISTS (SELECT 1 FROM public.products WHERE id='PR-202');
