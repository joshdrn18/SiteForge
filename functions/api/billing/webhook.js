const enc = new TextEncoder();
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function addOneMonth(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return Date.now() + 30 * 86400000;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.XENDIT_WEBHOOK_TOKEN) return Response.json({ error: "Webhook belum dikonfigurasi." }, { status: 503 });
  const supplied = request.headers.get("x-callback-token") || "";
  if (!constantTimeEqual(supplied, String(env.XENDIT_WEBHOOK_TOKEN))) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const event = String(body?.event || "");
  const data = body?.data || {};
  const referenceId = String(data.reference_id || "");
  if (!referenceId) return Response.json({ ok: true, ignored: true });

  try {
    const subscription = await env.DB.prepare(
      "SELECT id,status,provider_updated_at,last_cycle_number,last_cycle_status,first_renewal_at FROM member_subscriptions WHERE provider_reference_id=?"
    ).bind(referenceId).first();
    if (!subscription) return Response.json({ ok: true, ignored: true });

    if (event === "recurring.plan.activated" || event === "recurring.plan.inactivated") {
      const providerUpdatedAt = Date.parse(data.updated || "") || Date.parse(body.created || "") || Date.now();
      const nextStatus = event === "recurring.plan.inactivated" ? "cancelled" : "active";
      await env.DB.prepare(
        "UPDATE member_subscriptions SET provider_plan_id=COALESCE(?,provider_plan_id),status=CASE WHEN status='cancelled' THEN 'cancelled' ELSE ? END,provider_updated_at=?,updated_at=? WHERE provider_reference_id=? AND provider_updated_at<=?"
      ).bind(data.id || null, nextStatus, providerUpdatedAt, Date.now(), referenceId, providerUpdatedAt).run();
      return Response.json({ ok: true });
    }

    if (!event.startsWith("recurring.cycle.")) return Response.json({ ok: true, ignored: true });
    const cycleId = String(data.id || "");
    if (!cycleId) return Response.json({ ok: true, ignored: true });
    const cycleNumber = Math.max(0, Math.floor(Number(data.cycle_number) || 0));
    const incomingStatus = event === "recurring.cycle.succeeded" ? "SUCCEEDED"
      : (event === "recurring.cycle.failed" || event === "recurring.cycle.force_attempt_failed") ? "FAILED"
      : event === "recurring.cycle.retrying" ? "RETRYING"
      : "PENDING";
    const updatedAt = Date.parse(data.updated || "") || Date.parse(body.created || "") || Date.now();

    await env.DB.prepare(
      "INSERT INTO member_subscription_cycles (cycle_id,provider_reference_id,cycle_number,status,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(cycle_id) DO UPDATE SET cycle_number=MAX(member_subscription_cycles.cycle_number,excluded.cycle_number),status=CASE WHEN member_subscription_cycles.status='SUCCEEDED' OR excluded.status='SUCCEEDED' THEN 'SUCCEEDED' ELSE excluded.status END,updated_at=MAX(member_subscription_cycles.updated_at,excluded.updated_at)"
    ).bind(cycleId, referenceId, cycleNumber, incomingStatus, updatedAt).run();

    const cycle = await env.DB.prepare("SELECT cycle_number,status FROM member_subscription_cycles WHERE cycle_id=?").bind(cycleId).first();
    if (cycle?.status === "SUCCEEDED") {
      const start = data.type === "IMMEDIATE"
        ? (Date.parse(data.updated || "") || Date.now())
        : (Date.parse(data.scheduled_timestamp || "") || Date.parse(data.updated || "") || Date.now());
      const paidUntil = data.type === "IMMEDIATE" && Number(subscription.first_renewal_at || 0) > 0
        ? Number(subscription.first_renewal_at)
        : addOneMonth(start);
      await env.DB.prepare(
        "UPDATE member_subscriptions SET current_period_end=MAX(COALESCE(current_period_end,0),?),status=CASE WHEN status='cancelled' THEN 'cancelled' ELSE 'active' END,last_cycle_number=MAX(last_cycle_number,?),last_cycle_status=CASE WHEN ?>=last_cycle_number THEN 'SUCCEEDED' ELSE last_cycle_status END,updated_at=? WHERE provider_reference_id=?"
      ).bind(paidUntil, Number(cycle.cycle_number || 0), Number(cycle.cycle_number || 0), Date.now(), referenceId).run();
    } else if (cycle?.status === "FAILED" || cycle?.status === "RETRYING") {
      const currentCycle = Number(cycle.cycle_number || 0);
      await env.DB.prepare(
        "UPDATE member_subscriptions SET status=CASE WHEN status='cancelled' OR ?<last_cycle_number OR (?=last_cycle_number AND last_cycle_status='SUCCEEDED') THEN status ELSE 'past_due' END,last_cycle_number=MAX(last_cycle_number,?),last_cycle_status=CASE WHEN ?>last_cycle_number THEN ? WHEN ?=last_cycle_number AND last_cycle_status!='SUCCEEDED' THEN ? ELSE last_cycle_status END,updated_at=? WHERE provider_reference_id=?"
      ).bind(currentCycle, currentCycle, currentCycle, currentCycle, cycle.status, currentCycle, cycle.status, Date.now(), referenceId).run();
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[billing:webhook]", error);
    const message = String(error?.message || error);
    if (message.includes("no such table: member_subscriptions") || message.includes("no such table: member_subscription_cycles")) {
      return Response.json({ error: "Jalankan ulang admin-schema.sql di D1." }, { status: 503 });
    }
    return Response.json({ error: "Gagal memproses webhook." }, { status: 500 });
  }
}