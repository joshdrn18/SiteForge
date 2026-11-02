import { billingConfig, getMember, getMemberPlan } from "../../_shared/member-billing.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return Response.json({ error: "Database member belum dikonfigurasi." }, { status: 503 });
  try {
    const member = await getMember(request, env);
    if (!member) return Response.json({ error: "Sesi login tidak berlaku." }, { status: 401 });
    const [plan, usage] = await Promise.all([
      getMemberPlan(env, member.id),
      env.DB.prepare("SELECT COUNT(*) AS count FROM sites WHERE owner_id=?").bind(member.id).first()
    ]);
    const billing = billingConfig(env);
    return Response.json({
      ...plan,
      siteCount: Number(usage?.count || 0),
      checkoutEnabled: billing.configured,
      price: billing.amount,
      currency: billing.currency,
      country: billing.country
    });
  } catch (error) {
    console.error("[billing:status]", error);
    const message = String(error?.message || error);
    if (message.includes("no such table: member_subscriptions")) {
      return Response.json({ error: "Langganan belum disiapkan. Jalankan ulang admin-schema.sql di D1." }, { status: 503 });
    }
    return Response.json({ error: "Gagal memuat status paket." }, { status: 500 });
  }
}