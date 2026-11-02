import { billingConfig, getMember, getMemberPlan, sameOrigin, safeCheckoutUrl, xenditAuth } from "../../_shared/member-billing.js";

function cleanName(value) {
  return String(value || "").normalize("NFKD").replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "SiteForge User";
}

function nextMonthAnchor() {
  const now = new Date();
  const day = Math.min(now.getUTCDate(), 28);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day, now.getUTCHours(), now.getUTCMinutes())).toISOString();
}

function supportedPlan(plan) {
  const currency = String(plan?.currency || "").toUpperCase();
  const country = String(plan?.country || "").toUpperCase();
  const amount = Number(plan?.amount);
  const validAmount = Number.isFinite(amount) && amount > 0 && (currency === "IDR" ? Number.isInteger(amount) : Math.round(amount * 100) === amount * 100);
  return validAmount && ((country === "ID" && currency === "IDR") || (country === "MY" && currency === "MYR"));
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return Response.json({ error: "Origin tidak valid." }, { status: 403 });
  if (!env.DB) return Response.json({ error: "Database member belum dikonfigurasi." }, { status: 503 });
  try {
    const member = await getMember(request, env);
    if (!member) return Response.json({ error: "Sesi login tidak berlaku." }, { status: 401 });

    let body;
    try { body = await request.json(); } catch { return Response.json({ error: "Paket checkout tidak valid." }, { status: 400 }); }
    const planCode = String(body?.planCode || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(planCode)) return Response.json({ error: "Pilih paket yang tersedia." }, { status: 400 });

    const config = billingConfig(env);
    if (!config.configured) {
      return Response.json({ error: "Pembayaran belum dikonfigurasi admin SiteForge.", code: "BILLING_NOT_CONFIGURED" }, { status: 503 });
    }

    const selectedPlan = await env.DB.prepare(
      "SELECT code,name,description,amount,currency,country,billing_interval,site_limit FROM subscription_plans WHERE code=? AND is_active=1 AND billing_interval='MONTH'"
    ).bind(planCode).first();
    if (!selectedPlan || !supportedPlan(selectedPlan)) {
      return Response.json({ error: "Paket ini belum tersedia untuk checkout." }, { status: 404 });
    }

    const plan = await getMemberPlan(env, member.id);
    if (plan.planSource === "admin") {
      return Response.json({ error: "Paket akunmu sedang diatur admin. Hubungi admin untuk mengubahnya.", code: "ADMIN_ASSIGNED_PLAN" }, { status: 409 });
    }
    if (plan.plan !== "free") {
      return Response.json({ error: "Paket berbayar kamu masih aktif.", code: "ALREADY_SUBSCRIBED", subscription: plan.subscription }, { status: 409 });
    }

    const now = Date.now();
    const unresolved = await env.DB.prepare(
      "SELECT status,plan_code FROM member_subscriptions WHERE member_id=? AND provider_plan_id IS NOT NULL AND status IN ('active','past_due') ORDER BY updated_at DESC LIMIT 1"
    ).bind(member.id).first();
    if (unresolved) {
      return Response.json({ error: "Langganan sebelumnya masih diproses. Batalkan dulu dari dashboard sebelum membuat checkout baru.", code: "SUBSCRIPTION_PENDING" }, { status: 409 });
    }

    const pending = await env.DB.prepare(
      "SELECT checkout_url,checkout_expires_at,plan_code FROM member_subscriptions WHERE member_id=? AND status='pending' AND checkout_url IS NOT NULL AND checkout_expires_at>? ORDER BY created_at DESC LIMIT 1"
    ).bind(member.id, now).first();
    if (pending?.checkout_url) {
      if (pending.plan_code === selectedPlan.code) return Response.json({ checkoutUrl: pending.checkout_url, reused: true });
      return Response.json({ error: "Checkout paket sebelumnya masih aktif. Selesaikan atau batalkan dulu dari dashboard.", code: "CHECKOUT_PENDING" }, { status: 409 });
    }

    await env.DB.prepare("UPDATE member_subscriptions SET status='expired',updated_at=? WHERE member_id=? AND status='pending' AND checkout_expires_at IS NOT NULL AND checkout_expires_at<=?")
      .bind(now, member.id, now).run();

    const rowId = crypto.randomUUID();
    const referenceId = "sfpro" + crypto.randomUUID().replace(/-/g, "");
    const anchorDate = nextMonthAnchor();
    const firstRenewalAt = Date.parse(anchorDate);
    await env.DB.prepare(
      "INSERT INTO member_subscriptions (id,member_id,provider,provider_reference_id,plan_code,status,amount,currency,first_renewal_at,created_at,updated_at) VALUES (?,?, 'xendit', ?, ?, 'pending', ?, ?, ?, ?, ?)"
    ).bind(rowId, member.id, referenceId, selectedPlan.code, selectedPlan.amount, selectedPlan.currency, firstRenewalAt, now, now).run();

    if (String(member.email || "").length > 50) {
      await env.DB.prepare("UPDATE member_subscriptions SET status='failed',updated_at=? WHERE id=?").bind(Date.now(), rowId).run();
      return Response.json({ error: "Email akun terlalu panjang untuk checkout Xendit. Hubungi admin SiteForge." }, { status: 400 });
    }
    const firstName = cleanName(member.display_name).split(" ")[0] || "SiteForge";
    const origin = new URL(request.url).origin;
    const payload = {
      reference_id: referenceId,
      session_type: "SUBSCRIPTION",
      mode: "PAYMENT_LINK",
      amount: Number(selectedPlan.amount),
      currency: selectedPlan.currency,
      country: selectedPlan.country,
      locale: "id",
      customer: {
        reference_id: "sfmember" + crypto.randomUUID().replace(/-/g, ""),
        type: "INDIVIDUAL",
        email: String(member.email || "").slice(0, 50),
        individual_detail: { given_names: firstName }
      },
      description: "SiteForge — " + String(selectedPlan.name || "Paket").slice(0, 80),
      subscription: {
        schedule: {
          interval: "MONTH",
          interval_count: 1,
          anchor_date: anchorDate,
          retry_interval: "DAY",
          retry_interval_count: 1,
          total_retry: 3,
          failed_attempt_notifications: [1, 2, 3]
        },
        immediate_payment: true,
        failed_cycle_action: "RESUME",
        payment_link_for_failed_attempt: true
      },
      success_return_url: origin + "/dashboard.html?billing=return",
      cancel_return_url: origin + "/dashboard.html?billing=cancelled"
    };

    let response;
    let result;
    try {
      response = await fetch("https://api.xendit.co/sessions", {
        method: "POST",
        headers: { Authorization: xenditAuth(env), "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      result = await response.json();
    } catch (error) {
      console.error("[billing:checkout:provider]", String(error?.message || error));
      await env.DB.prepare("UPDATE member_subscriptions SET status='failed',updated_at=? WHERE id=?").bind(Date.now(), rowId).run();
      return Response.json({ error: "Checkout belum bisa dibuat. Coba lagi sebentar." }, { status: 502 });
    }

    if (!response.ok || !safeCheckoutUrl(result?.payment_link_url)) {
      console.error("[billing:checkout:provider]", response.status, result?.error_code || "invalid_checkout_response");
      await env.DB.prepare("UPDATE member_subscriptions SET status='failed',updated_at=? WHERE id=?").bind(Date.now(), rowId).run();
      return Response.json({ error: "Xendit gagal menyiapkan checkout. Coba lagi atau hubungi admin." }, { status: 502 });
    }

    const expiresAt = Date.parse(result.expires_at || "") || (Date.now() + 30 * 60 * 1000);
    await env.DB.prepare(
      "UPDATE member_subscriptions SET provider_session_id=?,provider_plan_id=?,checkout_url=?,checkout_expires_at=?,updated_at=? WHERE id=?"
    ).bind(result.payment_session_id || null, result.recurring_plan_id || null, result.payment_link_url, expiresAt, Date.now(), rowId).run();

    return Response.json({ checkoutUrl: result.payment_link_url });
  } catch (error) {
    console.error("[billing:checkout]", error);
    const message = String(error?.message || error);
    if (["member_subscriptions", "subscription_plans", "member_plan_assignments"].some(table => message.includes("no such table: " + table))) {
      return Response.json({ error: "Paket/langganan belum disiapkan. Jalankan ulang admin-schema.sql di D1." }, { status: 503 });
    }
    return Response.json({ error: "Checkout gagal dibuat." }, { status: 500 });
  }
}