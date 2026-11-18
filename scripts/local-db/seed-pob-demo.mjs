import postgres from "postgres";
import { assertRepositoryTarget } from "./safety.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is missing. Run db:local:env first.");
  process.exit(1);
}
try {
  const target = assertRepositoryTarget(databaseUrl);
  if (!target.isLocal) throw new Error("POB demo seeding only runs against local Supabase.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database target safety check failed.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
function rupeesToPaise(value) {
  const [whole, fraction = ""] = String(value).split(".");
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction))
    throw new Error("Invalid fictional MRP value.");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}
function percentToBasisPoints(value) {
  const [whole, fraction = ""] = String(value).split(".");
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction))
    throw new Error("Invalid fictional scheme discount.");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}
const seeds = [
  {
    employee_code: "DEV-MR-A1",
    doctor_id: "DR-1001",
    product_id: "PR-201",
    quantity: 20,
    date: "2026-11-10",
    evidence: "Booked 20 Cardiovex with 10+1 offer",
    scheme: "10+1",
  },
  {
    employee_code: "DEV-MR-A2",
    doctor_id: "DR-1003",
    product_id: "PR-202",
    quantity: 12,
    date: "2026-11-12",
    evidence: "Booked 12 Cardiovex Plus at 5% discount",
    scheme: "5%",
  },
];

try {
  for (const seed of seeds)
    await sql.begin(async (tx) => {
      const marker = `[FIELDIQ-POB-DEMO-2026-11:${seed.employee_code}]`;
      const existing =
        await tx`select id from public.call_reports where original_note like ${`${marker}%`} limit 1`;
      if (existing.length) return;
      const [profile] =
        await tx`select id,user_id,organization_id,full_name from public.mr_profiles where employee_code=${seed.employee_code}`;
      if (!profile) throw new Error(`Missing ${seed.employee_code}; run db:local:seed first.`);
      const [product] =
        await tx`select id,name,mrp from public.products where id=${seed.product_id}`;
      if (!product || product.mrp == null)
        throw new Error(`Missing MRP for ${seed.product_id}; apply local migrations first.`);
      const [doctor] = await tx`select name from public.doctors where id=${seed.doctor_id}`;
      if (!doctor) throw new Error(`Missing fictional doctor ${seed.doctor_id}.`);
      const [scheme] =
        seed.scheme === "10+1"
          ? await tx`select id,scheme_type,buy_qty,free_qty,discount_pct from public.product_schemes where product_id=${seed.product_id} and scheme_type='free_goods' and buy_qty=10 and free_qty=1 and active=true limit 1`
          : await tx`select id,scheme_type,buy_qty,free_qty,discount_pct from public.product_schemes where product_id=${seed.product_id} and scheme_type='discount_percent' and discount_pct=5 and active=true limit 1`;
      if (!scheme) throw new Error(`Missing fictional ${seed.scheme} seed scheme.`);
      const evidence = seed.evidence;
      const freeQuantity =
        scheme.scheme_type === "free_goods"
          ? Math.floor(seed.quantity / Number(scheme.buy_qty)) * Number(scheme.free_qty)
          : 0;
      const discountPct =
        scheme.scheme_type === "discount_percent" ? Number(scheme.discount_pct) : null;
      const grossPaise = BigInt(seed.quantity) * rupeesToPaise(product.mrp);
      const discountBasisPoints = percentToBasisPoints(discountPct ?? 0);
      const netPaise = (grossPaise * (10_000n - discountBasisPoints) + 5_000n) / 10_000n;
      const lineValue = Number(netPaise) / 100;
      const pob = {
        lines: [
          {
            product_mention: product.name,
            candidate_ids: [product.id],
            product_id: product.id,
            quantity: seed.quantity,
            scheme_mention: seed.scheme,
            scheme_id: scheme.id,
            status: "Booked",
            free_quantity: freeQuantity,
            unit_mrp_snapshot: Number(product.mrp),
            discount_pct_snapshot: discountPct,
            line_value: lineValue,
            stated_unit_price: null,
            evidence,
            warnings: [],
          },
        ],
      };
      const [pobShape] =
        await tx`select jsonb_typeof(${tx.json(pob)}::jsonb) as root_type, jsonb_typeof((${tx.json(pob)}::jsonb)->'lines') as lines_type`;
      if (pobShape.root_type !== "object" || pobShape.lines_type !== "array")
        throw new Error("POB seed document shape check failed.");
      const originalNote = `${marker} ${doctor.name} visit. ${evidence}. Fictional demo data.`;
      const [report] = await tx`
      insert into public.call_reports(organization_id,mr_profile_id,updated_by,rep_name,original_note,
        doctor_id,doctor_name,product_ids,product_names,purpose,call_date_only,status,pob,ai_pob,extraction_schema_version)
      values (${profile.organization_id},${profile.id},${profile.user_id},${profile.full_name},${originalNote},
        ${seed.doctor_id},${doctor.name},ARRAY[${seed.product_id}],ARRAY[${product.name}],
        'Fictional local POB demo',${seed.date},'draft',${tx.json(pob)}::jsonb,${tx.json(pob)}::jsonb,2)
      returning id
    `;
      await tx`update public.call_reports set status='approved',approved_at=now(),updated_by=${profile.user_id} where id=${report.id}`;
    });
  console.log(
    "Marker-tagged fictional approved POB demo reports are ready for DEV-MR-A1 and DEV-MR-A2.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "POB demo seed failed.");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
