const enc = new TextEncoder();
export const FREE_PLAN_CODE = "free";
export const SITE_LIMIT_SQL = "COALESCE((SELECT p.site_limit FROM member_plan_assignments a JOIN subscription_plans p ON p.code=a.plan_code WHERE a.member_id=? AND (a.ends_at IS NULL OR a.ends_at>?) LIMIT 1),(SELECT p.site_limit FROM member_subscriptions s JOIN subscription_plans p ON p.code=s.plan_code WHERE s.member_id=? AND s.current_period_end>? ORDER BY s.current_period_end DESC LIMIT 1),(SELECT site_limit FROM subscription_plans WHERE code='free' LIMIT 1),2)";

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
  return {
    country: String(env.BILLING_COUNTRY || "ID").trim().toUpperCase(),
    currency: String(env.BILLING_CURRENCY || "IDR").trim().toUpperCase(),
    configured: !!env.XENDIT_SECRET_KEY && !!env.XENDIT_WEBHOOK_TOKEN
  };
}

export async function getMemberPlan(env, memberId) {
  const now = Date.now();
  const assignment = await env.DB.prepare(
    "SELECT p.code,p.name,p.site_limit,a.ends_at FROM member_plan_assignments a JOIN subscription_plans p ON p.code=a.plan_code WHERE a.member_id=? AND (a.ends_at IS NULL OR a.ends_at>?)"
  ).bind(memberId, now).first();
  if (assignment) {
    return {
      plan: assignment.code,
      packageCode: assignment.code,
      packageName: assignment.name,
      siteLimit: Math.max(1, Math.min(100, Number(assignment.site_limit) || 2)),
      planSource: "admin",
      planEndsAt: Number(assignment.ends_at || 0) || null,
      subscription: null
    };
  }

  const paid = await env.DB.prepare(
    "SELECT s.status,s.current_period_end,s.amount,s.currency,s.plan_code,s.provider_plan_id,p.name,p.site_limit FROM member_subscriptions s LEFT JOIN subscription_plans p ON p.code=s.plan_code WHERE s.member_id=? AND s.current_period_end>? ORDER BY s.current_period_end DESC LIMIT 1"
  ).bind(memberId, now).first();
  if (paid) {
    return {
      plan: paid.plan_code || "pro_monthly",
      packageCode: paid.plan_code || "pro_monthly",
      packageName: paid.name || "Pro",
      siteLimit: Math.max(1, Math.min(100, Number(paid.site_limit) || 10)),
      planSource: "xendit",
      planEndsAt: Number(paid.current_period_end),
      subscription: {
        status: paid.status,
        planCode: paid.plan_code || "pro_monthly",
        planName: paid.name || "Pro",
        currentPeriodEnd: Number(paid.current_period_end),
        amount: Number(paid.amount) || null,
        currency: paid.currency || null,
        checkoutUrl: null,
        canCancel: !!paid.provider_plan_id && ["pending","active","past_due"].includes(paid.status)
      }
    };
  }

  const [free, recent] = await Promise.all([
    env.DB.prepare("SELECT code,name,site_limit FROM subscription_plans WHERE code='free'").first(),
    env.DB.prepare("SELECT s.status,s.current_period_end,s.amount,s.currency,s.plan_code,s.checkout_url,s.checkout_expires_at,s.provider_plan_id,p.name AS plan_name FROM member_subscriptions s LEFT JOIN subscription_plans p ON p.code=s.plan_code WHERE s.member_id=? ORDER BY s.updated_at DESC LIMIT 1").bind(memberId).first()
  ]);
  const fallback = free || { code: FREE_PLAN_CODE, name: "Gratis", site_limit: 2 };
  return {
    plan: fallback.code,
    packageCode: fallback.code,
    packageName: fallback.name,
    siteLimit: Math.max(1, Math.min(100, Number(fallback.site_limit) || 2)),
    planSource: "free",
    planEndsAt: null,
    subscription: recent ? {
      status: recent.status,
      planCode: recent.plan_code || null,
      planName: recent.plan_name || null,
      currentPeriodEnd: Number(recent.current_period_end || 0) || null,
      amount: Number(recent.amount) || null,
      currency: recent.currency || null,
      checkoutUrl: recent.status === "pending" && Number(recent.checkout_expires_at || 0) > now ? recent.checkout_url : null,
      canCancel: !!recent.provider_plan_id && ["pending","active","past_due"].includes(recent.status)
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