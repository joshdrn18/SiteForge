import { getMember } from "../../_shared/member-billing.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return Response.json({ error: "Database member belum dikonfigurasi." }, { status: 503 });
  try {
    const member = await getMember(request, env);
    if (!member) return Response.json({ error: "Sesi login tidak berlaku." }, { status: 401 });
    const result = await env.DB.prepare(
      "SELECT c.cycle_id,c.cycle_number,c.status,c.updated_at,s.plan_code,s.amount,s.currency,p.name AS plan_name,p.country FROM member_subscription_cycles c JOIN member_subscriptions s ON s.provider_reference_id=c.provider_reference_id LEFT JOIN subscription_plans p ON p.code=s.plan_code WHERE s.member_id=? ORDER BY c.updated_at DESC,c.cycle_number DESC LIMIT 50"
    ).bind(member.id).all();
    const payments = (result.results || []).map(row => ({
      cycleNumber: Number(row.cycle_number || 0),
      status: String(row.status || "PENDING").toUpperCase(),
      updatedAt: Number(row.updated_at || 0),
      planCode: row.plan_code,
      planName: row.plan_name || row.plan_code || "Paket",
      amount: Number(row.amount || 0),
      currency: row.currency,
      country: row.country
    }));
    return Response.json({ payments });
  } catch (error) {
    console.error("[billing:history]", String(error?.message || error));
    const message = String(error?.message || error);
    if (["member_subscriptions", "member_subscription_cycles", "subscription_plans"].some(table => message.includes("no such table: " + table))) {
      return Response.json({ error: "Riwayat pembayaran belum siap. Jalankan ulang admin-schema.sql di D1." }, { status: 503 });
    }
    return Response.json({ error: "Riwayat pembayaran gagal dimuat." }, { status: 500 });
  }
}
