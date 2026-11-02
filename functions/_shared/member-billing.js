const enc = new TextEncoder();
export const FREE_SITE_LIMIT = 2;
export const PRO_SITE_LIMIT = 10;

export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function getMember(request, env) {
  const token = (request.headers.get("Cookie") || "").split(";").map(v => v.trim()).find(v => v.startsWith("sf_member="))?.slice(10);
  if (!token || !env.DB) return null;
  const tokenHash = b64(await crypto.subtle.digest("SHA-256", enc.encode(token)));
  return await env.DB.prepare(
    "SELECT m.id,m.email,m.display_name FROM member_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>?"
  ).bind(tokenHash, Date.now()).first();
}

function b64(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function billingConfig(env) {
  const country = String(env.BILLING_COUNTRY || "ID").trim().toUpperCase();
  const currency = String(env.BILLING_CURRENCY || "IDR").trim().toUpperCase();
  const amount = Number(env.PRO_MONTHLY_AMOUNT);
  const supported = (country === "ID" && currency === "IDR") || (country === "MY" && currency === "MYR");
  const validAmount = Number.isFinite(amount) && amount > 0 && (currency === "IDR" ? Number.isInteger(amount) : Math.round(amount * 100) === amount * 100);
  return {
    country,
    currency,
    amount: validAmount ? amount : null,
    configured: !!env.XENDIT_SECRET_KEY && !!env.XENDIT_WEBHOOK_TOKEN && supported && validAmount
  };
}

export async function getMemberPlan(env, memberId) {
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT status,current_period_end,amount,currency,checkout_url,checkout_expires_at,provider_plan_id,updated_at FROM member_subscriptions WHERE member_id=? ORDER BY updated_at DESC LIMIT 1"
  ).bind(memberId).first();
  const paidUntil = Number(row?.current_period_end || 0);
  const isPro = paidUntil > now;
  return {
    plan: isPro ? "pro" : "free",
    siteLimit: isPro ? PRO_SITE_LIMIT : FREE_SITE_LIMIT,
    subscription: row ? {
      status: row.status,
      currentPeriodEnd: paidUntil || null,
      amount: Number(row.amount) || null,
      currency: row.currency || null,
      checkoutUrl: row.status === "pending" && Number(row.checkout_expires_at || 0) > now ? row.checkout_url : null,
      canCancel: !!row.provider_plan_id && ["pending","active","past_due"].includes(row.status)
    } : null
  };
}

export function xenditAuth(env) {
  return "Basic " + btoa(String(env.XENDIT_SECRET_KEY || "") + ":");
}

export function safeCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "xen.to" || url.hostname.endsWith(".xen.to") || url.hostname === "xendit.co" || url.hostname.endsWith(".xendit.co"));
  } catch {
    return false;
  }
}

export function jsonError(error, status, extra = {}) {
  return Response.json({ error, ...extra }, { status });
}