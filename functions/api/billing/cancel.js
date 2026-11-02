import { getMember, sameOrigin, xenditAuth } from "../../_shared/member-billing.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return Response.json({ error: "Origin tidak valid." }, { status: 403 });
  if (!env.DB) return Response.json({ error: "Database member belum dikonfigurasi." }, { status: 503 });
  if (!env.XENDIT_SECRET_KEY) return Response.json({ error: "Pembayaran belum dikonfigurasi." }, { status: 503 });
  try {
    const member = await getMember(request, env);
    if (!member) return Response.json({ error: "Sesi login tidak berlaku." }, { status: 401 });
    const subscription = await env.DB.prepare(
      "SELECT id,provider_plan_id,status,current_period_end FROM member_subscriptions WHERE member_id=? AND provider_plan_id IS NOT NULL AND status IN ('pending','active','past_due') ORDER BY created_at DESC LIMIT 1"
    ).bind(member.id).first();
    if (!subscription) return Response.json({ error: "Langganan aktif tidak ditemukan." }, { status: 404 });

    const response = await fetch("https://api.xendit.co/recurring/plans/" + encodeURIComponent(subscription.provider_plan_id) + "/deactivate", {
      method: "POST",
      headers: { Authorization: xenditAuth(env), "api-version": "2026-01-01" }
    });
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok) {
      console.error("[billing:cancel:provider]", response.status, result?.error_code || "deactivation_failed");
      return Response.json({ error: "Pembatalan belum berhasil diproses. Coba lagi." }, { status: 502 });
    }
    const updatedAt = Date.parse(result.updated || "") || Date.now();
    await env.DB.prepare(
      "UPDATE member_subscriptions SET status='cancelled',provider_updated_at=MAX(provider_updated_at,?),updated_at=? WHERE id=?"
    ).bind(updatedAt, Date.now(), subscription.id).run();
    return Response.json({ ok: true, currentPeriodEnd: Number(subscription.current_period_end || 0) || null });
  } catch (error) {
    console.error("[billing:cancel]", error);
    const message = String(error?.message || error);
    if (message.includes("no such table: member_subscriptions")) {
      return Response.json({ error: "Langganan belum disiapkan. Jalankan ulang admin-schema.sql di D1." }, { status: 503 });
    }
    return Response.json({ error: "Pembatalan langganan gagal." }, { status: 500 });
  }
}