import { billingConfig, getMember, getMemberPlan } from "../../_shared/member-billing.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return Response.json({ error: "Database member belum dikonfigurasi." }, { status: 503 });
  try {
    const member = await getMember(request, env);
    if (!member) return Response.json({ error: "Sesi login tidak berlaku." }, { status: 401 });
    const [plan, usage, packagesResult] = await Promise.all([
      getMemberPlan(env, member.id),
      env.DB.prepare("SELECT COUNT(*) AS count FROM sites WHERE owner_id=?").bind(member.id).first(),
      env.DB.prepare("SELECT code,name,description,amount,currency,country,site_limit FROM subscription_plans WHERE is_active=1 AND billing_interval='MONTH' AND amount>0 ORDER BY sort_order,name").all()
    ]);
    const billing = billingConfig(env);
    const packages = (packagesResult.results || []).map(row => ({
      code: row.code,
      name: row.name,
      description: row.description,
      amount: Number(row.amount),
      currency: row.currency,
      country: row.country,
      siteLimit: Number(row.site_limit)
    }));
    return Response.json({
      ...plan,
      siteCount: Number(usage?.count || 0),
      checkoutEnabled: billing.configured && packages.length > 0,
      packages
    });
  } catch (error) {
    console.error("[billing:status]", error);
    const message = String(error?.message || error);
    if (["member_subscriptions", "subscription_plans", "member_plan_assignments"].some(table => message.includes("no such table: " + table))) {
      return Response.json({ error: "Paket/langganan belum disiapkan. Jalankan ulang admin-schema.sql di D1." }, { status: 503 });
    }
    return Response.json({ error: "Gagal memuat status paket." }, { status: 500 });
  }
}